import { APIRequestContext } from '@playwright/test';
import { SubscriptionService as SubscriptionApiService } from '../api/subscriptionService';
import { Payment, BillingResult } from '../types/api';
import { Logger } from '../utils/logger';
import { BillingCalculator } from '../utils/BillingCalculator';

/**
 * BillingService — Payment orchestration layer.
 *
 * Responsibilities:
 *   - Recording successful and failed payments
 *   - Idempotent charge handling (same key → single record)
 *   - Payment history retrieval
 *
 * What this layer does NOT do:
 *   - State-machine transitions (SubscriptionService owns that)
 *   - DB access directly (delegates to SubscriptionApiService → ApiClient)
 *
 * ## Idempotency
 * Every charge method accepts an optional `idempotencyKey`. If the same key
 * is submitted twice, only one payment record is ever created. The second
 * call returns the existing record with `result.idempotent = true`.
 *
 * ## Payment simulation
 * Use `charge()` for success scenarios and `chargeWithFailure()` to
 * simulate declined / failed payment events (e.g., to enter past_due).
 */
export class BillingService {
  private readonly subscriptionApi: SubscriptionApiService;

  constructor(requestContext: APIRequestContext, baseUrl: string) {
    this.subscriptionApi = new SubscriptionApiService(requestContext, baseUrl);
  }

  // ── Charge simulation ──────────────────────────────────────────────────────

  /**
   * Records a successful payment. Idempotent when idempotencyKey is provided.
   *
   * @param userId         Paying user
   * @param subscriptionId Associated subscription (nullable for ad-hoc charges)
   * @param amount         Amount in currency units
   * @param idempotencyKey Unique key — same key → same single record
   */
  async charge(
    userId: string,
    subscriptionId: string | null,
    amount: number,
    idempotencyKey?: string,
  ): Promise<BillingResult> {
    Logger.info(`[BillingService] Charging $${amount} for user ${userId} (key: ${idempotencyKey ?? 'none'})`);

    const response = await this.subscriptionApi.recordPayment(
      userId, subscriptionId, amount, 'success', idempotencyKey,
    );

    if (!response.success || !response.data) {
      Logger.error(`[BillingService] Charge failed: ${response.message}`);
      return { charged: false, payment: null, idempotent: false, error: response.message ?? 'Unknown error' };
    }

    const idempotent = response.message === 'idempotent';
    if (idempotent) {
      Logger.info(`[BillingService] Idempotent: existing payment returned for key "${idempotencyKey}"`);
    }

    return { charged: true, payment: response.data, idempotent, error: null };
  }

  /**
   * Records a failed payment (simulates decline / network error).
   * Use this to drive subscription state to `past_due`.
   */
  async chargeWithFailure(
    userId: string,
    subscriptionId: string | null,
    amount: number,
    idempotencyKey?: string,
  ): Promise<BillingResult> {
    Logger.info(`[BillingService] Simulating payment failure for user ${userId} amount $${amount}`);

    const response = await this.subscriptionApi.recordPayment(
      userId, subscriptionId, amount, 'failed', idempotencyKey,
    );

    if (!response.success || !response.data) {
      Logger.error(`[BillingService] Failed payment recording error: ${response.message}`);
      return { charged: false, payment: null, idempotent: false, error: response.message ?? 'Unknown error' };
    }

    return { charged: false, payment: response.data, idempotent: false, error: 'Payment declined (simulated)' };
  }

  // ── Retry helpers ─────────────────────────────────────────────────────────

  /**
   * Generates a retry-specific idempotency key so each attempt is unique
   * but a double-submission of the same attempt is deduplicated.
   */
  retryKey(userId: string, subscriptionId: string, attempt: number): string {
    return BillingCalculator.generateIdempotencyKey(userId, subscriptionId, attempt, 'retry');
  }

  // ── History ────────────────────────────────────────────────────────────────

  /**
   * Returns full payment history for a user, newest first.
   */
  async getHistory(userId: string): Promise<Payment[]> {
    Logger.info(`[BillingService] Fetching payment history for user ${userId}`);
    const response = await this.subscriptionApi.getPayments(userId);
    return response.data ?? [];
  }

  /**
   * Returns the count of payments for a user.
   * Useful for asserting idempotency: same key → exactly 1 record.
   */
  async getPaymentCount(userId: string): Promise<number> {
    const payments = await this.getHistory(userId);
    return payments.length;
  }

  /**
   * Returns all successful payments for a user.
   */
  async getSuccessfulPayments(userId: string): Promise<Payment[]> {
    const all = await this.getHistory(userId);
    return all.filter(p => p.status === 'success');
  }

  /**
   * Returns all failed payments for a user.
   */
  async getFailedPayments(userId: string): Promise<Payment[]> {
    const all = await this.getHistory(userId);
    return all.filter(p => p.status === 'failed');
  }
}
