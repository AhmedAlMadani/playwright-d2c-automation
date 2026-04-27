/**
 * E2E Test: Advanced Subscription Lifecycle Funnel
 *
 * Tags: @smoke @regression
 *
 * Validates the full UI/API lifecycle funnel:
 *   1. Signup → Trial (UI)
 *   2. Trial → Active conversion (Time-based simulation)
 *   3. Active → Past Due (Simulated payment failure)
 *   4. Past Due → Grace Period (API transition)
 *   5. Grace Period → Canceled (UI action)
 */

import { test, expect } from '../../fixtures';
import { DataFactory } from '../../utils/dataFactory';
import { Logger } from '../../utils/logger';
import { TimeService } from '../../utils/TimeService';

test.describe('Advanced Subscription Lifecycle Funnel @smoke @regression', () => {

  test('should drive full lifecycle from trial to cancellation via UI and API', async ({
    userService,
    subscriptionService,
    billingService,
    dashboardPage,
    page,
  }) => {
    // ── Setup: Create user ───────────────────────────────────────────────────
    const { email, password } = DataFactory.generateUserData('SecurePass1!');
    const user = await userService.createUser(email, password!);
    Logger.info(`[Test] User created: ${user.id}`);

    // Authenticate in UI
    await page.request.post('/__test__/session', { data: { email } });

    // ── 1. Start Trial via API ───────────────────────────────────────────────
    await subscriptionService.startTrial(user.id, 'premium', 29.99, 14);

    // Verify UI shows Trial state
    await dashboardPage.goto();
    await dashboardPage.expectSubscriptionStatus('trial');
    const trialBadge = await dashboardPage.getTrialEndBadgeText();
    expect(trialBadge).toContain('Ends');

    // ── 2. Convert Trial to Active ───────────────────────────────────────────
    TimeService.advanceDays(13); // Advance close to trial end but not expired
    await subscriptionService.convertTrialToActive(user.id, 29.99);

    // Verify UI reflects Active
    await dashboardPage.page.reload();
    await dashboardPage.expectSubscriptionStatus('active');
    let info = await dashboardPage.getBillingInfo();
    expect(info.nextBilling).toBeDefined();

    // ── 3. Payment Failure → Past Due ────────────────────────────────────────
    const currentSub = await subscriptionService.getStatus(user.id);
    await billingService.chargeWithFailure(user.id, currentSub!.id, 29.99);
    await subscriptionService.transitionState(currentSub!.id, 'active', 'past_due');

    await dashboardPage.page.reload();
    await dashboardPage.expectSubscriptionStatus('past_due');

    // ── 4. Enter Grace Period ────────────────────────────────────────────────
    await subscriptionService.enterGracePeriod(user.id, 7);

    await dashboardPage.page.reload();
    await dashboardPage.expectSubscriptionStatus('grace');
    await dashboardPage.expectGracePeriodWarningVisible();

    const graceBadge = await dashboardPage.getGracePeriodBadgeText();
    expect(graceBadge).toContain('Deadline');

    // ── 5. Cancel via UI ─────────────────────────────────────────────────────
    await dashboardPage.clickCancelSubscription();
    await dashboardPage.expectCancellationSuccess();
    await dashboardPage.expectSubscriptionStatus('canceled');

    // Verify UI hides auto-renew and shows resubscribe
    await dashboardPage.expectAutoRenewToggleHidden();
    await dashboardPage.expectResubscribeVisible();

    // ── Cross-check: API must agree ───────────────────────────────────────────
    const finalSub = await subscriptionService.getStatus(user.id);
    expect(finalSub!.state).toBe('canceled');
    Logger.info('[Test] Full lifecycle validated across UI and API.');
  });
});
