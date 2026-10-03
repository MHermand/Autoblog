import { json, readJson } from "@/server/api";
import { adminRoute } from "@/server/auth";
import { HttpError } from "@/server/errors";
import { deletePost, getPostById, updatePost } from "@/server/posts";
import { postPatchSchema, uuidSchema } from "@/server/schemas";

type Context = { params: Promise<{ id: string }> };

/** A malformed id cannot match any post: 404, not a database error. */
async function postId(context: Context): Promise<string> {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) throw new HttpError(404, "not_found");
  return id;
}

/** GET /api/admin/posts/:id -> { post } */
export const GET = adminRoute<Context>(async (_request, context) => {
  const post = await getPostById(await postId(context));
  if (!post) throw new HttpError(404, "not_found");
  return json({ post });
});

/**
 * PATCH /api/admin/posts/:id with any of title, slug, excerpt, contentMarkdown,
 * coverImageUrl, coverImageAlt, tags, metaTitle, metaDescription, publishedAt
 * -> { post }; 409 { error: "slug_taken" } on a slug conflict.
 */
export const PATCH = adminRoute<Context>(async (request, context) => {
  const id = await postId(context);
  const patch = await readJson(request, postPatchSchema);
  const post = await updatePost(id, patch);
  if (!post) throw new HttpError(404, "not_found");
  return json({ post });
});

/** DELETE /api/admin/posts/:id -> { ok: true } */
export const DELETE = adminRoute<Context>(async (_request, context) => {
  const deleted = await deletePost(await postId(context));
  if (!deleted) throw new HttpError(404, "not_found");
  return json({ ok: true });
});
