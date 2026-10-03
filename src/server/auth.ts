// Admin authentication: a Supabase Auth session whose email is in ADMIN_EMAILS.

import "server-only";

import type { NextRequest } from "next/server";
import { isAllowedEmail } from "./allowlist";
import { errorToResponse, jsonError } from "./api";
import { getAdminEmails } from "./env";
import { createAuthClient } from "./supabase";

export interface SessionUser {
  userId: string;
  /** Lowercased. */
  email: string;
}

export type AdminSession = SessionUser;

/**
 * The signed-in user, identity verified by Supabase (`getClaims` checks the
 * JWT signature), or null. Refreshes the session cookie when needed.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  const email = typeof data.claims.email === "string" ? data.claims.email.trim().toLowerCase() : "";
  if (!email || !data.claims.sub) return null;
  return { userId: data.claims.sub, email };
}

/** The signed-in admin, or null when signed out or not in ADMIN_EMAILS. For pages and layouts. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const user = await getSessionUser();
  if (!user || !isAllowedEmail(user.email, getAdminEmails())) return null;
  return user;
}

export type AdminGuard = { ok: true; session: AdminSession } | { ok: false; response: Response };

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Defense in depth against CSRF (session cookies are already SameSite=Lax):
 * browsers send Sec-Fetch-Site, and admin mutations must come from our own origin.
 */
function isForeignMutation(request: Request): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return false;
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin";
}

/** For API routes: 401 when signed out, 403 when not allowlisted. */
export async function requireAdminApi(request?: Request): Promise<AdminGuard> {
  if (request && isForeignMutation(request)) {
    return { ok: false, response: jsonError(403, "forbidden") };
  }
  const user = await getSessionUser();
  if (!user) return { ok: false, response: jsonError(401, "unauthorized") };
  if (!isAllowedEmail(user.email, getAdminEmails())) {
    return { ok: false, response: jsonError(403, "forbidden") };
  }
  return { ok: true, session: user };
}

/**
 * Wraps an admin route handler: runs requireAdminApi first and maps thrown
 * errors to JSON responses.
 */
export function adminRoute<C = unknown>(
  handler: (request: NextRequest, context: C, session: AdminSession) => Promise<Response>,
) {
  return async (request: NextRequest, context: C): Promise<Response> => {
    try {
      const guard = await requireAdminApi(request);
      if (!guard.ok) return guard.response;
      return await handler(request, context, guard.session);
    } catch (err) {
      return errorToResponse(err);
    }
  };
}
