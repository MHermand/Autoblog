// Row <-> API mapping for posts, plus PostgREST filter escaping. No I/O.

import { renderMarkdown } from "@/core/markdown";
import { readingTimeMinutes } from "@/core/seo";
import type { Post } from "@/core/types";
import type { PostRow, PostUpdateRow } from "./db-types";
import type { PublicPost, PublicPostSummary } from "./types";

/** Columns needed for a PublicPostSummary (lists skip the article body). */
export const PUBLIC_SUMMARY_COLUMNS =
  "slug,title,excerpt,cover_image_url,cover_image_alt,tags,lang,published_at,meta_title,meta_description";

export type PublicSummaryRow = Pick<
  PostRow,
  | "slug"
  | "title"
  | "excerpt"
  | "cover_image_url"
  | "cover_image_alt"
  | "tags"
  | "lang"
  | "published_at"
  | "meta_title"
  | "meta_description"
>;

/** Postgres timestamps ("2026-01-01 09:00:00+00") -> canonical ISO ("2026-01-01T09:00:00.000Z"). */
export function toIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function toIsoOrNull(value: string | null): string | null {
  return value === null ? null : toIso(value);
}

export function rowToPost(row: PostRow): Post {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    contentMarkdown: row.content_markdown,
    coverImageUrl: row.cover_image_url,
    coverImageAlt: row.cover_image_alt,
    tags: row.tags ?? [],
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    lang: row.lang,
    source: row.source === "auto" ? "auto" : "manual",
    publishedAt: toIsoOrNull(row.published_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function rowToPublicSummary(row: PublicSummaryRow): PublicPostSummary {
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    coverImageUrl: row.cover_image_url,
    coverImageAlt: row.cover_image_alt,
    tags: row.tags ?? [],
    lang: row.lang,
    // Only live posts reach the public mappers, so published_at is set.
    publishedAt: toIso(row.published_at ?? ""),
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
  };
}

export function rowToPublicPost(row: PostRow): PublicPost {
  return {
    ...rowToPublicSummary(row),
    contentMarkdown: row.content_markdown,
    contentHtml: renderMarkdown(row.content_markdown),
    readingTimeMinutes: readingTimeMinutes(row.content_markdown),
    updatedAt: toIso(row.updated_at),
  };
}

/** The editable fields of a post (PATCH /api/admin/posts/:id), already validated. */
export interface PostPatch {
  title?: string;
  slug?: string;
  excerpt?: string;
  contentMarkdown?: string;
  coverImageUrl?: string | null;
  coverImageAlt?: string | null;
  tags?: string[];
  metaTitle?: string;
  metaDescription?: string;
  /** ISO timestamp, or null to turn the post back into a draft. */
  publishedAt?: string | null;
}

/**
 * Explicit field-by-field whitelist: only these columns can ever be written
 * from a patch, whatever extra keys the object carries at runtime.
 */
export function patchToRow(patch: PostPatch): PostUpdateRow {
  const row: PostUpdateRow = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.slug !== undefined) row.slug = patch.slug;
  if (patch.excerpt !== undefined) row.excerpt = patch.excerpt;
  if (patch.contentMarkdown !== undefined) row.content_markdown = patch.contentMarkdown;
  if (patch.coverImageUrl !== undefined) row.cover_image_url = patch.coverImageUrl;
  if (patch.coverImageAlt !== undefined) row.cover_image_alt = patch.coverImageAlt;
  if (patch.tags !== undefined) row.tags = patch.tags;
  if (patch.metaTitle !== undefined) row.meta_title = patch.metaTitle;
  if (patch.metaDescription !== undefined) row.meta_description = patch.metaDescription;
  if (patch.publishedAt !== undefined) {
    row.published_at = patch.publishedAt === null ? null : new Date(patch.publishedAt).toISOString();
  }
  return row;
}

/**
 * Escapes user text for a LIKE/ILIKE pattern: `\`, `%` and `_` become literals.
 * PostgREST also treats `*` as `%`, and it cannot be escaped, so it is turned
 * into the single-character wildcard `_` (still matches a literal `*`).
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "_");
}

/** Quoted Postgres array literal for PostgREST `cs`/`cd` filters: ['a"b'] -> {"a\"b"}. */
export function toPgTextArrayLiteral(values: readonly string[]): string {
  const items = values.map((value) => `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`);
  return `{${items.join(",")}}`;
}
