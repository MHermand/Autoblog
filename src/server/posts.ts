// Posts repository. All queries go through the service-role client; callers
// handle authorization. User input only ever reaches PostgREST through typed
// filter methods (never `.or()` strings), with LIKE/array values escaped.

import "server-only";

import type { Post, RecentPost } from "@/core/types";
import type { PostInsertRow } from "./db-types";
import { DatabaseError, SlugTakenError } from "./errors";
import {
  escapeLikePattern,
  patchToRow,
  PUBLIC_SUMMARY_COLUMNS,
  rowToPost,
  rowToPublicPost,
  rowToPublicSummary,
  toIso,
  toPgTextArrayLiteral,
  type PostPatch,
} from "./post-mapper";
import { getAdminClient, type AdminClient } from "./supabase";
import type { PostState, PublicPost, PublicPostSummary } from "./types";

const UNIQUE_VIOLATION = "23505";
/** PostgREST: offset beyond the last row when an exact count is requested. */
const RANGE_NOT_SATISFIABLE = "PGRST103";

function dbError(error: { message: string; code?: string }): DatabaseError {
  return new DatabaseError(error.message, error.code);
}

/** Translates a write error: the only unique constraint besides the primary key is the slug. */
function writeError(error: { message: string; code?: string }): Error {
  return error.code === UNIQUE_VIOLATION ? new SlugTakenError() : dbError(error);
}

function rangeOf(page: number, limit: number): [number, number] {
  const from = (page - 1) * limit;
  return [from, from + limit - 1];
}

// ---- Admin list ------------------------------------------------------------

export interface ListPostsParams {
  state: PostState;
  /** Case-insensitive substring of the title. */
  q: string | null;
  page: number;
  limit: number;
  now: Date;
}

function adminListQuery(db: AdminClient, p: ListPostsParams, head: boolean) {
  let query = db.from("posts").select("*", { count: "exact", head });
  const now = p.now.toISOString();
  if (p.state === "draft") query = query.is("published_at", null);
  if (p.state === "scheduled") query = query.gt("published_at", now);
  if (p.state === "live") query = query.lte("published_at", now);
  if (p.q) query = query.ilike("title", `%${escapeLikePattern(p.q)}%`);
  return query;
}

/** Drafts first, then by publication date (newest first). */
export async function listPosts(p: ListPostsParams): Promise<{ posts: Post[]; total: number }> {
  const db = getAdminClient();
  const [from, to] = rangeOf(p.page, p.limit);
  const { data, error, count } = await adminListQuery(db, p, false)
    .order("published_at", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error?.code === RANGE_NOT_SATISFIABLE) {
    const head = await adminListQuery(db, p, true);
    if (head.error) throw dbError(head.error);
    return { posts: [], total: head.count ?? 0 };
  }
  if (error) throw dbError(error);
  return { posts: (data ?? []).map(rowToPost), total: count ?? 0 };
}

// ---- Public reads (live posts only) ----------------------------------------

export interface ListLivePostsParams {
  page: number;
  limit: number;
  tag: string | null;
  now: Date;
}

function liveListQuery(db: AdminClient, p: ListLivePostsParams, head: boolean) {
  let query = db
    .from("posts")
    .select(PUBLIC_SUMMARY_COLUMNS, { count: "exact", head })
    .lte("published_at", p.now.toISOString());
  if (p.tag) query = query.contains("tags", toPgTextArrayLiteral([p.tag]));
  return query;
}

