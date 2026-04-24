import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/environment';

/**
 * SupabaseClientWrapper — Singleton wrapper around the Supabase JS SDK.
 *
 * Rules:
 *   - Initialised once from environment variables via the centralized config
 *   - Exported as a single `supabase` instance
 *   - Must ONLY be imported by the API layer (ApiClient and its subclasses)
 *   - Never import this directly in tests, services, or page objects
 */

if (!config.supabaseUrl) {
  throw new Error(
    '[SupabaseClient] SUPABASE_URL is not set. ' +
    'Copy .env.example → .env and provide your Supabase project URL.',
  );
}

if (!config.supabaseAnonKey) {
  throw new Error(
    '[SupabaseClient] SUPABASE_ANON_KEY is not set. ' +
    'Copy .env.example → .env and provide your Supabase anon (publishable) key.',
  );
}

export const supabase: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey,
  {
    auth: {
      // Disable auto session persistence — tests must be stateless
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
