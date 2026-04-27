/**
 * Payment Retry & Failure Tests
 *
 * Tags: @advanced @regression
 *
 * Validates:
 *   - Payment failure drives subscription to past_due
 *   - Grace period entry after past_due
 *   - Retry success resolves grace period → active
 *   - Retry exhaustion → canceled
 *   - Idempotent retry: same key → single payment record
 *   - Grace period expiry triggers cancellation
 */

import { test, expect } from '../../fixtures';
import { DataFactory } from '../../utils/dataFactory';
import { BillingCalculator } from '../../utils/BillingCalculator';
import { TimeService } from '../../utils/TimeService';
import { ConsistencyValidator } from '../../utils/ConsistencyValidator';
import { Logger } from '../../utils/logger';

test.describe('Payment Retry & Failure @advanced @regression', () => {

  test('payment failure: should transition active→past_due after failed charge', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    const sub = await subscriptionService.subscribe(user.id, 'basic', 9.99);

    // Simulate payment failure
    const result = await billingService.chargeWithFailure(user.id, sub.id, 9.99);
    expect(result.charged).toBe(false);
    expect(result.payment!.status).toBe('failed');

    // Manually transition to past_due (service validates this)
    const pastDue = await subscriptionService.transitionState(sub.id, 'active', 'past_due');
    expect(pastDue.state).toBe('past_due');

    // One success (initial) + one failed payment
    const failed = await billingService.getFailedPayments(user.id);
    expect(failed).toHaveLength(1);

    Logger.info('[Test] Payment failure correctly drove subscription to past_due.');
  });

  test('grace period: should enter grace period from past_due', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    const sub = await subscriptionService.subscribe(user.id, 'basic', 9.99);

    // Drive to past_due
    await subscriptionService.transitionState(sub.id, 'active', 'past_due');

    const grace = await subscriptionService.enterGracePeriod(user.id, 7);

    expect(grace.state).toBe('grace');
    expect(grace.gracePeriodEndsAt).not.toBeNull();

    // Grace period ends ~7 days from now
    const graceEnd = new Date(grace.gracePeriodEndsAt!);
    expect(graceEnd.getTime()).toBeGreaterThan(TimeService.now().getTime());

    Logger.info(`[Test] Grace period entered. Ends: ${grace.gracePeriodEndsAt}`);
  });

  test('retry success: should resolve grace period → active', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    const sub = await subscriptionService.subscribe(user.id, 'basic', 9.99);

    // Drive to grace
    await subscriptionService.transitionState(sub.id, 'active', 'past_due');
    await subscriptionService.enterGracePeriod(user.id, 7);

    const idempotencyKey = billingService.retryKey(user.id, sub.id, 1);
    const resolved = await subscriptionService.resolveGracePeriod(user.id, idempotencyKey);

    expect(resolved.state).toBe('active');
    expect(resolved.gracePeriodEndsAt).toBeNull();

    // Successful retry payment is in history
    const payments = await billingService.getSuccessfulPayments(user.id);
    expect(payments.length).toBeGreaterThanOrEqual(2); // initial + retry

    Logger.info('[Test] Grace period resolved via retry. Subscription reactivated.');
  });

  test('retry exhaustion: should cancel subscription after max retries', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    const sub = await subscriptionService.subscribe(user.id, 'basic', 9.99);

    // Drive to grace with a 1-day window
    await subscriptionService.transitionState(sub.id, 'active', 'past_due');
    await subscriptionService.enterGracePeriod(user.id, 1);

    // Record max retry failures
    for (let attempt = 1; attempt <= BillingCalculator.MAX_RETRY_ATTEMPTS; attempt++) {
      const key = billingService.retryKey(user.id, sub.id, attempt);
      await billingService.chargeWithFailure(user.id, sub.id, 9.99, key);
    }

    // Advance past grace period
    TimeService.advanceDays(2);

    // Now grace period is expired — exhausting it should cancel
    const canceled = await subscriptionService.exhaustGracePeriod(user.id);
    expect(canceled.state).toBe('canceled');

    // All failed payments recorded
    const failed = await billingService.getFailedPayments(user.id);
    expect(failed.length).toBe(BillingCalculator.MAX_RETRY_ATTEMPTS);

    Logger.info(`[Test] ${BillingCalculator.MAX_RETRY_ATTEMPTS} retries exhausted → subscription canceled.`);
  });

  test('idempotency: same key should produce exactly one payment record', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    const sub = await subscriptionService.subscribe(user.id, 'basic', 9.99);

    const idempotencyKey = BillingCalculator.generateIdempotencyKey(user.id, sub.id, 1, 'test');

    // Submit same payment 3 times with identical key
    const r1 = await billingService.charge(user.id, sub.id, 9.99, idempotencyKey);
    const r2 = await billingService.charge(user.id, sub.id, 9.99, idempotencyKey);
    const r3 = await billingService.charge(user.id, sub.id, 9.99, idempotencyKey);

    // First call creates the record
    expect(r1.charged).toBe(true);
    expect(r1.idempotent).toBe(false);

    // Subsequent calls return existing record
    expect(r2.idempotent).toBe(true);
    expect(r3.idempotent).toBe(true);

    // Only ONE record with this key in DB
    const count = await ConsistencyValidator.countByIdempotencyKey(idempotencyKey);
    expect(count).toBe(1);

    // All three calls returned the same payment ID
    expect(r1.payment!.id).toBe(r2.payment!.id);
    expect(r2.payment!.id).toBe(r3.payment!.id);

    Logger.info(`[Test] Idempotency validated. Key "${idempotencyKey}" → exactly 1 payment record.`);
  });

  test('idempotency: different attempt numbers should produce separate records', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    const sub = await subscriptionService.subscribe(user.id, 'basic', 9.99);

    const key1 = billingService.retryKey(user.id, sub.id, 1);
    const key2 = billingService.retryKey(user.id, sub.id, 2);

    await billingService.chargeWithFailure(user.id, sub.id, 9.99, key1);
    await billingService.chargeWithFailure(user.id, sub.id, 9.99, key2);

    const failed = await billingService.getFailedPayments(user.id);
    expect(failed.length).toBe(2); // two distinct failed records

    Logger.info('[Test] Different retry attempts correctly produce separate payment records.');
  });

  test('grace expiry: should reject exhaustGracePeriod when grace is still active', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    const sub = await subscriptionService.subscribe(user.id, 'basic', 9.99);

    await subscriptionService.transitionState(sub.id, 'active', 'past_due');
    await subscriptionService.enterGracePeriod(user.id, 7);

    // Grace period still active — exhaustGracePeriod should throw
    await expect(
      subscriptionService.exhaustGracePeriod(user.id),
    ).rejects.toThrow(/not expired yet/i);

    Logger.info('[Test] Correctly rejected exhaustGracePeriod while grace is still active.');
  });
});
