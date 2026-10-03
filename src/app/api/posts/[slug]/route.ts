import type { NextRequest } from "next/server";
import { publicError, publicJson, publicPreflight } from "@/server/api";
import { getLivePostBySlug } from "@/server/posts";
import { SLUG_MAX_LENGTH } from "@/server/schemas";

/** GET /api/posts/:slug — one live post, or 404. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const post = slug.length <= SLUG_MAX_LENGTH ? await getLivePostBySlug(slug, new Date()) : null;
    if (!post) return publicJson(request, { error: "not_found" }, 404);
    return publicJson(request, { post });
  } catch (err) {
    return publicError(request, err);
  }
}

export function OPTIONS(request: NextRequest) {
  return publicPreflight(request);
}
