import { APIRequestContext } from '@playwright/test';
import { ApiClient } from './apiClient';
import { User, Subscription, ApiResponse, SubscriptionState } from '../types/api';

export class UserService extends ApiClient {
  constructor(requestContext: APIRequestContext, baseUrl: string) {
    super(requestContext, baseUrl);
  }

  async createUser(email: string, password?: string): Promise<ApiResponse<User>> {
    // In a real scenario, this would be an actual API call
    // For now, we use the mock implementation from ApiClient
    console.log(`[UserService] Creating user: ${email}`);
    const response = await this.mockCreateUser(email, password);
    return response;
  }

  async getUser(identifier: { id?: string; email?: string }): Promise<ApiResponse<User>> {
    console.log(`[UserService] Getting user: ${identifier.id || identifier.email}`);
    const response = await this.mockGetUser(identifier);
    return response;
  }
}
