import { APIRequestContext } from '@playwright/test';
import { ApiClient } from './apiClient';
import { Subscription, SubscriptionState, Payment, PaymentStatus, ApiResponse, SubscriptionPatch } from '../types/api';
import { Logger } from '../utils/logger';

/**
 * SubscriptionService (API layer) — thin delegation layer over ApiClient.
 *
 * Every public method is a named, documented wrapper around the corresponding
 * protected ApiClient method. No business logic lives here.
 */
export class SubscriptionService extends ApiClient {
  constructor(requestContext: APIRequestContext, baseUrl: string) {
    super(requestContext, baseUrl);
  }

  // ── Subscription CRUD ──────────────────────────────────────────────────────

  async createSubscription(userId: string, planId: string, price: number, currency: string): Promise<ApiResponse<Subscription>> {
    Logger.debug(`[SubscriptionService-API] Creating subscription for user ${userId} with plan ${planId}`);
    return this.mockCreateSubscription(userId, planId, price, currency);
  }

  async createTrialSubscription(userId: string, planId: string, price: number, trialDays: number): Promise<ApiResponse<Subscription>> {
    Logger.debug(`[SubscriptionService-API] Creating trial (${trialDays}d) for user ${userId} plan ${planId}`);
    return this.mockCreateTrialSubscription(userId, planId, price, trialDays);
  }

  async getSubscriptionStatus(userId: string): Promise<ApiResponse<Subscription>> {
    Logger.debug(`[SubscriptionService-API] Getting subscription status for user ${userId}`);
    return this.mockGetSubscription(userId);
  }

  async cancelSubscription(userId: string): Promise<ApiResponse<Subscription>> {
    Logger.debug(`[SubscriptionService-API] Cancelling subscription for user ${userId}`);
    return this.mockCancelSubscription(userId);
  }

  async updateSubscriptionState(subscriptionId: string, newState: SubscriptionState): Promise<ApiResponse<Subscription>> {
    Logger.debug(`[SubscriptionService-API] Updating subscription ${subscriptionId} to state ${newState}`);
    return this.mockUpdateSubscriptionState(subscriptionId, newState);
  }

  async patchSubscription(
    subscriptionId: string,
    patch: SubscriptionPatch,
  ): Promise<ApiResponse<Subscription>> {
    Logger.debug(`[SubscriptionService-API] Patching subscription ${subscriptionId}`);
    return this.mockPatchSubscription(subscriptionId, patch);
  }

  // ── Payment Operations ─────────────────────────────────────────────────────

  async recordPayment(
    userId: string,
    subscriptionId: string | null,
    amount: number,
    status: PaymentStatus,
    idempotencyKey?: string,
  ): Promise<ApiResponse<Payment>> {
    Logger.debug(`[SubscriptionService-API] Recording ${status} payment for user ${userId} amount ${amount}`);
    return this.mockRecordPayment(userId, subscriptionId, amount, status, idempotencyKey);
  }

  async getPayments(userId: string): Promise<ApiResponse<Payment[]>> {
    Logger.debug(`[SubscriptionService-API] Getting payment history for user ${userId}`);
    return this.mockGetPayments(userId);
  }
}
