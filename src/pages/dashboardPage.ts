import { Page, Locator, expect } from '@playwright/test';
import { SubscriptionState } from '../types/api';

/**
 * DashboardPage — Page Object for /dashboard
 *
 * Exposes every interactive element and readable piece of data on the
 * dashboard as a typed, reusable method.
 *
 * ## Selector strategy
 * - Prefer `data-testid` attributes (set by server.js) — stable, intent-clear
 * - Fall back to role-based selectors for interactive controls
 * - Never use CSS classes or positional selectors
 *
 * ## State coverage
 * Handles all 7 subscription states:
 *   inactive | trial | active | past_due | grace | expired | canceled
 */
export class DashboardPage {
  readonly page: Page;

  // ── Locators ───────────────────────────────────────────────────────────────
  readonly statusEl: Locator;
  readonly successMsg: Locator;
  readonly cancelBtn: Locator;
  readonly confirmCancelBtn: Locator;
  readonly cancelModal: Locator;
  readonly keepPlanBtn: Locator;
  readonly autoRenewToggle: Locator;
  readonly changePlanBtn: Locator;
  readonly resubscribeBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    this.statusEl        = page.locator('[data-testid="subscription-status"]');
    this.successMsg      = page.locator('[data-testid="success-msg"]');
    this.cancelBtn       = page.getByRole('button', { name: 'Cancel Subscription' });
    this.confirmCancelBtn = page.locator('#confirm-cancel-btn');
    this.cancelModal     = page.locator('#cancel-modal');
    this.keepPlanBtn     = page.getByRole('button', { name: 'Keep Plan' });
    this.autoRenewToggle = page.locator('#autorenew-toggle');
    this.changePlanBtn   = page.getByRole('link', { name: 'Change Plan' });
    this.resubscribeBtn  = page.getByRole('link', { name: 'Resubscribe' });
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async goto(): Promise<void> {
    await this.page.goto('/dashboard');
    await expect(this.page).toHaveTitle(/Dashboard/);
  }

  // ── Status reading ─────────────────────────────────────────────────────────

  /**
   * Reads the subscription state from the status element text.
   * Handles all 7 states: inactive, trial, active, past_due, grace, expired, canceled.
   */
  async getSubscriptionStatus(): Promise<SubscriptionState> {
    const text = (await this.statusEl.textContent()) ?? '';

    // Order matters — check multi-word labels first
    if (text.includes('Grace Period')) return 'grace';
    if (text.includes('Past Due'))     return 'past_due';
    if (text.includes('Canceled'))     return 'canceled';
    if (text.includes('Expired'))      return 'expired';
    if (text.includes('Active'))       return 'active';
    if (text.includes('Trial'))        return 'trial';
    if (text.includes('Inactive'))     return 'inactive';

    throw new Error(`[DashboardPage] Unknown subscription status text: "${text}"`);
  }

  /**
   * Asserts the displayed subscription status matches the expected state.
   */
  async expectSubscriptionStatus(expectedState: SubscriptionState): Promise<void> {
    // Wait for element to be visible before reading
    await expect(this.statusEl).toBeVisible();
    const actual = await this.getSubscriptionStatus();
    expect(actual).toBe(expectedState);
  }

  // ── Date info reading ──────────────────────────────────────────────────────

  /**
   * Returns the text of the trial end date badge if visible, otherwise null.
   * Example: "Ends Apr 30, 2025"
   */
  async getTrialEndBadgeText(): Promise<string | null> {
    const badge = this.page.locator('.badge-trial');
    const visible = await badge.isVisible({ timeout: 2000 }).catch(() => false);
    return visible ? (await badge.textContent())?.trim() ?? null : null;
  }

  /**
   * Returns the text of the grace period deadline badge if visible, otherwise null.
   * Example: "Deadline May 2, 2025"
   */
  async getGracePeriodBadgeText(): Promise<string | null> {
    const badge = this.page.locator('.badge-grace');
    const visible = await badge.isVisible({ timeout: 2000 }).catch(() => false);
    return visible ? (await badge.textContent())?.trim() ?? null : null;
  }

