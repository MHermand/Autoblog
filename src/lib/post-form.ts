// Form model for the article editor: conversion from a stored `Post`, and the
// minimal PATCH payload for what the user actually changed.

import type { Post } from "@/core/types";
import type { PostPatch } from "@/lib/api";
import { isoToZonedInput, zonedInputToIso } from "@/lib/datetime";

/** Same rule as the server (src/server/schemas.ts): lowercase or caseless letters of any script, digits, single dashes. */
export const SLUG_PATTERN = /^[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]+)*$/u;

export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MAX = 160;

export interface PostFormState {
  title: string;
  slug: string;
  excerpt: string;
  contentMarkdown: string;
  coverImageUrl: string;
  coverImageAlt: string;
  tags: string[];
  metaTitle: string;
  metaDescription: string;
  /** `datetime-local` value in the blog timezone; "" = draft. */
  publishedAtLocal: string;
}

export function postToForm(post: Post, timeZone: string): PostFormState {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    contentMarkdown: post.contentMarkdown,
    coverImageUrl: post.coverImageUrl ?? "",
    coverImageAlt: post.coverImageAlt ?? "",
    tags: post.tags,
    metaTitle: post.metaTitle,
    metaDescription: post.metaDescription,
    publishedAtLocal: isoToZonedInput(post.publishedAt, timeZone),
  };
}

/** Typing a slug: lowercase it and turn spaces into dashes as the user types. */
export function normalizeSlugInput(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "-");
}

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

/**
 * The fields of `form` that differ from the stored `post`, ready for PATCH.
 * Single-line fields are compared trimmed; the body is compared as typed; the
 * publication date is only sent when its minute-precision input changed (so an
 * untouched date keeps its seconds). Empty cover image fields become null.
 */
export function buildPostPatch(post: Post, form: PostFormState, timeZone: string): PostPatch {
  const original = postToForm(post, timeZone);
  const patch: PostPatch = {};

  const title = form.title.trim();
  if (title !== original.title) patch.title = title;

  const slug = form.slug.trim();
  if (slug !== original.slug) patch.slug = slug;

  const excerpt = form.excerpt.trim();
  if (excerpt !== original.excerpt) patch.excerpt = excerpt;

  if (form.contentMarkdown !== original.contentMarkdown) patch.contentMarkdown = form.contentMarkdown;

  const coverImageUrl = form.coverImageUrl.trim();
  if (coverImageUrl !== original.coverImageUrl) patch.coverImageUrl = coverImageUrl || null;

  const coverImageAlt = form.coverImageAlt.trim();
  if (coverImageAlt !== original.coverImageAlt) patch.coverImageAlt = coverImageAlt || null;

  if (!sameTags(form.tags, original.tags)) patch.tags = form.tags;

  const metaTitle = form.metaTitle.trim();
  if (metaTitle !== original.metaTitle) patch.metaTitle = metaTitle;

  const metaDescription = form.metaDescription.trim();
  if (metaDescription !== original.metaDescription) patch.metaDescription = metaDescription;

  if (form.publishedAtLocal !== original.publishedAtLocal) {
    if (form.publishedAtLocal === "") {
      patch.publishedAt = null;
    } else {
      const iso = zonedInputToIso(form.publishedAtLocal, timeZone);
      if (iso) patch.publishedAt = iso;
    }
  }

  return patch;
}
