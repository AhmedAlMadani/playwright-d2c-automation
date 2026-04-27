/**
 * Time-Based State Transition Tests
 *
 * Tags: @advanced @regression
 *
 * Validates that subscription lifecycle events that depend on time
 * behave correctly relative to the virtual clock (TimeService).
 *
 * Pattern:
 *   1. Create subscription with a specific timestamp (past or future)
 *   2. Optionally advance the virtual clock
 *   3. Assert that the service correctly evaluates the time condition
 */

import { test, expect } from '../../fixtures';
import { DataFactory } from '../../utils/dataFactory';
import { TimeService } from '../../utils/TimeService';
import { BillingCalculator } from '../../utils/BillingCalculator';
import { Logger } from '../../utils/logger';

test.describe('Time-Based State Transitions @advanced @regression', () => {

  test('trial: should NOT expire when trialEndsAt is in the future', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);

    // 14-day trial — not expired yet (clock at real "now")
    await subscriptionService.startTrial(user.id, 'basic', 9.99, 14);

    await expect(
      subscriptionService.expireTrial(user.id),
    ).rejects.toThrow(/not expired yet/i);

    Logger.info('[Test] Correctly rejected expiry of active trial.');
  });

  test('trial: should expire when clock advances past trialEndsAt', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);

    // 1-day trial
    await subscriptionService.startTrial(user.id, 'basic', 9.99, 1);

    // Advance 2 days → trial is expired
    TimeService.advanceDays(2);

    const expired = await subscriptionService.expireTrial(user.id);
    expect(expired.state).toBe('expired');

    Logger.info('[Test] Trial expired correctly after TimeService.advanceDays(2).');
  });

  test('grace period: should NOT be exhaustable before deadline', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    const sub = await subscriptionService.subscribe(user.id, 'basic', 9.99);

    await subscriptionService.transitionState(sub.id, 'active', 'past_due');
    await subscriptionService.enterGracePeriod(user.id, 7);

    // Advance only 3 days — grace period still running
    TimeService.advanceDays(3);

    await expect(
      subscriptionService.exhaustGracePeriod(user.id),
    ).rejects.toThrow(/not expired yet/i);

    Logger.info('[Test] Grace period correctly not exhaustable before deadline.');
  });

  test('grace period: should be exhaustable after 7 days', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    const sub = await subscriptionService.subscribe(user.id, 'basic', 9.99);

    await subscriptionService.transitionState(sub.id, 'active', 'past_due');
    await subscriptionService.enterGracePeriod(user.id, 7);

    // Advance 8 days — grace period has ended
    TimeService.advanceDays(8);

    const canceled = await subscriptionService.exhaustGracePeriod(user.id);
    expect(canceled.state).toBe('canceled');

    Logger.info('[Test] Grace period exhausted correctly after 8 days.');
  });

  test('renewal: should NOT process renewal before renewsAt', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    // No time advance — renewal not due yet
    await expect(
      subscriptionService.processAutoRenewal(user.id),
    ).rejects.toThrow(/not yet due/i);

    Logger.info('[Test] Correctly rejected premature renewal.');
  });

  test('renewal: should process renewal after renewsAt date passes', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    // Advance 31 days → renewal is due
    TimeService.advanceDays(31);

    const renewed = await subscriptionService.processAutoRenewal(user.id);
    expect(renewed.state).toBe('active');

    const payments = await billingService.getSuccessfulPayments(user.id);
    expect(payments.length).toBe(2); // initial + renewal

    Logger.info('[Test] Auto-renewal processed after 31 days.');
  });

  test('proration: should compute 0 days remaining at end of cycle', async ({ timeService, billingCalculator }) => {
    // Freeze at a known time
    timeService.freezeAt(new Date('2024-01-31T12:00:00Z'));
    const cycleStart = '2024-01-01T12:00:00.000Z'; // 30 days ago
    const days = billingCalculator.daysRemainingInCycle(cycleStart, 30);
    expect(days).toBe(0);
    timeService.reset();
  });

  test('proration: should compute ~15 days remaining at mid-cycle', async ({ timeService, billingCalculator }) => {
    timeService.freezeAt(new Date('2024-01-16T00:00:00Z')); // day 15 of cycle
    const cycleStart = '2024-01-01T00:00:00.000Z';
    const days = billingCalculator.daysRemainingInCycle(cycleStart, 30);
    expect(days).toBeGreaterThanOrEqual(14);
    expect(days).toBeLessThanOrEqual(16);
    timeService.reset();
  });

  test('TimeService: freeze and reset should be isolated between tests', async ({ timeService }) => {
    // TimeService was reset in beforeEach — clock should be real
    expect(timeService.isFrozen()).toBe(false);

    timeService.freezeAt(new Date('2020-01-01'));
    expect(timeService.now().getFullYear()).toBe(2020);

    timeService.reset();
    expect(timeService.now().getFullYear()).toBeGreaterThan(2020);

    Logger.info('[Test] TimeService freeze/reset isolation validated.');
  });

  test('BillingCalculator: isGracePeriodExpired uses virtual clock', async ({ timeService, billingCalculator }) => {
    const gracePeriodEndsAt = timeService.isoFromNow(7);

    expect(billingCalculator.isGracePeriodExpired(gracePeriodEndsAt)).toBe(false);

    timeService.advanceDays(8);
    expect(billingCalculator.isGracePeriodExpired(gracePeriodEndsAt)).toBe(true);

    timeService.reset();
  });
});
