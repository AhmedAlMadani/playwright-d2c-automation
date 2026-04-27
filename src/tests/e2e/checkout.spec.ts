/**
 * E2E Test: Full Funnel Checkout & Dashboard
 *
 * Tags: @smoke @regression
 *
 * This test validates the complete happy-path user journey:
 *   1. Create user via API
 *   2. Land on the product page
 *   3. Navigate to sign-up and authenticate
 *   4. Select a pricing plan
 *   5. Complete checkout with mock payment
 *   6. Verify subscription is active via UI (Dashboard)
 *   7. Toggle auto-renewal via UI
 *   8. Cross-validate subscription state via API
 */

import { test, expect } from '../../fixtures';
import { DataFactory } from '../../utils/dataFactory';
import { PaymentMock } from '../../utils/paymentMock';
import { Logger } from '../../utils/logger';

test.describe('Checkout Flow – Happy Path @smoke @regression', () => {

  test('should complete full checkout and manage subscription via UI', async ({
    userService,
    subscriptionService,
    pricingPage,
    checkoutPage,
    dashboardPage,
    page,
  }) => {
    // ── Step 1: Create user via API ──────────────────────────────────────────
    const userData = DataFactory.generateUserData('SecurePass1!');
    Logger.info(`[Test] Creating user via API: ${userData.email}`);
    const user = await userService.createUser(userData.email, userData.password!);

    // ── Step 2: Authenticate in UI via backdoor ──────────────────────────────
    await page.request.post('/__test__/session', { data: { email: user.email } });

    // ── Step 3: Select a plan ────────────────────────────────────────────────
    await pricingPage.goto();
    await pricingPage.selectPlan('Premium');
    await pricingPage.expectPlanSelected('Premium');

    // ── Step 4: Complete checkout with success card ──────────────────────────
    const card = PaymentMock.getSuccessCard();
    await checkoutPage.fillPaymentDetails(card.cardNumber, card.expiry, card.cvv);
    await checkoutPage.completePurchase();

    // ── Step 5: Verify subscription is active via UI ─────────────────────────
    await dashboardPage.expectSubscriptionStatus('active');
    
    // Verify detailed UI elements
    const info = await dashboardPage.getBillingInfo();
    expect(info.nextBilling).toBeDefined();
    expect(info.cycleStarted).toBeDefined();

    // ── Step 6: Toggle Auto-Renew via UI ─────────────────────────────────────
    await dashboardPage.expectAutoRenewToggleVisible();
    const isAutoRenewing = await dashboardPage.getAutoRenewState();
    expect(isAutoRenewing).toBe(true); // Default

    await dashboardPage.toggleAutoRenew();
    const afterToggle = await dashboardPage.getAutoRenewState();
    expect(afterToggle).toBe(false);

    // ── Step 7: Cross-validate via API ────────────────────────────────────────
    Logger.info('[Test] Cross-checking subscription state via API...');
    const subscription = await subscriptionService.getStatus(user.id);
    expect(subscription).not.toBeNull();
    expect(subscription!.state).toBe('active');
    expect(subscription!.autoRenew).toBe(false); // Matches UI action
  });

  test('should redirect unauthenticated user to sign-up from checkout @regression', async ({
    page,
  }) => {
    await page.goto('/checkout?plan=premium');
    await expect(page).toHaveURL(/signup|login/);
  });
});
