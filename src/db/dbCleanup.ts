import { supabase } from './supabaseClient';
import { Logger } from '../utils/logger';

/**
 * cleanDatabase — Truncates all test-owned tables in FK-safe order.
 *
 * Call this from the global setup hook (`global.setup.ts`) to guarantee a clean slate
 * for the entire test run. Order matters: payments and subscriptions reference
 * users, so they must be cleared first.
 *
 * IMPORTANT: This function uses the Supabase client directly because it is
 * a database-infrastructure concern, not a business-logic concern.
 * It lives in the `db/` layer and must NOT be called from tests directly —
 * only from the global setup hook.
 */
export async function cleanDatabase(): Promise<void> {
  Logger.debug('[DB] Cleaning database for test isolation...');

  // Delete in FK-safe order: children before parents
  const tables = ['payments', 'subscriptions', 'users'] as const;

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) {
      // Schema not yet created — warn but don't crash all tests.
      // Run the schema SQL from README in Supabase SQL Editor to resolve this.
      if (error.message.includes('schema cache') || error.message.includes('does not exist')) {
        Logger.warn(`[DB] Table "${table}" not found in schema — skipping cleanup. Did you run the schema SQL?`);
        continue;
      }
      throw new Error(`[DB] Failed to clean table "${table}": ${error.message}`);
    }
  }

  Logger.debug('[DB] Database cleaned successfully.');
}
