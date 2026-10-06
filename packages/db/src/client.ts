import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseEnv {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

function readEnv(): SupabaseEnv {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
  }
  return { url, anonKey, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
}

/** Anon client — respects RLS. Use for anything scoped to a logged-in user's JWT. */
export function createAnonClient(accessToken?: string): SupabaseClient {
  const env = readEnv();
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}

let cachedAdminClient: SupabaseClient | null = null;

/**
 * Service-role client — bypasses RLS entirely. Only use server-side for the
 * credential vault, webhooks, the scheduler worker, and the seed script.
 * Never expose this client or its key to apps/web.
 *
 * Memoized — unlike createAnonClient (which must vary per call since it
 * carries the caller's own access token for RLS), this client's credentials
 * never change, so building a brand-new SupabaseClient on every single call
 * (every API request through requireAuth, every worker job) is pure
 * overhead. Safe to share: it's stateless beyond the fixed service-role key.
 */
export function createAdminClient(): SupabaseClient {
  if (cachedAdminClient) return cachedAdminClient;
  const env = readEnv();
  if (!env.serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set to create an admin client");
  }
  cachedAdminClient = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdminClient;
}
