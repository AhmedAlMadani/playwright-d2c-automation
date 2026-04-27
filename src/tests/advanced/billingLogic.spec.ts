/**
 * Billing Logic Tests
 *
 * Tags: @advanced @regression
 *
 * Validates:
 *   - Payment records are created for billable events
 *   - Proration math is correct for mid-cycle upgrades
 *   - Downgrade produces no immediate charge
 *   - Auto-renewal charges the correct amount
 *   - BillingCalculator pure-function correctness
 */

import { test, expect } from '../../fixtures';
import { DataFactory } from '../../utils/dataFactory';
import { BillingCalculator } from '../../utils/BillingCalculator';
import { TimeService } from '../../utils/TimeService';
import { Logger } from '../../utils/logger';

test.describe('Billing Logic @advanced @regression', () => {

  test('subscribe: should record exactly one payment on subscription creation', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    const payments = await billingService.getHistory(user.id);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(9.99);
    expect(payments[0].status).toBe('success');

    Logger.info('[Test] Exactly one payment recorded on subscription creation.');
  });

  test('subscribe: should record payment matching the plan price', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'premium', 29.99);

    const payments = await billingService.getSuccessfulPayments(user.id);
    expect(payments[0].amount).toBe(29.99);
  });

  test('trial: should NOT record payment during free trial', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.startTrial(user.id, 'premium', 29.99, 14);

    const payments = await billingService.getHistory(user.id);
    expect(payments).toHaveLength(0);

    Logger.info('[Test] No payment recorded during free trial.');
  });

  test('upgradePlan: should record prorated charge on upgrade', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);

    // Freeze the clock BEFORE subscribe so billingCycleStart is anchored
    // to the same instant as the virtual clock. Without this, the few ms
    // between subscription creation and advanceDays cause Math.floor to
    // return 14 instead of 15 (15.999... days → floor → 14).
    TimeService.freezeAt(new Date());
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    // Advance exactly 15 days from the frozen anchor
    TimeService.advanceDays(15);

    const { proratedCharge } = await subscriptionService.upgradePlan(user.id, 'premium', 29.99);

    // 15 days remaining in 30-day cycle: proration = (29.99 - 9.99) * (15/30) = $10.00
    const expected = BillingCalculator.computeProration(9.99, 29.99, 15);
    expect(proratedCharge).toBeCloseTo(expected, 2);
    expect(proratedCharge).toBeGreaterThan(0);

    // Total payments: initial ($9.99) + prorated upgrade
    const payments = await billingService.getSuccessfulPayments(user.id);
    expect(payments.length).toBe(2);
    const amounts = payments.map(p => p.amount);
    expect(amounts).toContain(9.99);
    expect(amounts.find(a => Math.abs(a - proratedCharge) < 0.01)).toBeDefined();

    Logger.info(`[Test] Prorated charge: $${proratedCharge} (15 days remaining)`);
  });

  test('downgradePlan: should NOT record any charge on downgrade', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'enterprise', 99.99);

    const paymentsBefore = await billingService.getHistory(user.id);
    expect(paymentsBefore).toHaveLength(1);

    await subscriptionService.downgradePlan(user.id, 'basic', 9.99);

    const paymentsAfter = await billingService.getHistory(user.id);
    expect(paymentsAfter).toHaveLength(1); // no new payment

    Logger.info('[Test] Downgrade did not create an additional payment.');
  });

  test('autoRenewal: should record payment and advance renewsAt', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    const before = await subscriptionService.getStatus(user.id);
    const originalRenewsAt = before!.renewsAt;

    // Advance past renewal date so renewal is "due"
    TimeService.advanceDays(31);

    await subscriptionService.processAutoRenewal(user.id);

    const after = await subscriptionService.getStatus(user.id);
    const newRenewsAt = after!.renewsAt;

    // renewsAt should have advanced
    expect(newRenewsAt).not.toBe(originalRenewsAt);
    expect(new Date(newRenewsAt!).getTime()).toBeGreaterThan(new Date(originalRenewsAt!).getTime());

    // Two payments: initial + renewal
    const payments = await billingService.getSuccessfulPayments(user.id);
    expect(payments.length).toBe(2);

    Logger.info(`[Test] Renewal processed. New renewsAt: ${newRenewsAt}`);
  });

  test('BillingCalculator: computeProration should return 0 for same-price plans', async ({}) => {
    const charge = BillingCalculator.computeProration(9.99, 9.99, 15);
    expect(charge).toBe(0);
  });

  test('BillingCalculator: computeProration should return 0 for downgrades', async ({}) => {
    const charge = BillingCalculator.computeProration(29.99, 9.99, 15);
    expect(charge).toBe(0);
  });

  test('BillingCalculator: isTrialExpired should use virtual clock', async ({}) => {
    const endsAt = TimeService.isoFromNow(1); // 1 day from now
    expect(BillingCalculator.isTrialExpired(endsAt)).toBe(false);

    TimeService.advanceDays(2);
    expect(BillingCalculator.isTrialExpired(endsAt)).toBe(true);

    TimeService.reset();
  });
});
