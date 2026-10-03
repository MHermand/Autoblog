import { json, readJson } from "@/server/api";
import { adminRoute } from "@/server/auth";
import { generatePost } from "@/server/generation";
import { generateBodySchema } from "@/server/schemas";

export const runtime = "nodejs";
/** Article + title fix + images: up to ~2 minutes. */
export const maxDuration = 300;

/** POST /api/admin/generate { topic, publishedAt?: ISO | null } -> { post, warnings } */
export const POST = adminRoute(async (request) => {
  const { topic, publishedAt } = await readJson(request, generateBodySchema);
  const result = await generatePost({
    topic,
    publishedAt: publishedAt ? new Date(publishedAt) : null,
    source: "manual",
  });
  return json(result);
});
