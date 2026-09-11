import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* The browser gets the anon key and nothing else. RLS is what protects the
   data — the anon key is public by design and safe in the bundle. The
   service-role key bypasses RLS and lives only in edge-function secrets. */

export const cloudConfig = {
  url: import.meta.env.VITE_SUPABASE_URL ?? '',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
} as const;

export const isCloudConfigured = (): boolean =>
  Boolean(cloudConfig.url && cloudConfig.anonKey);

/* Null when online ordering is not set up. Every caller must handle null —
   a shop with no cloud configured still runs the whole till offline, and the
   UI says "online ordering unavailable" rather than crashing. */
export const supabase: SupabaseClient | null = isCloudConfigured()
  ? createClient(cloudConfig.url, cloudConfig.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
