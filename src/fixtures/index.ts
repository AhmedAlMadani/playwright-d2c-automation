import { test as base, expect } from '@playwright/test';
import { LandingPage } from '../pages/landingPage';
import { SignupPage } from '../pages/signupPage';
import { PricingPage } from '../pages/pricingPage';
import { CheckoutPage } from '../pages/checkoutPage';
import { DashboardPage } from '../pages/dashboardPage';
import { UserService } from '../services/UserService';
import { SubscriptionService } from '../services/SubscriptionService';
import { BillingService } from '../services/BillingService';
import { DataFactory } from '../utils/dataFactory';
import { Logger } from '../utils/logger';
import { TimeService } from '../utils/TimeService';
import { BillingCalculator } from '../utils/BillingCalculator';
import { ConsistencyValidator } from '../utils/ConsistencyValidator';
import { config } from '../config/environment';

/**
 * Custom fixture interface extending Playwright's base test fixtures.
 * Every test gets pre-wired page objects, services, and utilities.
 */
export interface D2CFixtures {
  // Page Objects
  landingPage: LandingPage;
  signupPage: SignupPage;
  pricingPage: PricingPage;
  checkoutPage: CheckoutPage;
  dashboardPage: DashboardPage;

  // Business Services
  userService: UserService;
  subscriptionService: SubscriptionService;
  billingService: BillingService;

  // Utilities
  dataFactory: typeof DataFactory;
  logger: typeof Logger;
  timeService: typeof TimeService;
  billingCalculator: typeof BillingCalculator;
  consistencyValidator: typeof ConsistencyValidator;
}

/**
 * Extended test instance with all D2C fixtures auto-injected.
 * Import { test, expect } from here instead of @playwright/test in all specs.
 */
export const test = base.extend<D2CFixtures>({
  // ─── Page Objects ───────────────────────────────────────────────────────────
  landingPage: async ({ page }, use) => {
    await use(new LandingPage(page));
  },

  signupPage: async ({ page }, use) => {
    await use(new SignupPage(page));
  },

  pricingPage: async ({ page }, use) => {
    await use(new PricingPage(page));
  },

  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },

  // ─── Business Services ───────────────────────────────────────────────────────
  userService: async ({ request }, use) => {
    await use(new UserService(request, config.apiUrl));
  },

  subscriptionService: async ({ request }, use) => {
    await use(new SubscriptionService(request, config.apiUrl));
  },

  billingService: async ({ request }, use) => {
    await use(new BillingService(request, config.apiUrl));
  },

  // ─── Utilities (injected as class references — static methods only) ─────────
  dataFactory: async ({ }, use) => {
    await use(DataFactory);
  },

  logger: async ({ }, use) => {
    await use(Logger);
  },

  timeService: async ({ }, use) => {
    await use(TimeService);
  },

  billingCalculator: async ({ }, use) => {
    await use(BillingCalculator);
  },

  consistencyValidator: async ({ }, use) => {
    await use(ConsistencyValidator);
  },
});

/**
 * Shared beforeEach hook: reset virtual clock before every test.
 *
 * TimeService.reset() ensures a frozen/advanced clock from one test never
 * bleeds into the next — critical for time-based transition tests.
 * Note: Database is cleaned ONCE in global.setup.ts, not here.
 */
test.beforeEach(async () => {
  TimeService.reset();
  Logger.debug('[Fixtures] Clock reset for test isolation.');
});

export { expect };
