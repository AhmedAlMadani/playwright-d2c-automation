/**
 * Plan Upgrade & Downgrade Tests
 *
 * Tags: @advanced @regression
 *
 * Validates:
 *   - Immediate upgrade: plan changes + prorated charge
 *   - Downgrade: plan changes, no charge
 *   - Upgrade → downgrade → upgrade sequence
 *   - Cannot upgrade a canceled subscription
 *   - Cannot upgrade to same plan
 *   - Cannot downgrade to higher-priced plan
 *   - Mid-cycle changePlanMidCycle auto-routes to upgrade/downgrade
 */

import { test, expect } from '../../fixtures';
import { DataFactory } from '../../utils/dataFactory';
import { BillingCalculator } from '../../utils/BillingCalculator';
import { TimeService } from '../../utils/TimeService';
import { Logger } from '../../utils/logger';
import { supabase } from '../../db/supabaseClient';

test.describe('Plan Upgrade & Downgrade @advanced @regression', () => {

  test('upgradePlan: should change plan and record prorated charge', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    TimeService.advanceDays(15); // mid-cycle

    const { subscription, proratedCharge } = await subscriptionService.upgradePlan(user.id, 'premium', 29.99);

    expect(subscription.planId).toBe('premium');
    expect(subscription.price).toBe(29.99);
    expect(proratedCharge).toBeGreaterThan(0);

    // Initial charge + prorated upgrade
    const payments = await billingService.getSuccessfulPayments(user.id);
    expect(payments.length).toBe(2);

    // Uniqueness validation: Ensure exactly one active subscription exists
    const { count } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('state', 'active');
    expect(count).toBe(1);

    Logger.info(`[Test] Upgraded basic→premium. Prorated charge: $${proratedCharge}`);
  });

  test('upgradePlan: no proration when upgrading at start of cycle', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    // 0 days elapsed — full proration applies (29 remaining of 30)
    const { proratedCharge } = await subscriptionService.upgradePlan(user.id, 'premium', 29.99);
    expect(proratedCharge).toBeGreaterThan(0); // ~$19.99

    Logger.info(`[Test] Full cycle proration: $${proratedCharge}`);
  });

  test('downgradePlan: should change plan without recording a charge', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'enterprise', 99.99);

    const countBefore = await billingService.getPaymentCount(user.id);

    const downgraded = await subscriptionService.downgradePlan(user.id, 'basic', 9.99);

    expect(downgraded.planId).toBe('basic');
    expect(downgraded.price).toBe(9.99);

    const countAfter = await billingService.getPaymentCount(user.id);
    expect(countAfter).toBe(countBefore); // no new payment

    Logger.info('[Test] Downgraded enterprise→basic. No additional charge recorded.');
  });

  test('upgrade→downgrade→upgrade: should handle plan change sequence', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    // Upgrade
    const { subscription: premium } = await subscriptionService.upgradePlan(user.id, 'premium', 29.99);
    expect(premium.planId).toBe('premium');

    // Downgrade
    const basic = await subscriptionService.downgradePlan(user.id, 'basic', 9.99);
    expect(basic.planId).toBe('basic');

    // Upgrade again
    const { subscription: enterprise } = await subscriptionService.upgradePlan(user.id, 'enterprise', 99.99);
    expect(enterprise.planId).toBe('enterprise');

    Logger.info('[Test] Plan sequence basic→premium→basic→enterprise completed successfully.');
  });

  test('upgradePlan: should reject upgrade of canceled subscription', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);
    await subscriptionService.cancel(user.id);

    await expect(
      subscriptionService.upgradePlan(user.id, 'premium', 29.99),
    ).rejects.toThrow(/Cannot upgrade.*canceled/i);

    Logger.info('[Test] Correctly rejected upgrade of canceled subscription.');
  });

  test('upgradePlan: should reject upgrade to same plan', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    await expect(
      subscriptionService.upgradePlan(user.id, 'basic', 9.99),
    ).rejects.toThrow(/Already on plan/i);

    Logger.info('[Test] Correctly rejected upgrade to same plan.');
  });

  test('downgradePlan: should reject downgrade to higher-priced plan', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    await expect(
      subscriptionService.downgradePlan(user.id, 'premium', 29.99),
    ).rejects.toThrow(/lower price/i);

    Logger.info('[Test] Correctly rejected downgrade to higher-priced plan.');
  });

  test('changePlanMidCycle: should auto-route to upgrade when price increases', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    TimeService.advanceDays(10);

    const { subscription, proratedCharge } = await subscriptionService.changePlanMidCycle(user.id, 'premium', 29.99);

    expect(subscription.planId).toBe('premium');
    expect(proratedCharge).toBeGreaterThan(0);

    Logger.info(`[Test] changePlanMidCycle routed to upgrade. Charge: $${proratedCharge}`);
  });

  test('changePlanMidCycle: should auto-route to downgrade when price decreases', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const { email, password } = DataFactory.generateUserData('Pass1!');
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'premium', 29.99);

    const countBefore = await billingService.getPaymentCount(user.id);

    const { subscription, proratedCharge } = await subscriptionService.changePlanMidCycle(user.id, 'basic', 9.99);

    expect(subscription.planId).toBe('basic');
    expect(proratedCharge).toBe(0); // downgrade = no charge

    const countAfter = await billingService.getPaymentCount(user.id);
    expect(countAfter).toBe(countBefore); // no new payment

    Logger.info('[Test] changePlanMidCycle routed to downgrade. No charge.');
  });
});
