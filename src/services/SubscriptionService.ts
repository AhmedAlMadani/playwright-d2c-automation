import { APIRequestContext } from '@playwright/test';
import { SubscriptionService as SubscriptionApiService } from '../api/subscriptionService';
import { Subscription, SubscriptionState, Payment, ApiResponse } from '../types/api';
import { Logger } from '../utils/logger';
import { TimeService } from '../utils/TimeService';
import { BillingCalculator } from '../utils/BillingCalculator';

// ── State machine ──────────────────────────────────────────────────────────────

/**
 * Full valid-transition map for the subscription state machine.
 *
 * inactive  → trial, active
 * trial     → active, expired, canceled
 * active    → past_due, canceled
 * past_due  → grace, canceled
 * grace     → active (retry success), canceled (exhausted)
 * expired   → [] (terminal)
 * canceled  → [] (terminal)
 */
const VALID_TRANSITIONS: Record<SubscriptionState, SubscriptionState[]> = {
  inactive: ['trial', 'active'],
  trial:    ['active', 'expired', 'canceled'],
  active:   ['past_due', 'canceled'],
  past_due: ['grace', 'canceled'],
  grace:    ['active', 'canceled'],
  expired:  [],
  canceled: [],
};

/**
 * SubscriptionService — Business-logic layer for subscription operations.
 *
 * This class owns:
 *  - State-machine validation (VALID_TRANSITIONS)
 *  - Trial lifecycle (start, convert, expire)
 *  - Grace period & payment retry logic
 *  - Plan upgrade / downgrade / mid-cycle change
 *  - Auto-renewal orchestration
 *
 * It does NOT own:
 *  - Raw DB access (ApiClient handles that)
 *  - Payment recording (BillingService handles that)
 *  - Test orchestration (tests import from fixtures)
 */
export class SubscriptionService {
  private readonly subscriptionApi: SubscriptionApiService;

  constructor(requestContext: APIRequestContext, baseUrl: string) {
    this.subscriptionApi = new SubscriptionApiService(requestContext, baseUrl);
  }

  // ── Core (existing — signatures unchanged) ────────────────────────────────

