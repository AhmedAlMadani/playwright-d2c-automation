// ── Subscription state machine states ─────────────────────────────────────────
// inactive  → trial, active
// trial     → active, expired, canceled
// active    → past_due, canceled
// past_due  → grace, canceled
// grace     → active (retry success), canceled (grace exhausted)
// expired   → [] (terminal)
// canceled  → [] (terminal)
export type SubscriptionState =
  | 'inactive'
  | 'trial'
  | 'active'
  | 'past_due'
  | 'grace'
  | 'expired'
  | 'canceled';

// ── Plan tiers ────────────────────────────────────────────────────────────────
export type PlanId = 'basic' | 'premium' | 'enterprise';

export interface Plan {
  id: PlanId;
  name: string;
  price: number;
  currency: string;
  /** Billing period in days (default 30) */
  periodDays: number;
}

export const PLANS: Record<PlanId, Plan> = {
  basic:      { id: 'basic',      name: 'Basic',      price: 9.99,  currency: 'USD', periodDays: 30 },
  premium:    { id: 'premium',    name: 'Premium',    price: 29.99, currency: 'USD', periodDays: 30 },
  enterprise: { id: 'enterprise', name: 'Enterprise', price: 99.99, currency: 'USD', periodDays: 30 },
};

// ── User ──────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  password?: string;
  createdAt: string;
}

// ── Subscription ──────────────────────────────────────────────────────────────
export interface Subscription {
  // ── Core (existing, unchanged) ─────────────────
  id: string;
  userId: string;
  planId: string;
  state: SubscriptionState;
  startDate: string;
  endDate: string | null;
  price: number;
  currency: string;

  // ── Trial ──────────────────────────────────────
  /** ISO datetime — when the trial period ends. Null for non-trial subs. */
  trialEndsAt: string | null;

  // ── Renewal ────────────────────────────────────
  /** ISO datetime — scheduled next billing date. */
  renewsAt: string | null;
  /** When false, subscription expires at renewsAt instead of auto-renewing. */
  autoRenew: boolean;

  // ── Grace period ───────────────────────────────
  /** ISO datetime — deadline to resolve payment failure before cancellation. */
  gracePeriodEndsAt: string | null;

  // ── Mid-cycle tracking ─────────────────────────
  /** ISO datetime — start of the current billing period (for proration). */
  billingCycleStart: string | null;
}

// ── Payment ───────────────────────────────────────────────────────────────────
export type PaymentStatus = 'success' | 'failed' | 'pending';

export interface Payment {
  id: string;
  userId: string;
  subscriptionId: string | null;
  amount: number;
  status: PaymentStatus;
  /** Unique key for idempotent payment deduplication. */
  idempotencyKey: string | null;
  createdAt: string;
}

// ── Billing result ────────────────────────────────────────────────────────────
export interface BillingResult {
  charged: boolean;
  payment: Payment | null;
  /** True when the same idempotencyKey was already used — no double charge. */
  idempotent: boolean;
  error: string | null;
}

// ── Cross-layer consistency ───────────────────────────────────────────────────
export interface ConsistencyReport {
  uiState: string | null;
  apiState: string | null;
  dbState: string | null;
  consistent: boolean;
  discrepancies: string[];
}

// ── Patch payload ─────────────────────────────────────────────────────────────
/** Fields that can be patched on a subscription record. */
export interface SubscriptionPatch {
  plan?: string;
  amount?: number;
  state?: SubscriptionState;
  auto_renew?: boolean;
  renews_at?: string;
  grace_period_ends_at?: string | null;
  billing_cycle_start?: string;
  trial_ends_at?: string | null;
  updated_at?: string;
}

// ── Generic API envelope ──────────────────────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}
