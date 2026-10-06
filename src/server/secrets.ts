// Secret comparison for the cron endpoint.

import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string equality (hashing first makes the lengths equal). */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match ? match[1] : null;
}

/** true when the Authorization header carries exactly `secret` (never true for an empty secret). */
export function isAuthorizedBearer(header: string | null | undefined, secret: string): boolean {
  const token = bearerToken(header);
  return secret.length > 0 && token !== null && safeEqual(token, secret);
}