  async subscribe(userId: string, planId: string, price: number, currency = 'USD'): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Subscribing user ${userId} to plan ${planId}`);
    const response = await this.subscriptionApi.createSubscription(userId, planId, price, currency);
    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] Subscription creation failed: ${response.message}`);
    }
    Logger.info(`[SubscriptionService] Subscription created: ${response.data.id} (state: ${response.data.state})`);
    return response.data;
  }

  async getStatus(userId: string): Promise<Subscription | null> {
    Logger.info(`[SubscriptionService] Getting status for user: ${userId}`);
    const response = await this.subscriptionApi.getSubscriptionStatus(userId);
    if (!response.success || !response.data) {
      Logger.warn(`[SubscriptionService] No subscription found for user: ${userId}`);
      return null;
    }
    return response.data;
  }

  async cancel(userId: string): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Canceling subscription for user: ${userId}`);
    const response = await this.subscriptionApi.cancelSubscription(userId);
    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] Cancellation failed: ${response.message}`);
    }
    Logger.info(`[SubscriptionService] Subscription canceled: ${response.data.id}`);
    return response.data;
  }

  validateTransition(from: SubscriptionState, to: SubscriptionState): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error(
        `[SubscriptionService] Invalid transition: "${from}" → "${to}". ` +
        `Allowed from "${from}": [${allowed.join(', ') || 'none'}]`,
      );
    }
  }

  async transitionState(
    subscriptionId: string,
    currentState: SubscriptionState,
    targetState: SubscriptionState,
  ): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Transition ${subscriptionId}: ${currentState} → ${targetState}`);
    this.validateTransition(currentState, targetState);
    const response: ApiResponse<Subscription> = await this.subscriptionApi.updateSubscriptionState(subscriptionId, targetState);
    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] State transition failed: ${response.message}`);
    }
    return response.data;
  }

  // ── Trial lifecycle ───────────────────────────────────────────────────────

  /**
   * Starts a free trial for a user.
   * Throws if the user already has any subscription (trial reuse prevention).
   */
  async startTrial(
    userId: string,
    planId: string,
    price: number,
    trialDays = BillingCalculator.DEFAULT_TRIAL_DAYS,
  ): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Starting ${trialDays}-day trial for user ${userId} (plan: ${planId})`);

    // Prevent trial reuse
    const existing = await this.getStatus(userId);
    if (existing) {
      throw new Error(
        `[SubscriptionService] Trial reuse rejected: user ${userId} already has a subscription in state "${existing.state}".`,
      );
    }

    const response = await this.subscriptionApi.createTrialSubscription(userId, planId, price, trialDays);
    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] Trial creation failed: ${response.message}`);
    }

    Logger.info(`[SubscriptionService] Trial started: ${response.data.id} (ends: ${response.data.trialEndsAt})`);
    return response.data;
  }

  /**
   * Converts a trial to active. Records first billing charge.
   * Throws if the trial has already expired.
   */
  async convertTrialToActive(userId: string, price: number, idempotencyKey?: string): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Converting trial to active for user ${userId}`);

    const sub = await this._requireSubscription(userId, 'trial');

    if (BillingCalculator.isTrialExpired(sub.trialEndsAt)) {
      throw new Error(`[SubscriptionService] Cannot convert: trial for user ${userId} has already expired.`);
    }

    // Transition state
    const active = await this.transitionState(sub.id, 'trial', 'active');

    // Patch billing fields
    const now = TimeService.nowIso();
    const renewsAt = TimeService.isoFromNow(BillingCalculator.DEFAULT_PERIOD_DAYS);
    await this.subscriptionApi.patchSubscription(sub.id, {
      billing_cycle_start: now,
      renews_at: renewsAt,
      trial_ends_at: null,
    });

    // Record first payment
    const key = idempotencyKey ?? BillingCalculator.generateIdempotencyKey(userId, sub.id, 1, 'trial-convert');
    await this.subscriptionApi.recordPayment(userId, sub.id, price, 'success', key);

    Logger.info(`[SubscriptionService] Trial converted to active: ${sub.id}`);
    return { ...active, renewsAt, billingCycleStart: now, trialEndsAt: null };
  }

  /**
   * Marks a trial as expired. Throws if trial hasn't actually ended yet.
   */
  async expireTrial(userId: string): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Expiring trial for user ${userId}`);

    const sub = await this._requireSubscription(userId, 'trial');

    if (!BillingCalculator.isTrialExpired(sub.trialEndsAt)) {
      throw new Error(
        `[SubscriptionService] Trial for user ${userId} has not expired yet ` +
        `(ends: ${sub.trialEndsAt}, now: ${TimeService.nowIso()}).`,
      );
    }

    return this.transitionState(sub.id, 'trial', 'expired');
  }

  // ── Auto-renewal ──────────────────────────────────────────────────────────

  /**
   * Processes auto-renewal for a user. Charges the subscription price,
   * updates renewsAt, and records the renewal payment.
   * Throws if autoRenew is disabled or renewal is not yet due.
   */
  async processAutoRenewal(userId: string, idempotencyKey?: string): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Processing auto-renewal for user ${userId}`);

    const sub = await this._requireSubscription(userId, 'active');

    if (!sub.autoRenew) {
      throw new Error(`[SubscriptionService] Auto-renew is disabled for subscription ${sub.id}.`);
    }

    if (!BillingCalculator.isRenewalDue(sub.renewsAt)) {
      throw new Error(
        `[SubscriptionService] Renewal not yet due for subscription ${sub.id} ` +
        `(renews_at: ${sub.renewsAt}).`,
      );
    }

    // Compute new renewal date
    const newCycleStart = TimeService.nowIso();
    const newRenewsAt   = TimeService.isoFromNow(BillingCalculator.DEFAULT_PERIOD_DAYS);

    // Record renewal payment (idempotent by billingCycleStart)
    const key = idempotencyKey
      ?? BillingCalculator.renewalIdempotencyKey(userId, sub.id, sub.billingCycleStart ?? newCycleStart);
    await this.subscriptionApi.recordPayment(userId, sub.id, sub.price, 'success', key);

    // Update subscription dates
    const response = await this.subscriptionApi.patchSubscription(sub.id, {
      billing_cycle_start: newCycleStart,
      renews_at: newRenewsAt,
    });

    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] Failed to update renewal dates: ${response.message}`);
    }

    Logger.info(`[SubscriptionService] Renewal processed for ${sub.id}. Next renewal: ${newRenewsAt}`);
    return response.data;
  }

  /**
   * Toggles auto-renewal on or off for a user's subscription.
   */
  async toggleAutoRenew(userId: string, value: boolean): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Setting autoRenew=${value} for user ${userId}`);

    const sub = await this._requireSubscription(userId);
    
    if (['canceled', 'expired'].includes(sub.state)) {
      throw new Error(`[SubscriptionService] Cannot modify auto-renew: subscription is in "${sub.state}" state (not active).`);
    }
    
    const response = await this.subscriptionApi.patchSubscription(sub.id, { auto_renew: value });

    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] toggleAutoRenew failed: ${response.message}`);
    }

    return response.data;
  }

  // ── Grace period ──────────────────────────────────────────────────────────

  /**
   * Moves a past_due subscription into a grace period window.
   */
  async enterGracePeriod(
    userId: string,
    graceDays = BillingCalculator.DEFAULT_GRACE_DAYS,
  ): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Entering grace period (${graceDays}d) for user ${userId}`);

    const sub = await this._requireSubscription(userId, 'past_due');
    this.validateTransition('past_due', 'grace');

    const gracePeriodEndsAt = BillingCalculator.gracePeriodEndDate(graceDays).toISOString();

    // Single atomic write: state + grace deadline together
    const response = await this.subscriptionApi.patchSubscription(sub.id, {
      state: 'grace',
      grace_period_ends_at: gracePeriodEndsAt,
    });

    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] Failed to enter grace period: ${response.message}`);
    }

    Logger.info(`[SubscriptionService] Grace period ends: ${gracePeriodEndsAt}`);
    return response.data;
  }

  /**
   * Resolves a grace period with a successful retry payment.
   * Transitions grace → active.
   */
  async resolveGracePeriod(userId: string, idempotencyKey?: string): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Resolving grace period for user ${userId}`);

    const sub = await this._requireSubscription(userId, 'grace');
    this.validateTransition('grace', 'active');

    // Record successful retry payment
    const key = idempotencyKey ?? BillingCalculator.generateIdempotencyKey(userId, sub.id, 1, 'retry');
    await this.subscriptionApi.recordPayment(userId, sub.id, sub.price, 'success', key);

    // Single atomic write: state + clear grace + reset billing
    const response = await this.subscriptionApi.patchSubscription(sub.id, {
      state: 'active',
      grace_period_ends_at: null,
      billing_cycle_start: TimeService.nowIso(),
      renews_at: TimeService.isoFromNow(BillingCalculator.DEFAULT_PERIOD_DAYS),
    });

    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] Failed to resolve grace period: ${response.message}`);
    }

    Logger.info(`[SubscriptionService] Grace period resolved: subscription ${sub.id} is now active.`);
    return response.data;
  }

  /**
   * Exhausts grace period retries and cancels the subscription.
   * Throws if grace period hasn't expired yet.
   */
  async exhaustGracePeriod(userId: string): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Exhausting grace period for user ${userId}`);

    const sub = await this._requireSubscription(userId, 'grace');

    if (!BillingCalculator.isGracePeriodExpired(sub.gracePeriodEndsAt)) {
      throw new Error(
        `[SubscriptionService] Grace period for ${sub.id} has not expired yet ` +
        `(ends: ${sub.gracePeriodEndsAt}).`,
      );
    }

    return this.transitionState(sub.id, 'grace', 'canceled');
  }

  // ── Plan changes ──────────────────────────────────────────────────────────

  /**
   * Upgrades a user's plan immediately with prorated billing.
   * Throws if newPlanId is not actually an upgrade.
   */
  async upgradePlan(
    userId: string,
    newPlanId: string,
    newPrice: number,
    idempotencyKey?: string,
  ): Promise<{ subscription: Subscription; proratedCharge: number }> {
    Logger.info(`[SubscriptionService] Upgrading plan to "${newPlanId}" for user ${userId}`);

    const sub = await this._requireSubscription(userId);
    const cancelableStates: SubscriptionState[] = ['canceled', 'expired'];
    if (cancelableStates.includes(sub.state)) {
      throw new Error(`[SubscriptionService] Cannot upgrade subscription in "${sub.state}" state.`);
    }

    if (newPlanId === sub.planId) {
      throw new Error(`[SubscriptionService] Already on plan "${newPlanId}".`);
    }

    // Compute proration
    const daysRemaining = BillingCalculator.daysRemainingInCycle(sub.billingCycleStart);
    const proratedCharge = BillingCalculator.computeProration(
      sub.price, newPrice, daysRemaining,
    );

    // Patch plan and price immediately
    const response = await this.subscriptionApi.patchSubscription(sub.id, {
      plan: newPlanId,
      amount: newPrice,
    });

    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] Plan upgrade failed: ${response.message}`);
    }

    // Charge prorated amount if any
    if (proratedCharge > 0) {
      const key = idempotencyKey ?? BillingCalculator.generateIdempotencyKey(userId, sub.id, daysRemaining, 'upgrade');
      await this.subscriptionApi.recordPayment(userId, sub.id, proratedCharge, 'success', key);
      Logger.info(`[SubscriptionService] Prorated charge: $${proratedCharge} (${daysRemaining} days remaining)`);
    }

    Logger.info(`[SubscriptionService] Plan upgraded to "${newPlanId}": subscription ${sub.id}`);
    return { subscription: response.data, proratedCharge };
  }

  /**
   * Downgrades a user's plan immediately. No charge is recorded.
   */
  async downgradePlan(userId: string, newPlanId: string, newPrice: number): Promise<Subscription> {
    Logger.info(`[SubscriptionService] Downgrading plan to "${newPlanId}" for user ${userId}`);

    const sub = await this._requireSubscription(userId, 'active');

    if (newPlanId === sub.planId) {
      throw new Error(`[SubscriptionService] Already on plan "${newPlanId}".`);
    }

    if (newPrice >= sub.price) {
      throw new Error(
        `[SubscriptionService] Downgrade requires a lower price. ` +
        `Current: $${sub.price}, new: $${newPrice}.`,
      );
    }

    const response = await this.subscriptionApi.patchSubscription(sub.id, {
      plan: newPlanId,
      amount: newPrice,
    });

    if (!response.success || !response.data) {
      throw new Error(`[SubscriptionService] Plan downgrade failed: ${response.message}`);
    }

    Logger.info(`[SubscriptionService] Plan downgraded to "${newPlanId}": subscription ${sub.id}`);
    return response.data;
  }

  /**
   * Mid-cycle plan change: upgrades or downgrades depending on price comparison.
   */
  async changePlanMidCycle(
    userId: string,
    newPlanId: string,
    newPrice: number,
    idempotencyKey?: string,
  ): Promise<{ subscription: Subscription; proratedCharge: number }> {
    const sub = await this._requireSubscription(userId);

    if (BillingCalculator.isUpgrade(sub.planId, newPlanId)) {
      return this.upgradePlan(userId, newPlanId, newPrice, idempotencyKey);
    }

    const downgraded = await this.downgradePlan(userId, newPlanId, newPrice);
    return { subscription: downgraded, proratedCharge: 0 };
  }

  // ── Payment history ───────────────────────────────────────────────────────

  async getPaymentHistory(userId: string): Promise<Payment[]> {
    Logger.info(`[SubscriptionService] Getting payment history for user ${userId}`);
    const response = await this.subscriptionApi.getPayments(userId);
    if (!response.success || !response.data) {
      Logger.warn(`[SubscriptionService] No payments found for user ${userId}`);
      return [];
    }
    return response.data;
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  static getValidTransitions(): Record<SubscriptionState, SubscriptionState[]> {
    return VALID_TRANSITIONS;
  }

  static getTerminalStates(): SubscriptionState[] {
    return (Object.entries(VALID_TRANSITIONS) as [SubscriptionState, SubscriptionState[]][])
      .filter(([, targets]) => targets.length === 0)
      .map(([state]) => state);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Fetches subscription and asserts it exists and is in an expected state.
   */
  private async _requireSubscription(userId: string, expectedState?: SubscriptionState): Promise<Subscription> {
    const sub = await this.getStatus(userId);
    if (!sub) {
      throw new Error(`[SubscriptionService] Subscription not found for user ${userId}.`);
    }
    if (expectedState && sub.state !== expectedState) {
      throw new Error(
        `[SubscriptionService] Expected subscription in "${expectedState}" state, ` +
        `but found "${sub.state}" for user ${userId}.`,
      );
    }
    return sub;
  }
}
