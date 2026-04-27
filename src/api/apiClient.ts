import { APIRequestContext } from '@playwright/test';
import { User, Subscription, SubscriptionState, ApiResponse, Payment, PaymentStatus, SubscriptionPatch } from '../types/api';
import { supabase } from '../db/supabaseClient';
import { TimeService } from '../utils/TimeService';
import { BillingCalculator } from '../utils/BillingCalculator';

/**
 * ApiClient — Storage-layer abstraction over Supabase.
 *
 * Responsibilities:
 *   - Execute raw Supabase queries (INSERT / SELECT / UPDATE / DELETE)
 *   - Map DB row shapes (snake_case) → TypeScript interfaces (camelCase)
 *   - Return structured ApiResponse<T> to callers
 *
 * What this layer does NOT do:
 *   - Business-logic (state-machine rules live in SubscriptionService)
 *   - Orchestration (test setup lives in the service layer)
 *   - Direct Supabase usage from outside this file
 *
 * Method signatures are IDENTICAL to the previous mock implementation so
 * every upstream caller (UserService, SubscriptionApiService, etc.) works
 * without modification.
 */
export class ApiClient {
  // Playwright request context is retained for future HTTP-based API calls
  protected request: APIRequestContext;
  protected baseUrl: string;

  constructor(requestContext: APIRequestContext, baseUrl: string) {
    this.request = requestContext;
    this.baseUrl = baseUrl;
  }

  // ── Row → Interface mappers ────────────────────────────────────────────────

  private mapUser(row: Record<string, unknown>): User {
    return {
      id: row.id as string,
      email: row.email as string,
      password: row.password as string | undefined,
      createdAt: row.created_at as string,
    };
  }

  private mapSubscription(row: Record<string, unknown>): Subscription {
    return {
      // Core (existing)
      id: row.id as string,
      userId: row.user_id as string,
      planId: row.plan as string,
      state: row.state as SubscriptionState,
      startDate: row.created_at as string,
      endDate: (row.updated_at && row.state === 'canceled')
        ? (row.updated_at as string)
        : null,
      price: (row.amount as number) ?? 0,
      currency: (row.currency as string) ?? 'USD',
      // Trial
      trialEndsAt: (row.trial_ends_at as string) ?? null,
      // Renewal
      renewsAt: (row.renews_at as string) ?? null,
      autoRenew: (row.auto_renew as boolean) ?? true,
      // Grace period
      gracePeriodEndsAt: (row.grace_period_ends_at as string) ?? null,
      // Mid-cycle
      billingCycleStart: (row.billing_cycle_start as string) ?? null,
    };
  }

