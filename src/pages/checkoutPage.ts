import { Page, expect } from '@playwright/test';

export class CheckoutPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(planId: string): Promise<void> {
    await this.page.goto(`/checkout?plan=${planId}`);
    await expect(this.page).toHaveTitle(/Checkout/);
  }

  async fillPaymentDetails(cardNumber: string, expiry: string, cvv: string): Promise<void> {
    // Mocking payment details input
    await this.page.getByLabel('Card Number').fill(cardNumber);
    await this.page.getByLabel('Expiry Date').fill(expiry);
    await this.page.getByLabel('CVV').fill(cvv);
  }

  async completePurchase(): Promise<void> {
    await this.page.getByRole('button', { name: 'Complete Purchase' }).click();
  }

  async expectPurchaseSuccess(): Promise<void> {
    await expect(this.page).toHaveURL(/dashboard/);
    await expect(this.page.locator('.success-message')).toContainText('Subscription activated!');
  }

  async expectPurchaseFailure(errorMessage: string): Promise<void> {
    await expect(this.page.locator('.error-message')).toContainText(errorMessage);
  }
}
