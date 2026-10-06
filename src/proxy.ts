// Runs before pages (not before /api/**, whose handlers answer 401/403 JSON
// themselves). Refreshes the Supabase session cookie and keeps signed-out or
// non-allowlisted users out of /admin. This is an optimistic check: admin
// pages and API routes verify the session again on the server.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/server/allowlist";
import { getAdminEmails, getSupabasePublicEnv } from "@/server/env";

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/** Supabase stores the session in sb-<project>-auth-token cookies (possibly chunked). */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
}

function loginRedirect(request: NextRequest, error?: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const adminPath = isAdminPath(request.nextUrl.pathname);
  // Nothing to refresh and nothing to protect: skip the Supabase round trip.
  if (!adminPath && !hasAuthCookie(request)) return NextResponse.next();

  let env: { url: string; anonKey: string };
  try {
    env = getSupabasePublicEnv();
  } catch {
    return adminPath ? loginRedirect(request, "server_misconfigured") : NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // no-store headers: a response that sets auth cookies must never be cached.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Verifies the JWT and refreshes an expired session (written back via setAll).
  const { data } = await supabase.auth.getClaims();
  if (!adminPath) return response;

  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  let allowed: boolean;
  try {
    allowed = isAllowedEmail(email, getAdminEmails());
  } catch {
    return loginRedirect(request, "server_misconfigured");
  }
  if (allowed) return response;

  const redirect = loginRedirect(request, email ? "forbidden" : undefined);
  // Keep any cookie the refresh just wrote (or cleared) on the redirect.
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: [
    // Everything except API routes, the auth callback, Next.js internals and static files.
    "/((?!api/|auth/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|woff2?)$).*)",
  ],
};
