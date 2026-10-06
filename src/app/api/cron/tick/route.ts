import type { NextRequest } from "next/server";
import { errorToResponse, json, jsonError } from "@/server/api";
import { getCronSecret } from "@/server/env";
import { errorMessage } from "@/server/errors";
import { runAutomationTick } from "@/server/generation";
import { isAuthorizedBearer } from "@/server/secrets";

export const runtime = "nodejs";
/** Up to 2 articles per call. */
export const maxDuration = 300;

/**
 * GET /api/cron/tick with `Authorization: Bearer $CRON_SECRET`
 * -> { ok: true, generated, reason? }. Vercel Cron sends that header itself
 * when the CRON_SECRET environment variable is set.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedBearer(request.headers.get("authorization"), getCronSecret())) {
      return jsonError(401, "unauthorized");
    }
    const outcome = await runAutomationTick(new Date());
    if (outcome.error !== undefined) {
      // Nothing generated: surface the failure as an error status for cron monitoring.
      if (outcome.generated === 0) return errorToResponse(outcome.error);
      console.error(`[autoblog] Automation tick stopped early: ${errorMessage(outcome.error)}`);
    }
    return json({
      ok: true,
      generated: outcome.generated,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
