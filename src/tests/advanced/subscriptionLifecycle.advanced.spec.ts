/**
 * Advanced Subscription Lifecycle Tests
 *
 * Tags: @advanced @regression
 *
 * Validates the complete trial lifecycle:
 *   - Trial start and field validation
 *   - Trial → active conversion (with first payment)
 *   - Trial → expired (time-based)
 *   - Trial → canceled
 *   - Trial reuse prevention
 */

import { test, expect } from '../../fixtures';
import { DataFactory } from '../../utils/dataFactory';
import { TimeService } from '../../utils/TimeService';
import { BillingCalculator } from '../../utils/BillingCalculator';
import { Logger } from '../../utils/logger';
import { SubscriptionService } from '../../services/SubscriptionService';

test.describe('Advanced Subscription Lifecycle @advanced @regression', () => {

  test('startTrial: should create subscription in trial state with correct fields', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const u = await userService.createUser(email, password!);

    const trialDays = 14;
    const sub = await subscriptionService.startTrial(u.id, 'basic', 9.99, trialDays);

    expect(sub.state).toBe('trial');
    expect(sub.trialEndsAt).not.toBeNull();
    expect(sub.planId).toBe('basic');
    expect(sub.autoRenew).toBe(true);

    // trialEndsAt should be in the future
    const endsAt = new Date(sub.trialEndsAt!);
    expect(endsAt.getTime()).toBeGreaterThan(TimeService.now().getTime());

    // Approximately 14 days from now (within 1 minute tolerance)
    const expectedEnd = TimeService.daysFromNow(trialDays);
    expect(Math.abs(endsAt.getTime() - expectedEnd.getTime())).toBeLessThan(60_000);

    Logger.info(`[Test] Trial created: ${sub.id}, ends: ${sub.trialEndsAt}`);
  });

  test('startTrial: should prevent trial reuse for the same user', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);

    // First trial succeeds
    await subscriptionService.startTrial(user.id, 'basic', 9.99);

    // Second trial must be rejected
    await expect(
      subscriptionService.startTrial(user.id, 'premium', 29.99),
    ).rejects.toThrow(/Trial reuse rejected/);

    Logger.info('[Test] Trial reuse correctly prevented.');
  });

  test('convertTrialToActive: should transition trial→active and record first payment', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.startTrial(user.id, 'premium', 29.99, 14);

    const active = await subscriptionService.convertTrialToActive(user.id, 29.99);

    expect(active.state).toBe('active');
    expect(active.trialEndsAt).toBeNull();
    expect(active.renewsAt).not.toBeNull();
    expect(active.billingCycleStart).not.toBeNull();

    // Exactly one payment should be recorded
    const payments = await billingService.getSuccessfulPayments(user.id);
    expect(payments.length).toBe(1);
    expect(payments[0].amount).toBe(29.99);
    expect(payments[0].status).toBe('success');

    Logger.info(`[Test] Trial converted to active. Payment: $${payments[0].amount}`);
  });

  test('convertTrialToActive: should reject conversion when trial already expired', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);

    // Start a 1-day trial, then advance clock past its end
    await subscriptionService.startTrial(user.id, 'basic', 9.99, 1);
    TimeService.advanceDays(2); // trial is now expired

    await expect(
      subscriptionService.convertTrialToActive(user.id, 9.99),
    ).rejects.toThrow(/trial.*expired|expired.*trial/i);

    Logger.info('[Test] Correctly rejected conversion of expired trial.');
  });

  test('expireTrial: should transition trial→expired after trial period', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);

    // 1-day trial
    await subscriptionService.startTrial(user.id, 'basic', 9.99, 1);

    // Clock not yet advanced — expire should fail
    await expect(
      subscriptionService.expireTrial(user.id),
    ).rejects.toThrow(/not expired yet/i);

    // Advance past trial end
    TimeService.advanceDays(2);

    const expired = await subscriptionService.expireTrial(user.id);
    expect(expired.state).toBe('expired');

    // 'expired' is terminal — verify via static state machine map
    const transitions = SubscriptionService.getValidTransitions();
    expect(transitions['expired']).toHaveLength(0);

    Logger.info(`[Test] Trial expired correctly: ${expired.id}`);
  });

  test('cancel trial: should transition trial→canceled', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.startTrial(user.id, 'basic', 9.99);

    const canceled = await subscriptionService.cancel(user.id);
    expect(canceled.state).toBe('canceled');

    // No payments recorded (trial was free)
    const history = await subscriptionService.getPaymentHistory(user.id);
    expect(history.length).toBe(0);

    Logger.info('[Test] Trial canceled correctly. No payments recorded.');
  });

  test('toggleAutoRenew: should update autoRenew flag on active subscription', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    // Default is true
    const before = await subscriptionService.getStatus(user.id);
    expect(before!.autoRenew).toBe(true);

    // Disable
    const updated = await subscriptionService.toggleAutoRenew(user.id, false);
    expect(updated.autoRenew).toBe(false);

    // Re-enable
    const reEnabled = await subscriptionService.toggleAutoRenew(user.id, true);
    expect(reEnabled.autoRenew).toBe(true);

    Logger.info('[Test] AutoRenew toggle validated.');
  });
});
