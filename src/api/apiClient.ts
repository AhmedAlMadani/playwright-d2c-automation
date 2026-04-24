import { APIRequestContext } from '@playwright/test';
import { User, Subscription, SubscriptionState, ApiResponse } from '../types/api';
import { supabase } from '../db/supabaseClient';

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
      id: row.id as string,
      userId: row.user_id as string,
      planId: row.plan as string,
      state: row.state as SubscriptionState,
      startDate: row.created_at as string,
      endDate: (row.updated_at && row.state === 'canceled')
        ? (row.updated_at as string)
        : null,
      price: row.amount as number ?? 0,
      currency: 'USD',
    };
  }

  // ── User Operations ────────────────────────────────────────────────────────

  /**
   * Inserts a new user into Supabase.
   * Signature unchanged from mock implementation.
   */
  protected async mockCreateUser(email: string, password?: string): Promise<ApiResponse<User>> {
    const { data, error } = await supabase
      .from('users')
      .insert({ email, password: password ?? '' })
      .select()
      .single();

    if (error) {
      // Postgres unique-violation code = 23505
      if (error.code === '23505') {
        return { success: false, message: 'User with this email already exists.' };
      }
      return { success: false, message: error.message };
    }

    return { success: true, data: this.mapUser(data as Record<string, unknown>) };
  }

  /**
   * Fetches a user by ID or email.
   * Signature unchanged from mock implementation.
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
   * Creates a subscription record and a matching payment record.
   * Signature unchanged from mock implementation.
   */
  protected async mockCreateSubscription(
    userId: string,
    planId: string,
    price: number,
    _currency: string,
  ): Promise<ApiResponse<Subscription>> {
    // Verify user exists
    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();

    if (userErr || !userRow) {
      return { success: false, message: 'User not found for subscription.' };
    }

    // Insert subscription
    const { data: subRow, error: subErr } = await supabase
      .from('subscriptions')
      .insert({ user_id: userId, plan: planId, state: 'active' })
      .select()
      .single();

    if (subErr || !subRow) {
      return { success: false, message: subErr?.message ?? 'Subscription creation failed.' };
    }

    // Record successful payment
    await supabase
      .from('payments')
      .insert({ user_id: userId, status: 'success', amount: price });

    const sub = this.mapSubscription(subRow as Record<string, unknown>);
    // Carry price through for callers that inspect it
    sub.price = price;

    return { success: true, data: sub };
  }

  /**
   * Retrieves the most-recent subscription for a user.
   * Signature unchanged from mock implementation.
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
   * Updates a subscription to a new state (raw — no transition validation here;
   * that is SubscriptionService's responsibility).
   * Signature unchanged from mock implementation.
   */
  protected async mockUpdateSubscriptionState(
    subscriptionId: string,
    newState: SubscriptionState,
  ): Promise<ApiResponse<Subscription>> {
    const { data: existing, error: fetchErr } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .single();

    if (fetchErr || !existing) {
      return { success: false, message: 'Subscription not found.' };
    }

    const { data, error } = await supabase
      .from('subscriptions')
      .update({ state: newState, updated_at: new Date().toISOString() })
      .eq('id', subscriptionId)
      .select()
      .single();

    if (error || !data) {
      return { success: false, message: error?.message ?? 'State update failed.' };
    }

    return { success: true, data: this.mapSubscription(data as Record<string, unknown>) };
  }

  /**
   * Cancels a user's active/past_due subscription.
   * Signature unchanged from mock implementation.
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

    if (currentState !== 'active' && currentState !== 'past_due') {
      return {
        success: false,
        message: `Cannot cancel subscription in ${currentState} state.`,
      };
    }

    const now = new Date().toISOString();
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
}
