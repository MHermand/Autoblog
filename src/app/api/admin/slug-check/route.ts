import { nextAvailableSlug, slugify } from "@/core/slug";
import { json } from "@/server/api";
import { adminRoute } from "@/server/auth";
import { parseText } from "@/server/params";
import { findSlugsWithPrefix } from "@/server/posts";
import { isValidSlug, SLUG_MAX_LENGTH, uuidSchema } from "@/server/schemas";

/**
 * GET /api/admin/slug-check?slug=…&excludeId=… -> { available, suggestion }.
 * `available` is true only for a well-formed slug that no other post uses;
 * `suggestion` is the first free slug derived from the input.
 */
export const GET = adminRoute(async (request) => {
  const params = request.nextUrl.searchParams;
  const raw = parseText(params, "slug", SLUG_MAX_LENGTH) ?? "";
  const excludeParam = params.get("excludeId");
  const excludeId = excludeParam && uuidSchema.safeParse(excludeParam).success ? excludeParam : null;

  const candidate = isValidSlug(raw) ? raw : slugify(raw);
  const taken = await findSlugsWithPrefix(candidate, excludeId);
  return json({
    available: candidate === raw && !taken.includes(candidate),
    suggestion: nextAvailableSlug(candidate, taken),
  });
});
