// Query-string parsing for list endpoints. Pure functions.

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 100_000;

function parseInteger(value: string | null): number | null {
  if (value === null || !/^\s*\d+\s*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/** Lenient: missing or invalid values fall back to defaults, out-of-range values are clamped. */
export function parsePagination(params: URLSearchParams): { page: number; limit: number } {
  const page = parseInteger(params.get("page"));
  const limit = parseInteger(params.get("limit"));
  return {
    page: page === null ? 1 : Math.min(Math.max(page, 1), MAX_PAGE),
    limit: limit === null ? DEFAULT_PAGE_SIZE : Math.min(Math.max(limit, 1), MAX_PAGE_SIZE),
  };
}

/** Trimmed, length-capped optional string parameter ("" -> null). */
export function parseText(params: URLSearchParams, name: string, maxLength: number): string | null {
  const value = params.get(name)?.trim().slice(0, maxLength) ?? "";
  return value === "" ? null : value;
}
