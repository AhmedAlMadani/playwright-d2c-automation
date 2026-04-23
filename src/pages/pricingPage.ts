import { Page, expect } from '@playwright/test';

export class PricingPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('/pricing');
    await expect(this.page).toHaveTitle(/Pricing/);
  }

  async selectPlan(planName: string): Promise<void> {
    await this.page.getByRole('button', { name: `Select ${planName}` }).click();
  }

  async expectPlanSelected(planName: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`checkout.*plan=${planName.toLowerCase()}`));
  }
}
