import type { NextRequest } from "next/server";
import { isAllowedEmail } from "@/server/allowlist";
import { errorToResponse, json, readJson } from "@/server/api";
import { getAdminEmails } from "@/server/env";
import { magicLinkBodySchema } from "@/server/schemas";
import { createAuthClient } from "@/server/supabase";

/**
 * Every answer takes at least this long, so timing does not reveal the
 * allowlist. Generous because a custom SMTP server can be slow to accept mail.
 */
const MIN_RESPONSE_MS = 2000;

/**
 * Stands in for the Supabase Auth API when the email is not allowlisted: the
 * client library runs exactly the same code (and sets exactly the same PKCE
 * cookies) but nothing is sent.
 */
const fakeAuthApi: typeof fetch = async () =>
  new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

async function padResponseTime(startedAt: number): Promise<void> {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

/**
 * POST /api/auth/magic-link { email } -> { ok: true }, always (the allowlist is
 * never revealed). A link is only sent to emails listed in ADMIN_EMAILS.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const { email } = await readJson(request, magicLinkBodySchema);
    const allowed = isAllowedEmail(email, getAdminEmails());
    // Same call either way, so the response (cookies included) is identical.
    const supabase = await createAuthClient(allowed ? undefined : fakeAuthApi);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: new URL("/auth/callback", request.nextUrl.origin).toString(),
        shouldCreateUser: true,
      },
    });
    // Logged without the address; the client still gets { ok: true }.
    if (error) console.error(`[autoblog] Magic link could not be sent: ${error.message}`);
    await padResponseTime(startedAt);
    return json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
