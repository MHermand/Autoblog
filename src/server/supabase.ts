// Supabase clients. Server-only: the admin client holds the service-role key.

import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./db-types";
import { getServiceRoleKey, getSupabasePublicEnv } from "./env";

function createAdminClient() {
  const { url } = getSupabasePublicEnv();
  return createClient<Database>(url, getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;

let adminClient: AdminClient | null = null;

/**
 * Service-role client for all database and storage access. It bypasses RLS:
 * callers are responsible for authorization. Stateless, so it is shared.
 */
export function getAdminClient(): AdminClient {
  adminClient ??= createAdminClient();
  return adminClient;
}

/**
 * Anon-key client bound to the request cookies, used ONLY for Supabase Auth
 * (session, magic link, code exchange). Create one per request.
 * `fetchImpl` replaces the network layer (see the magic-link route).
 */
export async function createAuthClient(fetchImpl?: typeof fetch) {
  const { url, anonKey } = getSupabasePublicEnv();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // src/proxy.ts refreshes the session on the next navigation.
        }
      },
    },
  });
}
