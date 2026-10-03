// zod schemas for admin and auth request bodies. Pure.

import { z } from "zod";
import type { PostPatch } from "./post-mapper";

/**
 * Words separated by single dashes, like slugify() output: lowercase or
 * caseless letters (any script), combining marks and digits. No uppercase.
 */
export const SLUG_PATTERN = /^[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]+)*$/u;
export const SLUG_MAX_LENGTH = 200;

export function isValidSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** ISO 8601 date-time with "Z" or an offset. */
export const isoDateTime = z.iso.datetime({ offset: true });

export const uuidSchema = z.uuid();

const tags = z
  .array(z.string().trim().max(50))
  .max(20)
  .transform((values) => [...new Set(values.filter((tag) => tag !== ""))]);

/**
 * PATCH /api/admin/posts/:id. Only the documented fields are kept (unknown
 * keys are stripped), and repository code maps them column by column again.
 */
export const postPatchSchema: z.ZodType<PostPatch> = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().refine(isValidSlug, "invalid slug").optional(),
  excerpt: z.string().trim().max(1000).optional(),
  contentMarkdown: z.string().max(200_000).optional(),
  coverImageUrl: z
    .string()
    .trim()
    .max(2048)
    .refine(isHttpUrl, "must be an http(s) URL")
    .nullable()
    .optional(),
  coverImageAlt: z.string().trim().max(300).nullable().optional(),
  tags: tags.optional(),
  metaTitle: z.string().trim().max(200).optional(),
  metaDescription: z.string().trim().max(500).optional(),
  publishedAt: isoDateTime.nullable().optional(),
});

/** POST /api/admin/topics */
export const topicsBodySchema = z.object({
  count: z.number().int().min(1).max(5).default(3),
  exclude: z
    .array(z.string().trim().max(300))
    .max(50)
    .default([])
    .transform((values) => values.filter((value) => value !== "")),
});

/** POST /api/admin/generate */
export const generateBodySchema = z.object({
  topic: z.string().trim().min(1).max(500),
  publishedAt: isoDateTime.nullable().optional(),
});

/** POST /api/auth/magic-link */
export const magicLinkBodySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
});

/** PUT /api/admin/settings (the settings themselves are validated by settingsSchema). */
export const settingsBodySchema = z.object({
  settings: z.unknown(),
});

/** GET /api/admin/posts `state` filter. */
export const postStateSchema = z.enum(["all", "draft", "scheduled", "live"]);