  /**
   * Reads the displayed billing info rows from the status card.
   * Returns an object with whichever rows are currently rendered.
   */
  async getBillingInfo(): Promise<{ nextBilling?: string; accessUntil?: string; cycleStarted?: string; paymentDueBy?: string }> {
    const rows = this.page.locator('.info-row');
    const count = await rows.count();
    const result: Record<string, string> = {};

    for (let i = 0; i < count; i++) {
      const row  = rows.nth(i);
      const text = (await row.textContent()) ?? '';
      if (text.includes('Next billing'))  result.nextBilling  = text.split('Next billing')[1]?.trim();
      if (text.includes('Access until'))  result.accessUntil  = text.split('Access until')[1]?.trim();
      if (text.includes('Cycle started')) result.cycleStarted = text.split('Cycle started')[1]?.trim();
      if (text.includes('Payment due by')) result.paymentDueBy = text.split('Payment due by')[1]?.trim();
    }

    return result;
  }

  // ── Auto-Renew toggle ──────────────────────────────────────────────────────

  /**
   * Returns the current state of the auto-renew toggle.
   * Throws if the toggle is not present (e.g., subscription is canceled).
   */
  async getAutoRenewState(): Promise<boolean> {
    await expect(this.autoRenewToggle).toBeAttached();
    return this.autoRenewToggle.isChecked();
  }

  /**
   * Clicks the auto-renew toggle to flip it, then waits for the page
   * to reload with the confirmation success message.
   */
  async toggleAutoRenew(): Promise<void> {
    await expect(this.autoRenewToggle).toBeAttached();
    // The checkbox is visually hidden (width:0, height:0), so clicking it natively fails.
    // We click the parent <label> wrapper instead, which mimics real user interaction.
    await this.autoRenewToggle.locator('..').click();
    // The toggle submits a form — wait for page reload
    await this.page.waitForLoadState('domcontentloaded');
    await expect(this.successMsg).toContainText('Auto-renew setting updated.');
  }

  // ── Cancellation flow ──────────────────────────────────────────────────────

  /**
   * Opens the cancellation confirmation modal.
   */
  async openCancelModal(): Promise<void> {
    await this.cancelBtn.click();
    await expect(this.cancelModal).toBeVisible();
  }

  /**
   * Dismisses the cancel modal without canceling.
   */
  async dismissCancelModal(): Promise<void> {
    await this.keepPlanBtn.click();
    await expect(this.cancelModal).not.toBeVisible();
  }

  /**
   * Clicks Cancel → Confirm. Use for full cancellation flow.
   */
  async clickCancelSubscription(): Promise<void> {
    await this.openCancelModal();
    await this.confirmCancelBtn.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Asserts the cancellation success banner is shown and status is canceled.
   */
  async expectCancellationSuccess(): Promise<void> {
    await expect(this.successMsg).toContainText('Subscription canceled successfully.');
    await this.expectSubscriptionStatus('canceled');
  }

  // ── Plan change ────────────────────────────────────────────────────────────

  /**
   * Clicks the "Change Plan" link — navigates to /pricing.
   */
  async clickChangePlan(): Promise<void> {
    await expect(this.changePlanBtn).toBeVisible();
    await this.changePlanBtn.click();
    await this.page.waitForURL('**/pricing');
  }

  /**
   * Clicks "Resubscribe" — shown for canceled/expired subs, navigates to /pricing.
   */
  async clickResubscribe(): Promise<void> {
    await expect(this.resubscribeBtn).toBeVisible();
    await this.resubscribeBtn.click();
    await this.page.waitForURL('**/pricing');
  }

  // ── Visibility assertions ──────────────────────────────────────────────────

  /** Asserts the auto-renew toggle is present on the page. */
  async expectAutoRenewToggleVisible(): Promise<void> {
    await expect(this.autoRenewToggle).toBeAttached();
  }

  /** Asserts the auto-renew toggle is NOT present (e.g., canceled subscription). */
  async expectAutoRenewToggleHidden(): Promise<void> {
    await expect(this.autoRenewToggle).not.toBeAttached();
  }

  /** Asserts the Change Plan button is visible (active or trial state). */
  async expectChangePlanVisible(): Promise<void> {
    await expect(this.changePlanBtn).toBeVisible();
  }

  /** Asserts the Resubscribe button is visible (canceled or expired state). */
  async expectResubscribeVisible(): Promise<void> {
    await expect(this.resubscribeBtn).toBeVisible();
  }

  /** Asserts the grace period warning row is displayed. */
  async expectGracePeriodWarningVisible(): Promise<void> {
    await expect(this.page.locator('.info-row').filter({ hasText: 'Payment due by' })).toBeVisible();
  }
}
