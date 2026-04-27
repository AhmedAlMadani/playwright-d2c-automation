import { Subscription, Plan, PLANS, PlanId } from '../types/api';
import { TimeService } from './TimeService';

/**
 * BillingCalculator — Pure billing math utilities.
 *
 * Every method is a pure function (no I/O, no side-effects).
 * All date comparisons use TimeService.now() so tests can control "now".
 *
 * ## Proration model
 * When a user upgrades mid-cycle we charge only for the remaining days:
 *   prorationFactor = daysRemainingInCycle / totalCycleDays
 *   charge = (newPrice - oldPrice) * prorationFactor
 *
 * Downgrades carry no immediate charge — the lower price applies at renewal.
 */
export class BillingCalculator {
  static readonly DEFAULT_TRIAL_DAYS   = 14;
  static readonly DEFAULT_GRACE_DAYS   = 7;
  static readonly DEFAULT_PERIOD_DAYS  = 30;
  static readonly MAX_RETRY_ATTEMPTS   = 3;

  // ── Trial ────────────────────────────────────────────────────────────────

  /**
   * Computes the date a trial ends given the start date and duration.
   */
  static trialEndDate(startDate: Date, trialDays: number): Date {
    return new Date(startDate.getTime() + trialDays * 86_400_000);
  }

  /**
   * True when the trial period has elapsed (trialEndsAt is in the past).
   */
  static isTrialExpired(trialEndsAt: string | null): boolean {
    if (!trialEndsAt) return false;
    return new Date(trialEndsAt) < TimeService.now();
  }

  // ── Grace period ─────────────────────────────────────────────────────────

  /**
   * True when the grace period deadline has passed.
   */
  static isGracePeriodExpired(gracePeriodEndsAt: string | null): boolean {
    if (!gracePeriodEndsAt) return false;
    return new Date(gracePeriodEndsAt) < TimeService.now();
  }

  /**
   * Computes the grace period end date.
   */
  static gracePeriodEndDate(graceDays: number): Date {
    return TimeService.daysFromNow(graceDays);
  }

  // ── Renewal ──────────────────────────────────────────────────────────────

  /**
   * True when renewsAt is in the past and the subscription should renew.
   */
  static isRenewalDue(renewsAt: string | null): boolean {
    if (!renewsAt) return false;
    return new Date(renewsAt) <= TimeService.now();
  }

  /**
   * Next renewal date: billingCycleStart + periodDays.
   */
  static nextRenewalDate(billingCycleStart: Date, periodDays = BillingCalculator.DEFAULT_PERIOD_DAYS): Date {
    return new Date(billingCycleStart.getTime() + periodDays * 86_400_000);
  }

  // ── Proration ────────────────────────────────────────────────────────────

  /**
   * Calculates the prorated upgrade charge.
   * Returns 0 if this would be a downgrade (newPrice <= oldPrice).
   *
   * @param oldPrice           Current plan price per period
   * @param newPrice           New plan price per period
   * @param daysRemainingInCycle How many days are left in the billing cycle
   * @param periodDays         Total days in the billing cycle
   */
  static computeProration(
    oldPrice: number,
    newPrice: number,
    daysRemainingInCycle: number,
    periodDays = BillingCalculator.DEFAULT_PERIOD_DAYS,
  ): number {
    if (newPrice <= oldPrice) return 0; // downgrade → no immediate charge
    const factor = Math.max(0, Math.min(1, daysRemainingInCycle / periodDays));
    return Math.round((newPrice - oldPrice) * factor * 100) / 100;
  }

  /**
   * Days remaining in the current billing cycle.
   * Returns 0 if billingCycleStart is null or cycle has already ended.
   */
  static daysRemainingInCycle(
    billingCycleStart: string | null,
    periodDays = BillingCalculator.DEFAULT_PERIOD_DAYS,
  ): number {
    if (!billingCycleStart) return 0;
    const cycleEnd = new Date(
      new Date(billingCycleStart).getTime() + periodDays * 86_400_000,
    );
    const msRemaining = cycleEnd.getTime() - TimeService.now().getTime();
    return Math.max(0, Math.floor(msRemaining / 86_400_000));
  }

  // ── Plan helpers ─────────────────────────────────────────────────────────

  /**
   * Looks up a plan by ID. Throws for unknown plan IDs.
   */
  static getPlan(planId: string): Plan {
    const plan = PLANS[planId as PlanId];
    if (!plan) throw new Error(`[BillingCalculator] Unknown plan: "${planId}". Valid plans: ${Object.keys(PLANS).join(', ')}`);
    return plan;
  }

  /**
   * True when newPlan is more expensive than currentPlan.
   */
  static isUpgrade(currentPlanId: string, newPlanId: string): boolean {
    return BillingCalculator.getPlan(newPlanId).price > BillingCalculator.getPlan(currentPlanId).price;
  }

  // ── Idempotency ──────────────────────────────────────────────────────────

  /**
   * Generates a deterministic idempotency key for a payment attempt.
   * Same inputs → same key → only one charge ever recorded.
   */
  static generateIdempotencyKey(
    userId: string,
    subscriptionId: string,
    attempt: number,
    purpose = 'charge',
  ): string {
    return `${purpose}:${userId}:${subscriptionId}:${attempt}`;
  }

  /**
   * Generates a renewal idempotency key based on the billing cycle date
   * so renewals in the same cycle are always idempotent.
   */
  static renewalIdempotencyKey(userId: string, subscriptionId: string, billingCycleStart: string): string {
    const cycleDate = billingCycleStart.split('T')[0]; // YYYY-MM-DD
    return `renewal:${userId}:${subscriptionId}:${cycleDate}`;
  }
}
