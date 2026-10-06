// CORS for the public API (PUBLIC_API_ALLOWED_ORIGINS). Pure functions.

export type AllowedOrigins = "*" | readonly string[];

/** "https://Example.com/" -> "https://example.com"; null for anything that is not an http(s) origin. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Comma-separated origins. Unset, blank or containing "*" means any origin.
 * Invalid entries are ignored; if none is valid the result is an empty list
 * (no cross-origin access), never "*".
 */
export function parseAllowedOrigins(raw: string | null | undefined): AllowedOrigins {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0 || entries.includes("*")) return "*";
  const origins = entries.map(normalizeOrigin).filter((origin): origin is string => origin !== null);
  return [...new Set(origins)];
}

/** Value for Access-Control-Allow-Origin, or null when the origin is not allowed. */
export function resolveAllowOrigin(requestOrigin: string | null, allowed: AllowedOrigins): string | null {
  if (allowed === "*") return "*";
  const origin = normalizeOrigin(requestOrigin);
  return origin && allowed.includes(origin) ? origin : null;
}

/** Headers for public GET responses and their preflight. */
export function publicCorsHeaders(requestOrigin: string | null, allowed: AllowedOrigins): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  const allowOrigin = resolveAllowOrigin(requestOrigin, allowed);
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  // The response depends on the Origin header whenever we echo it back.
  if (allowed !== "*") headers["Vary"] = "Origin";
  return headers;
}
