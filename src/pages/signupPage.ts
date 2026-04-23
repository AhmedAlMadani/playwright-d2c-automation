import { Page, expect } from '@playwright/test';
import { User } from '../types/api';

export class SignupPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('/signup');
    await expect(this.page).toHaveTitle(/Sign Up/);
  }

  async signup(user: User): Promise<void> {
    await this.page.getByLabel('Email').fill(user.email);
    await this.page.getByLabel('Password', { exact: true }).fill(user.password ?? 'password123'); // Assuming a default password if not provided
    await this.page.getByLabel('Confirm Password').fill(user.password ?? 'password123');
    await this.page.getByRole('button', { name: 'Sign Up' }).click();
  }

  async expectSignupSuccess(): Promise<void> {
    await expect(this.page).toHaveURL(/dashboard|pricing/); // Redirect to dashboard or pricing after signup
  }

  async expectSignupFailure(errorMessage: string): Promise<void> {
    await expect(this.page.locator('.error-message')).toContainText(errorMessage);
  }
}
