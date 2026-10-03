// Helpers for route handlers: JSON responses, error mapping, body parsing and
// CORS for the public API.

import "server-only";

import { ZodError, type z } from "zod";
import { LlmError, MissingApiKeyError } from "@/core/llm";
import { publicCorsHeaders } from "./cors";
import { getAllowedOrigins } from "./env";
import {
  ConfigError,
  GenerationError,
  HttpError,
  SlotTakenError,
  SlugTakenError,
} from "./errors";

/** Documented cache policy of the public API (docs/architecture.md). */
export const PUBLIC_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";
const PRIVATE_CACHE_CONTROL = "private, no-store";
const MAX_JSON_BODY_BYTES = 1024 * 1024;

/** JSON response, never cached unless the caller sets Cache-Control. */
export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", PRIVATE_CACHE_CONTROL);
  return Response.json(data, { ...init, headers });
}

/** `{ error: code, ...extra }` with the given status. */
export function jsonError(status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return json({ ...extra, error: code }, { status });
}

/**
 * Maps any thrown value to a JSON error response. Messages that reach the
 * client never contain secrets: LLM errors are scrubbed by the adapters, and
 * unexpected errors are only logged server-side.
 */
export function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return jsonError(err.status, err.code, err.message !== err.code ? { message: err.message } : {});
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    return jsonError(400, "invalid_request", { issues });
  }
  if (err instanceof SlugTakenError) return jsonError(409, "slug_taken");
  if (err instanceof SlotTakenError) return jsonError(409, "slot_taken", { message: err.message });
  if (err instanceof MissingApiKeyError) {
    return jsonError(400, "missing_api_key", { provider: err.provider, message: err.message });
  }
  if (err instanceof LlmError) {
    console.error(`[autoblog] ${err.message}`);
    return jsonError(502, "llm_error", { provider: err.provider, message: err.message });
  }
  if (err instanceof GenerationError) {
    console.error(`[autoblog] Generation failed (${err.code}): ${err.message}`);
    return jsonError(502, err.code, { message: err.message });
  }
  if (err instanceof ConfigError) {
    console.error(`[autoblog] Configuration error: ${err.message}`);
    return jsonError(500, "server_misconfigured");
  }
  console.error("[autoblog] Unexpected error:", err);
  return jsonError(500, "internal_error");
}

/**
 * Reads a JSON body (max 1 MB) and validates it. An empty body is read as `{}`.
 * Throws HttpError (413, 400) or ZodError, both handled by errorToResponse.
 */
export async function readJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_JSON_BODY_BYTES) throw new HttpError(413, "payload_too_large");
  const text = await request.text();
  if (text.length > MAX_JSON_BODY_BYTES) throw new HttpError(413, "payload_too_large");
  let data: unknown = {};
  if (text.trim() !== "") {
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError(400, "invalid_json");
    }
  }
  return schema.parse(data);
}

// ---- Public API (CORS + CDN caching) ---------------------------------------

function withPublicCors(request: Request, response: Response): Response {
  const headers = publicCorsHeaders(request.headers.get("origin"), getAllowedOrigins());
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

/** Public JSON response: CORS headers and the documented Cache-Control. */
export function publicJson(request: Request, data: unknown, status = 200): Response {
  return withPublicCors(
    request,
    json(data, { status, headers: { "Cache-Control": PUBLIC_CACHE_CONTROL } }),
  );
}

/** Error response for public routes: CORS headers, never cached. */
export function publicError(request: Request, err: unknown): Response {
  return withPublicCors(request, errorToResponse(err));
}

/** CORS preflight for public routes. */
export function publicPreflight(request: Request): Response {
  return withPublicCors(request, new Response(null, { status: 204 }));
}
