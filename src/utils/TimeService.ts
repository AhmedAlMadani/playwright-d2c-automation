/**
 * TimeService — Controllable virtual clock for time-based subscription tests.
 *
 * ## Why this exists
 * Subscription logic depends heavily on dates: trial expiry, grace period
 * deadlines, renewal dates. Testing those scenarios with real system time
 * requires either waiting (impractical) or pre-computing timestamps.
 *
 * TimeService solves this by providing a virtual clock that tests can freeze
 * or advance — making scenarios deterministic and instant.
 *
 * ## Architecture rules
 * - Pure in-process utility — no database or network access
 * - Service layer methods that need "now" call `TimeService.now()`
 * - Tests use `freezeAt()` / `advanceDays()` to control perceived time
 * - Always call `TimeService.reset()` in afterEach to restore real time
 *
 * ## Usage
 * ```typescript
 * TimeService.freezeAt(new Date('2024-01-01'));
 * const expires = TimeService.daysFromNow(30); // 2024-01-31
 * TimeService.advanceDays(31);                 // now = 2024-02-01
 * // trial_ends_at (2024-01-31) < now (2024-02-01) → expired ✓
 * TimeService.reset();
 * ```
 */
export class TimeService {
  private static _frozenAt: Date | null = null;

  // ── Clock control ──────────────────────────────────────────────────────────

  /**
   * Returns the current virtual time.
   * If the clock is frozen, returns the frozen value; otherwise real time.
   */
  static now(): Date {
    return TimeService._frozenAt
      ? new Date(TimeService._frozenAt.getTime())
      : new Date();
  }

  /**
   * Freeze the clock at a specific point in time.
   * All subsequent calls to `now()` return this date.
   */
  static freezeAt(date: Date): void {
    TimeService._frozenAt = new Date(date.getTime());
  }

  /**
   * Advance the virtual clock by N days.
   * If unfrozen, freezes at (real now + N days).
   */
  static advanceDays(n: number): void {
    const base = TimeService._frozenAt ?? new Date();
    TimeService._frozenAt = new Date(base.getTime() + n * 86_400_000);
  }

  /**
   * Advance the virtual clock by N hours.
   */
  static advanceHours(n: number): void {
    const base = TimeService._frozenAt ?? new Date();
    TimeService._frozenAt = new Date(base.getTime() + n * 3_600_000);
  }

  /**
   * Restore the real system clock. Call this in afterEach.
   */
  static reset(): void {
    TimeService._frozenAt = null;
  }

  /** True when the clock is frozen. */
  static isFrozen(): boolean {
    return TimeService._frozenAt !== null;
  }

  // ── Date computation helpers ───────────────────────────────────────────────

  /** Returns a date N days in the future from the virtual now. */
  static daysFromNow(n: number): Date {
    return new Date(TimeService.now().getTime() + n * 86_400_000);
  }

  /** Returns a date N days in the past from the virtual now. */
  static daysAgo(n: number): Date {
    return new Date(TimeService.now().getTime() - n * 86_400_000);
  }

  /** Returns a date N hours in the future from the virtual now. */
  static hoursFromNow(n: number): Date {
    return new Date(TimeService.now().getTime() + n * 3_600_000);
  }

  /** ISO string of a date N days from now. Convenience for DB writes. */
  static isoFromNow(days: number): string {
    return TimeService.daysFromNow(days).toISOString();
  }

  /** ISO string of a date N days ago. Convenience for DB writes. */
  static isoAgo(days: number): string {
    return TimeService.daysAgo(days).toISOString();
  }

  /** ISO string of the current virtual time. */
  static nowIso(): string {
    return TimeService.now().toISOString();
  }
}
