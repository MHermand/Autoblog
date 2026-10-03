import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/server/allowlist";
import { getAdminEmails } from "@/server/env";
import { createAuthClient } from "@/server/supabase";

const OTP_TYPES: readonly string[] = ["email", "magiclink", "signup", "invite"];

function redirect(request: NextRequest, pathname: "/admin" | "/login", error?: string) {
  const url = new URL(pathname, request.url);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

/**
 * GET /auth/callback?code=… — magic-link landing (PKCE): exchanges the code for
 * a session cookie, then redirects to /admin, or to /login?error=<code> with
 * error = auth_failed | missing_code | forbidden.
 * Also accepts ?token_hash=…&type=email for custom email templates, which works
 * even when the link is opened in another browser.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // Supabase reports expired or invalid links with ?error=…&error_description=…
  if (params.get("error")) return redirect(request, "/login", "auth_failed");

  try {
    const supabase = await createAuthClient();
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const type = params.get("type");

    let result;
    if (code) {
      result = await supabase.auth.exchangeCodeForSession(code);
    } else if (tokenHash && type && OTP_TYPES.includes(type)) {
      result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    } else {
      return redirect(request, "/login", "missing_code");
    }

    const email = result.data.user?.email;
    if (result.error || !email) return redirect(request, "/login", "auth_failed");
    if (!isAllowedEmail(email, getAdminEmails())) {
      await supabase.auth.signOut({ scope: "local" });
      return redirect(request, "/login", "forbidden");
    }
    return redirect(request, "/admin");
  } catch (err) {
    console.error("[autoblog] Auth callback failed:", err instanceof Error ? err.message : err);
    return redirect(request, "/login", "auth_failed");
  }
}
