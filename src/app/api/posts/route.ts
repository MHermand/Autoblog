import type { NextRequest } from "next/server";
import { publicError, publicJson, publicPreflight } from "@/server/api";
import { parsePagination, parseText } from "@/server/params";
import { listLivePosts } from "@/server/posts";

/** GET /api/posts?page=1&limit=20&tag=foo — live posts, newest first. */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const { page, limit } = parsePagination(params);
    const tag = parseText(params, "tag", 100);
    const { posts, total } = await listLivePosts({ page, limit, tag, now: new Date() });
    return publicJson(request, { posts, page, limit, total });
  } catch (err) {
    return publicError(request, err);
  }
}

export function OPTIONS(request: NextRequest) {
  return publicPreflight(request);
}
