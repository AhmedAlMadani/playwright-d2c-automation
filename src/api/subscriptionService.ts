import { APIRequestContext } from '@playwright/test';
import { ApiClient } from './apiClient';
import { Subscription, ApiResponse, SubscriptionState } from '../types/api';

export class SubscriptionService extends ApiClient {
  constructor(requestContext: APIRequestContext, baseUrl: string) {
    super(requestContext, baseUrl);
  }

  async createSubscription(userId: string, planId: string, price: number, currency: string): Promise<ApiResponse<Subscription>> {
    console.log(`[SubscriptionService] Creating subscription for user ${userId} with plan ${planId}`);
    const response = await this.mockCreateSubscription(userId, planId, price, currency);
    return response;
  }

  async getSubscriptionStatus(userId: string): Promise<ApiResponse<Subscription>> {
    console.log(`[SubscriptionService] Getting subscription status for user ${userId}`);
    const response = await this.mockGetSubscription(userId);
    return response;
  }

  async cancelSubscription(userId: string): Promise<ApiResponse<Subscription>> {
    console.log(`[SubscriptionService] Cancelling subscription for user ${userId}`);
    const response = await this.mockCancelSubscription(userId);
    return response;
  }

  async updateSubscriptionState(subscriptionId: string, newState: SubscriptionState): Promise<ApiResponse<Subscription>> {
    console.log(`[SubscriptionService] Updating subscription ${subscriptionId} to state ${newState}`);
    const response = await this.mockUpdateSubscriptionState(subscriptionId, newState);
    return response;
  }
}