/** Newest first. */
export async function listLivePosts(
  p: ListLivePostsParams,
): Promise<{ posts: PublicPostSummary[]; total: number }> {
  const db = getAdminClient();
  const [from, to] = rangeOf(p.page, p.limit);
  const { data, error, count } = await liveListQuery(db, p, false)
    .order("published_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to);
  if (error?.code === RANGE_NOT_SATISFIABLE) {
    const head = await liveListQuery(db, p, true);
    if (head.error) throw dbError(head.error);
    return { posts: [], total: head.count ?? 0 };
  }
  if (error) throw dbError(error);
  return { posts: (data ?? []).map(rowToPublicSummary), total: count ?? 0 };
}

export async function getLivePostBySlug(slug: string, now: Date): Promise<PublicPost | null> {
  const { data, error } = await getAdminClient()
    .from("posts")
    .select("*")
    .eq("slug", slug)
    .lte("published_at", now.toISOString())
    .maybeSingle();
  if (error) throw dbError(error);
  return data ? rowToPublicPost(data) : null;
}

// ---- CRUD ------------------------------------------------------------------

export async function getPostById(id: string): Promise<Post | null> {
  const { data, error } = await getAdminClient().from("posts").select("*").eq("id", id).maybeSingle();
  if (error) throw dbError(error);
  return data ? rowToPost(data) : null;
}

/** Throws SlugTakenError when the slug is already used. */
export async function createPost(row: PostInsertRow): Promise<Post> {
  const { data, error } = await getAdminClient().from("posts").insert(row).select("*").single();
  if (error) throw writeError(error);
  return rowToPost(data);
}

/** null when the post does not exist. Throws SlugTakenError on a slug conflict. */
export async function updatePost(id: string, patch: PostPatch): Promise<Post | null> {
  const row = patchToRow(patch);
  if (Object.keys(row).length === 0) return getPostById(id);
  const { data, error } = await getAdminClient()
    .from("posts")
    .update(row)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw writeError(error);
  return data ? rowToPost(data) : null;
}

/** false when the post does not exist. */
export async function deletePost(id: string): Promise<boolean> {
  const { data, error } = await getAdminClient().from("posts").delete().eq("id", id).select("id");
  if (error) throw dbError(error);
  return (data ?? []).length > 0;
}

// ---- Slugs -----------------------------------------------------------------

/** Every slug equal to `base` or starting with it (candidates for nextAvailableSlug). */
export async function findSlugsWithPrefix(base: string, excludeId?: string | null): Promise<string[]> {
  let query = getAdminClient().from("posts").select("slug").like("slug", `${escapeLikePattern(base)}%`);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw dbError(error);
  return (data ?? []).map((row) => row.slug);
}

// ---- Automation ------------------------------------------------------------

/** Posts published since `since`, scheduled ones included (drafts excluded). */
export async function getRecentPosts(since: Date): Promise<RecentPost[]> {
  const { data, error } = await getAdminClient()
    .from("posts")
    .select("title,tags,published_at")
    .gte("published_at", since.toISOString())
    .order("published_at", { ascending: false })
    .limit(500);
  if (error) throw dbError(error);
  return (data ?? []).map((row) => ({
    title: row.title,
    tags: row.tags ?? [],
    publishedAt: toIso(row.published_at ?? ""),
  }));
}

async function latestAutoPublishedAt(before: Date | null): Promise<Date | null> {
  let query = getAdminClient()
    .from("posts")
    .select("published_at")
    .eq("source", "auto")
    .not("published_at", "is", null);
  if (before) query = query.lte("published_at", before.toISOString());
  const { data, error } = await query.order("published_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw dbError(error);
  return data?.published_at ? new Date(data.published_at) : null;
}

/**
 * The last filled slot: latest publication date among auto posts up to
 * `horizonEnd`, future ones included. Posts an admin moved beyond the horizon
 * are ignored, otherwise they would block the automation until their date.
 */
export function getLastAutoSlot(horizonEnd: Date): Promise<Date | null> {
  return latestAutoPublishedAt(horizonEnd);
}

/** Latest auto post that is already live. */
export function getLastLiveAutoPublishedAt(now: Date): Promise<Date | null> {
  return latestAutoPublishedAt(now);
}

export async function countUpcomingAutoPosts(now: Date): Promise<number> {
  const { count, error } = await getAdminClient()
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("source", "auto")
    .gt("published_at", now.toISOString());
  if (error) throw dbError(error);
  return count ?? 0;
}

/** Scheduled auto posts, soonest first. */
export async function listUpcomingAutoPosts(now: Date): Promise<{ id: string; publishedAt: string }[]> {
  const { data, error } = await getAdminClient()
    .from("posts")
    .select("id,published_at")
    .eq("source", "auto")
    .gt("published_at", now.toISOString())
    .order("published_at", { ascending: true });
  if (error) throw dbError(error);
  return (data ?? []).map((row) => ({ id: row.id, publishedAt: toIso(row.published_at ?? "") }));
}

export async function autoPostExistsAt(slot: Date): Promise<boolean> {
  const { count, error } = await getAdminClient()
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("source", "auto")
    .eq("published_at", slot.toISOString());
  if (error) throw dbError(error);
  return (count ?? 0) > 0;
}

export async function setPublishedAt(id: string, publishedAt: Date): Promise<void> {
  const { error } = await getAdminClient()
    .from("posts")
    .update({ published_at: publishedAt.toISOString() })
    .eq("id", id);
  if (error) throw dbError(error);
}
