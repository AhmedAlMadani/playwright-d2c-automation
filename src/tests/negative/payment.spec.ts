/**
 * Negative Tests: Payment Failure Scenarios
 *
 * Tags: @regression
 *
 * Validates that the system handles all payment failure modes correctly:
 *   - Generic card decline (UI)
 *   - Expired card (UI)
 *   - Insufficient funds (UI)
 *   - Invalid signup inputs
 *   - Service layer rejects invalid state transitions (e.g. canceled -> active)
 *
 * Strategy: UI-driven checkout failures, API cross-check, Service layer validation.
 */

import { test, expect } from '../../fixtures';
import { DataFactory } from '../../utils/dataFactory';
import { PaymentMock, PaymentScenario } from '../../utils/paymentMock';
import { Logger } from '../../utils/logger';

test.describe('Negative Tests – Payment Failures (UI) @regression', () => {
  // ── Parameterised: iterate over all UI failure scenarios ───────────────────
  const failureScenarios = PaymentMock.getFailureScenarios();

  for (const scenario of failureScenarios) {
    test(`should reject payment and show error for scenario: "${scenario}"`, async ({
      userService,
      subscriptionService,
      checkoutPage,
      page,
    }) => {
      // Setup
      const { email, password } = DataFactory.generateUserData('SecurePass1!');
      const user = await userService.createUser(email, password!);
      Logger.info(`[Test] Testing UI payment failure scenario: ${scenario}`);

      const card = PaymentMock.getCard(scenario as PaymentScenario);

      // Authenticate
      await page.request.post('/__test__/session', { data: { email } });

      await checkoutPage.goto('premium');
      await checkoutPage.fillPaymentDetails(card.cardNumber, card.expiry, card.cvv);
      await checkoutPage.completePurchase();

      // Expect UI error
      const expectedError = PaymentMock.getExpectedError(scenario as PaymentScenario);
      if (expectedError) {
        await checkoutPage.expectPurchaseFailure(expectedError);
      }

      // Cross-check: subscription should NOT exist
      const subscription = await subscriptionService.getStatus(user.id);
      expect(subscription).toBeNull();
    });
  }
});

test.describe('Negative Tests – Invalid Signup Inputs @regression', () => {
  test('should reject signup with empty email', async ({ signupPage }) => {
    await signupPage.goto();
    await signupPage.signup({ id: 'test', email: '', password: 'ValidPass1!', createdAt: new Date().toISOString() });
    await signupPage.expectSignupFailure('Email is required');
  });

  test('should reject signup with invalid email format', async ({ signupPage }) => {
    await signupPage.goto();
    await signupPage.signup({ id: 'test', email: 'not-an-email', password: 'ValidPass1!', createdAt: new Date().toISOString() });
    await signupPage.expectSignupFailure('Invalid email address');
  });

  test('should reject signup with weak password', async ({ signupPage }) => {
    await signupPage.goto();
    await signupPage.signup({ id: 'test', email: 'valid@example.com', password: 'short', createdAt: new Date().toISOString() });
    await signupPage.expectSignupFailure('Password must be at least 6 characters');
  });
});

test.describe('Negative Tests – State Machine Integrity @regression', () => {
  test('should prevent reactivating a canceled subscription directly via transition', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData();
    const user = await userService.createUser(email, password!);
    const sub = await subscriptionService.subscribe(user.id, 'basic', 9.99);

    const canceled = await subscriptionService.cancel(user.id);
    expect(canceled.state).toBe('canceled');

    // API should reject direct transition back to active
    await expect(
      subscriptionService.transitionState(sub.id, 'canceled', 'active'),
    ).rejects.toThrow(/Invalid transition/);
  });

  test('should prevent transition from past_due directly to canceled via trial', async ({
    subscriptionService,
  }) => {
    expect(() => {
      subscriptionService.validateTransition('trial', 'past_due');
    }).toThrow(/Invalid transition/);

    expect(() => {
      subscriptionService.validateTransition('canceled', 'trial');
    }).toThrow(/Invalid transition/);
  });
});
