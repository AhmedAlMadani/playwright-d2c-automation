import { Page, expect } from '@playwright/test';

export class LandingPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page).toHaveTitle(/Welcome/);
  }

  async clickSignUp(): Promise<void> {
    await this.page.getByRole('link', { name: 'Sign Up' }).click();
  }

  async clickLogin(): Promise<void> {
    await this.page.getByRole('link', { name: 'Login' }).click();
  }
}
