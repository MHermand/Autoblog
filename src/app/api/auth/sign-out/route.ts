import { errorToResponse, json } from "@/server/api";
import { createAuthClient } from "@/server/supabase";

/** POST /api/auth/sign-out -> { ok: true }. Clears the session cookies of this browser. */
export async function POST() {
  try {
    const supabase = await createAuthClient();
    await supabase.auth.signOut({ scope: "local" });
    return json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
