import { json } from "@/server/api";
import { adminRoute } from "@/server/auth";
import { parsePagination, parseText } from "@/server/params";
import { listPosts } from "@/server/posts";
import { postStateSchema } from "@/server/schemas";

/** GET /api/admin/posts?page=1&limit=20&q=&state=all|draft|scheduled|live */
export const GET = adminRoute(async (request) => {
  const params = request.nextUrl.searchParams;
  const { page, limit } = parsePagination(params);
  const state = postStateSchema.parse(params.get("state") || "all");
  const q = parseText(params, "q", 200);
  const { posts, total } = await listPosts({ state, q, page, limit, now: new Date() });
  return json({ posts, page, limit, total });
});
