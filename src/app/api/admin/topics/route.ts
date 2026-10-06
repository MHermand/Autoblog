import { json, readJson } from "@/server/api";
import { adminRoute } from "@/server/auth";
import { suggestTopics } from "@/server/generation";
import { topicsBodySchema } from "@/server/schemas";

/** One LLM call; leave room above the platform's short default timeout. */
export const maxDuration = 60;

/** POST /api/admin/topics { count?: 1-5 (default 3), exclude?: string[] } -> { topics } */
export const POST = adminRoute(async (request) => {
  const { count, exclude } = await readJson(request, topicsBodySchema);
  const topics = await suggestTopics({ count, exclude, now: new Date() });
  return json({ topics });
});
