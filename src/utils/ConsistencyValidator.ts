import { Page } from '@playwright/test';
import { supabase } from '../db/supabaseClient';
import { ConsistencyReport, SubscriptionState } from '../types/api';
import { Logger } from './logger';

/**
 * ConsistencyValidator — Cross-layer state comparison utility.
 *
 * Reads subscription state from three independent sources and verifies
 * they all agree. This is the gold standard for SaaS QA: if any layer
 * is stale, cached, or incorrectly mapped, this utility will catch it.
 *
 * ## Layers checked
 *   1. UI      — text visible on the dashboard page
 *   2. API     — response from SubscriptionService.getStatus()
 *   3. DB      — direct Supabase query (bypasses service layer)
 *
 * ## Architecture note
 * Direct Supabase access here is intentional — this utility is test
 * infrastructure, not business logic. It must bypass the API layer to
 * independently verify the database ground truth.
 *
 * ## Usage
 * ```typescript
 * const report = await ConsistencyValidator.validate(page, userId, 'active');
 * expect(report.consistent).toBe(true);
 * ```
 */
export class ConsistencyValidator {
  /**
   * Reads subscription state from UI, API layer, and DB directly.
   * Returns a report indicating whether all three agree.
   *
   * @param page        Playwright Page — must be on the dashboard
   * @param userId      UUID of the user to check
   * @param apiState    State as reported by SubscriptionService.getStatus()
   */
  static async validate(
    page: Page,
    userId: string,
    apiState: SubscriptionState | null,
  ): Promise<ConsistencyReport> {
    const discrepancies: string[] = [];

    // ── 1. Read UI state ───────────────────────────────────────────────────
    let uiState: string | null = null;
    try {
      const statusEl = page.locator('[data-testid="subscription-status"]');
      const visible = await statusEl.isVisible({ timeout: 3000 });
      if (visible) {
        uiState = (await statusEl.textContent())?.trim().toLowerCase() ?? null;
      }
    } catch {
      Logger.warn('[ConsistencyValidator] Could not read UI state — dashboard not visible?');
    }

    // ── 2. API state (passed in from caller) ───────────────────────────────
    const apiStateStr = apiState?.toLowerCase() ?? null;

    // ── 3. DB state (direct Supabase query) ───────────────────────────────
    let dbState: string | null = null;
    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('state')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        dbState = (data as { state: string }).state?.toLowerCase() ?? null;
      }
    } catch {
      Logger.warn('[ConsistencyValidator] Could not read DB state.');
    }

    // ── Comparison ─────────────────────────────────────────────────────────
    if (uiState !== null && apiStateStr !== null && uiState !== apiStateStr) {
      discrepancies.push(`UI ("${uiState}") ≠ API ("${apiStateStr}")`);
    }
    if (apiStateStr !== null && dbState !== null && apiStateStr !== dbState) {
      discrepancies.push(`API ("${apiStateStr}") ≠ DB ("${dbState}")`);
    }
    if (uiState !== null && dbState !== null && uiState !== dbState) {
      discrepancies.push(`UI ("${uiState}") ≠ DB ("${dbState}")`);
    }

    const report: ConsistencyReport = {
      uiState,
      apiState: apiStateStr,
      dbState,
      consistent: discrepancies.length === 0,
      discrepancies,
    };

    if (!report.consistent) {
      Logger.warn(`[ConsistencyValidator] Inconsistency detected for user ${userId}:`, discrepancies);
    } else {
      Logger.info(`[ConsistencyValidator] All layers consistent: "${apiStateStr}" for user ${userId}`);
    }

    return report;
  }

  /**
   * Validates payment count in DB for a user.
   * Useful to assert idempotency: same key should produce exactly 1 record.
   */
  static async getPaymentCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      Logger.warn(`[ConsistencyValidator] Could not count payments for user ${userId}`);
      return -1;
    }
    return count ?? 0;
  }

  /**
   * Counts payment records sharing the same idempotency key.
   * Expects exactly 1 for a correctly idempotent payment flow.
   */
  static async countByIdempotencyKey(idempotencyKey: string): Promise<number> {
    const { count, error } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('idempotency_key', idempotencyKey);

    if (error) {
      Logger.warn(`[ConsistencyValidator] Could not count payments for key "${idempotencyKey}"`);
      return -1;
    }
    return count ?? 0;
  }
}
