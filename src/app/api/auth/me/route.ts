import { errorToResponse, json, jsonError } from "@/server/api";
import { getSessionUser } from "@/server/auth";

/** GET /api/auth/me -> { email } or 401 when signed out. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError(401, "unauthorized");
    return json({ email: user.email });
  } catch (err) {
    return errorToResponse(err);
  }
}
