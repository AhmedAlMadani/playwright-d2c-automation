import { test as base, expect } from '@playwright/test';
import { LandingPage } from '../pages/landingPage';
import { SignupPage } from '../pages/signupPage';
import { PricingPage } from '../pages/pricingPage';
import { CheckoutPage } from '../pages/checkoutPage';
import { DashboardPage } from '../pages/dashboardPage';
import { UserService } from '../services/UserService';
import { SubscriptionService } from '../services/SubscriptionService';
import { DataFactory } from '../utils/dataFactory';
import { Logger } from '../utils/logger';
import { cleanDatabase } from '../db/dbCleanup';
import { config } from '../config/environment';

/**
 * Custom fixture interface extending Playwright's base test fixtures.
 * Every test gets pre-wired page objects and services for free.
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

  // Utilities
  dataFactory: typeof DataFactory;
  logger: typeof Logger;
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

  // ─── Utilities ───────────────────────────────────────────────────────────────
  dataFactory: async ({}, use) => {
    await use(DataFactory);
  },

  logger: async ({}, use) => {
    await use(Logger);
  },
});

/**
 * Shared beforeEach hook: clean the Supabase database before every test
 * so tests are completely isolated with no shared state.
 */
test.beforeEach(async () => {
  await cleanDatabase();
  Logger.debug('[Fixtures] Database cleaned for test isolation.');
});

export { expect };

