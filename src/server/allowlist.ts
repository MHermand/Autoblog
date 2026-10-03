// ADMIN_EMAILS allowlist. Pure functions.

/**
 * Parses a comma-separated list of emails (whitespace and semicolons are also
 * accepted as separators). Trimmed, lowercased, deduplicated; blanks dropped.
 */
export function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const emails = raw
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
  return [...new Set(emails)];
}

/** Case-insensitive membership test. An empty allowlist allows nobody. */
export function isAllowedEmail(email: string | null | undefined, allowlist: readonly string[]): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && allowlist.includes(normalized);
}