  private mapPayment(row: Record<string, unknown>): Payment {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      subscriptionId: (row.subscription_id as string) ?? null,
      amount: row.amount as number,
      status: row.status as PaymentStatus,
      idempotencyKey: (row.idempotency_key as string) ?? null,
      createdAt: (row.created_at as string) ?? new Date().toISOString(),
    };
  }

  // ── User Operations ────────────────────────────────────────────────────────

  /**
   * Inserts a new user into Supabase.
   */
  protected async mockCreateUser(email: string, password?: string): Promise<ApiResponse<User>> {
    const { data, error } = await supabase
      .from('users')
      .insert({ email, password: password ?? '' })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return { success: false, message: 'User with this email already exists.' };
      }
      return { success: false, message: error.message };
    }

    return { success: true, data: this.mapUser(data as Record<string, unknown>) };
  }

  /**
   * Fetches a user by ID or email.
   */
  protected async mockGetUser(
    identifier: { id?: string; email?: string },
  ): Promise<ApiResponse<User>> {
    let query = supabase.from('users').select('*');

    if (identifier.id) {
      query = query.eq('id', identifier.id);
    } else if (identifier.email) {
      query = query.eq('email', identifier.email);
    } else {
      return { success: false, message: 'Must supply id or email.' };
    }

    const { data, error } = await query.single();

    if (error || !data) {
      return { success: false, message: 'User not found.' };
    }

    return { success: true, data: this.mapUser(data as Record<string, unknown>) };
  }

  // ── Subscription Operations ────────────────────────────────────────────────

  /**
   * Creates an immediately-active subscription + first payment record.
   */
  protected async mockCreateSubscription(
    userId: string,
    planId: string,
    price: number,
    _currency: string,
  ): Promise<ApiResponse<Subscription>> {
    const { data: userRow, error: userErr } = await supabase
      .from('users').select('id').eq('id', userId).single();

    if (userErr || !userRow) {
      return { success: false, message: 'User not found for subscription.' };
    }

    // Uniqueness constraint: reject if user already has an active subscription
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId)
      .in('state', ['active', 'trial', 'past_due', 'grace'])
      .limit(1).single();

    if (existing) {
      return { success: false, message: 'User already has an active subscription.' };
    }

    const now = TimeService.nowIso();
    const renewsAt = TimeService.isoFromNow(BillingCalculator.DEFAULT_PERIOD_DAYS);

    const { data: subRow, error: subErr } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        plan: planId,
        state: 'active',
        amount: price,
        currency: 'USD',
        auto_renew: true,
        billing_cycle_start: now,
        renews_at: renewsAt,
      })
      .select()
      .single();

    if (subErr || !subRow) {
      return { success: false, message: subErr?.message ?? 'Subscription creation failed.' };
    }

    await supabase.from('payments').insert({
      user_id: userId,
      subscription_id: (subRow as Record<string, unknown>).id,
      status: 'success',
      amount: price,
    });

    const sub = this.mapSubscription(subRow as Record<string, unknown>);
    sub.price = price;
    return { success: true, data: sub };
  }

  /**
   * Creates a trial subscription. No payment is recorded (free trial).
   */
  protected async mockCreateTrialSubscription(
    userId: string,
    planId: string,
    price: number,
    trialDays: number,
  ): Promise<ApiResponse<Subscription>> {
    const { data: userRow, error: userErr } = await supabase
      .from('users').select('id').eq('id', userId).single();

    if (userErr || !userRow) {
      return { success: false, message: 'User not found for subscription.' };
    }

    // Uniqueness constraint: reject if user already has an active subscription
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId)
      .in('state', ['active', 'trial', 'past_due', 'grace'])
      .limit(1).single();

    if (existing) {
      return { success: false, message: 'User already has an active subscription.' };
    }

    const now = TimeService.now();
    const trialEndsAt = BillingCalculator.trialEndDate(now, trialDays).toISOString();

    const { data: subRow, error: subErr } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        plan: planId,
        state: 'trial',
        amount: price,
        currency: 'USD',
        auto_renew: true,
        trial_ends_at: trialEndsAt,
        billing_cycle_start: now.toISOString(),
      })
      .select()
      .single();

    if (subErr || !subRow) {
      return { success: false, message: subErr?.message ?? 'Trial subscription creation failed.' };
    }

    return { success: true, data: this.mapSubscription(subRow as Record<string, unknown>) };
  }

  /**
   * Retrieves the most-recent subscription for a user.
   */
  protected async mockGetSubscription(userId: string): Promise<ApiResponse<Subscription>> {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return { success: false, message: 'Subscription not found.' };
    }

    return { success: true, data: this.mapSubscription(data as Record<string, unknown>) };
  }

  /**
   * Updates a subscription to a new state (raw — no transition validation).
   */
  protected async mockUpdateSubscriptionState(
    subscriptionId: string,
    newState: SubscriptionState,
  ): Promise<ApiResponse<Subscription>> {
    const { data: existing, error: fetchErr } = await supabase
      .from('subscriptions').select('*').eq('id', subscriptionId).single();

    if (fetchErr || !existing) {
      return { success: false, message: 'Subscription not found.' };
    }

    const { data, error } = await supabase
      .from('subscriptions')
      .update({ state: newState, updated_at: TimeService.nowIso() })
      .eq('id', subscriptionId)
      .select()
      .single();

    if (error || !data) {
      return { success: false, message: error?.message ?? 'State update failed.' };
    }

    return { success: true, data: this.mapSubscription(data as Record<string, unknown>) };
  }

  /**
   * Cancels a user's active/past_due/grace/trial subscription.
   */
  protected async mockCancelSubscription(userId: string): Promise<ApiResponse<Subscription>> {
    const { data: existing, error: fetchErr } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchErr || !existing) {
      return { success: false, message: 'Subscription not found.' };
    }

    const row = existing as Record<string, unknown>;
    const currentState = row.state as SubscriptionState;
    const cancelable: SubscriptionState[] = ['active', 'past_due', 'grace', 'trial'];

    if (!cancelable.includes(currentState)) {
      return {
        success: false,
        message: `Cannot cancel subscription in ${currentState} state.`,
      };
    }

    const now = TimeService.nowIso();
    const { data, error } = await supabase
      .from('subscriptions')
      .update({ state: 'canceled', updated_at: now })
      .eq('id', row.id as string)
      .select()
      .single();

    if (error || !data) {
      return { success: false, message: error?.message ?? 'Cancellation failed.' };
    }

    return { success: true, data: this.mapSubscription(data as Record<string, unknown>) };
  }

  /**
   * Updates specific fields on a subscription (patch operation).
   * Used for plan changes, autoRenew toggle, grace period, renewal date.
   */
  protected async mockPatchSubscription(
    subscriptionId: string,
    patch: SubscriptionPatch,
  ): Promise<ApiResponse<Subscription>> {
    const { data, error } = await supabase
      .from('subscriptions')
      .update({ ...patch, updated_at: TimeService.nowIso() })
      .eq('id', subscriptionId)
      .select()
      .single();

    if (error || !data) {
      return { success: false, message: error?.message ?? 'Patch failed.' };
    }

    return { success: true, data: this.mapSubscription(data as Record<string, unknown>) };
  }

  // ── Payment Operations ─────────────────────────────────────────────────────

  /**
   * Records a payment. Idempotent when idempotencyKey is provided —
   * a second call with the same key returns the existing record.
   */
  protected async mockRecordPayment(
    userId: string,
    subscriptionId: string | null,
    amount: number,
    status: PaymentStatus,
    idempotencyKey?: string,
  ): Promise<ApiResponse<Payment>> {
    // If we have a key, check for existing record first (idempotency check)
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from('payments')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) {
        return {
          success: true,
          data: this.mapPayment(existing as Record<string, unknown>),
          message: 'idempotent',
        };
      }
    }

    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      status,
      amount,
    };
    if (subscriptionId) insertPayload.subscription_id = subscriptionId;
    if (idempotencyKey) insertPayload.idempotency_key = idempotencyKey;

    const { data, error } = await supabase
      .from('payments')
      .insert(insertPayload)
      .select()
      .single();

    if (error || !data) {
      return { success: false, message: error?.message ?? 'Payment recording failed.' };
    }

    return { success: true, data: this.mapPayment(data as Record<string, unknown>) };
  }

  /**
   * Retrieves all payment records for a user, newest first.
   */
  protected async mockGetPayments(userId: string): Promise<ApiResponse<Payment[]>> {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, message: error.message };
    }

    return {
      success: true,
      data: (data ?? []).map(r => this.mapPayment(r as Record<string, unknown>)),
    };
  }
}
