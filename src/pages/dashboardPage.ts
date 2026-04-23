import { Page, expect } from '@playwright/test';
import { SubscriptionState } from '../types/api';

export class DashboardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('/dashboard');
    await expect(this.page).toHaveTitle(/Dashboard/);
  }

  async getSubscriptionStatus(): Promise<SubscriptionState> {
    const statusText = await this.page.locator('#subscription-status').textContent();
    expect(statusText).not.toBeNull();
    // Basic validation, more robust parsing might be needed depending on actual UI text
    if (statusText?.includes('Active')) return 'active';
    if (statusText?.includes('Canceled')) return 'canceled';
    if (statusText?.includes('Trial')) return 'trial';
    if (statusText?.includes('Inactive')) return 'inactive';
    if (statusText?.includes('Past Due')) return 'past_due';
    throw new Error('Unknown subscription status on dashboard.');
  }

  async expectSubscriptionStatus(expectedState: SubscriptionState): Promise<void> {
    const actualState = await this.getSubscriptionStatus();
    expect(actualState).toBe(expectedState);
  }

  async clickCancelSubscription(): Promise<void> {
    await this.page.getByRole('button', { name: 'Cancel Subscription' }).click();
    await this.page.getByRole('button', { name: 'Confirm Cancellation' }).click(); // Assuming a confirmation step
  }

  async expectCancellationSuccess(): Promise<void> {
    await expect(this.page.locator('.success-message')).toContainText('Subscription canceled successfully.');
    await this.expectSubscriptionStatus('canceled');
  }
}
