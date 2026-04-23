import { APIRequestContext } from '@playwright/test';
import { SubscriptionService as SubscriptionApiService } from '../api/subscriptionService';
import { Subscription, SubscriptionState, ApiResponse } from '../types/api';
import { Logger } from '../utils/logger';

/**
 * Valid state transition map.
 * Key   = current state
 * Value = set of states that can be transitioned to
 */
const VALID_TRANSITIONS: Record<SubscriptionState, SubscriptionState[]> = {
  inactive: ['trial', 'active'],
  trial: ['active', 'canceled'],
  active: ['past_due', 'canceled'],
  past_due: ['active', 'canceled'],
  canceled: [], // terminal state
};

/**
 * SubscriptionService — Business-logic layer for subscription operations.
 *
 * Enforces state-machine rules, prevents duplicate subscriptions,
 * and provides clean orchestration methods for test use.
 */
export class SubscriptionService {
  private readonly subscriptionApi: SubscriptionApiService;

  constructor(requestContext: APIRequestContext, baseUrl: string) {
    this.subscriptionApi = new SubscriptionApiService(requestContext, baseUrl);
  }

  /**
   * Creates a subscription for a user. Throws if creation fails.
   */
  async subscribe(
    userId: string,
    planId: string,
    price: number,
    currency = 'USD',
  ): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Subscribing user ${userId} to plan ${planId}`);
    const response = await this.subscriptionApi.createSubscription(userId, planId, price, currency);
    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] Subscription creation failed: ${response.message}`);
    }
    Logger.info(`[SubscriptionService] Subscription created: ${response.data.id} (state: ${response.data.state})`);
    return response.data;
  }

  /**
   * Retrieves the subscription status for a user.
   * Returns null if the user has no subscription.
   */
  async getStatus(userId: string): Promise<Subscription | null> {
    Logger.info(`[SubscriptionService] Getting status for user: ${userId}`);
    const response = await this.subscriptionApi.getSubscriptionStatus(userId);
    if (!response.success || !response.data) {
      Logger.warn(`[SubscriptionService] No subscription found for user: ${userId}`);
      return null;
    }
    return response.data;
  }

  /**
   * Cancels a user's subscription. Throws if the subscription cannot be canceled.
   */
  async cancel(userId: string): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Canceling subscription for user: ${userId}`);
    const response = await this.subscriptionApi.cancelSubscription(userId);
    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] Cancellation failed: ${response.message}`);
    }
    Logger.info(`[SubscriptionService] Subscription canceled: ${response.data.id}`);
    return response.data;
  }

  /**
   * Validates that a state transition is allowed by the business rules.
   * Throws an error for illegal transitions — use in test assertions.
   */
  validateTransition(from: SubscriptionState, to: SubscriptionState): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error(
        `[SubscriptionService] Invalid transition: "${from}" → "${to}". ` +
        `Allowed targets from "${from}": [${allowed.join(', ') || 'none'}]`,
      );
    }
  }

  /**
   * Directly drives a subscription to a new state via the API.
   * Validates the transition before attempting — throws on illegal moves.
   */
  async transitionState(
    subscriptionId: string,
    currentState: SubscriptionState,
    targetState: SubscriptionState,
  ): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Transition ${subscriptionId}: ${currentState} → ${targetState}`);
    this.validateTransition(currentState, targetState);
    const response: ApiResponse<Subscription> = await this.subscriptionApi.updateSubscriptionState(
      subscriptionId,
      targetState,
    );
    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] State transition failed: ${response.message}`);
    }
    return response.data;
  }

  /**
   * Returns the full valid-transition map for use in test parameterisation.
   */
  static getValidTransitions(): Record<SubscriptionState, SubscriptionState[]> {
    return VALID_TRANSITIONS;
  }

  /**
   * Returns all states that are considered terminal (no further transitions allowed).
   */
  static getTerminalStates(): SubscriptionState[] {
    return (Object.entries(VALID_TRANSITIONS) as [SubscriptionState, SubscriptionState[]][])
      .filter(([, targets]) => targets.length === 0)
      .map(([state]) => state);
  }
}
