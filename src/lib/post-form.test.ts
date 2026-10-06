import { describe, expect, it } from "vitest";
import type { Post } from "../core/types";
import { buildPostPatch, normalizeSlugInput, postToForm, SLUG_PATTERN } from "./post-form";

const TZ = "Europe/Paris";

const post: Post = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "my-first-post",
  title: "My first post",
  excerpt: "An excerpt.",
  contentMarkdown: "## Hello\n\nWorld",
  coverImageUrl: null,
  coverImageAlt: null,
  tags: ["seo", "blog"],
  metaTitle: "My first post | Acme",
  metaDescription: "A description.",
  lang: "en",
  source: "manual",
  publishedAt: "2026-07-01T10:30:42.000Z",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

describe("buildPostPatch", () => {
  it("is empty when nothing changed", () => {
    expect(buildPostPatch(post, postToForm(post, TZ), TZ)).toEqual({});
  });

  it("sends only the fields that changed", () => {
    const form = { ...postToForm(post, TZ), title: "A new title", tags: ["seo"] };
    expect(buildPostPatch(post, form, TZ)).toEqual({ title: "A new title", tags: ["seo"] });
  });

  it("ignores whitespace-only edits of single-line fields", () => {
    const form = { ...postToForm(post, TZ), title: "  My first post  ", slug: "my-first-post " };
    expect(buildPostPatch(post, form, TZ)).toEqual({});
  });

  it("keeps the body exactly as typed", () => {
    const form = { ...postToForm(post, TZ), contentMarkdown: post.contentMarkdown + "\n" };
    expect(buildPostPatch(post, form, TZ)).toEqual({ contentMarkdown: "## Hello\n\nWorld\n" });
  });

  it("maps empty cover image fields to null and back", () => {
    const withCover = { ...post, coverImageUrl: "https://x.test/a.png", coverImageAlt: "Alt" };
    const cleared = { ...postToForm(withCover, TZ), coverImageUrl: "", coverImageAlt: "" };
    expect(buildPostPatch(withCover, cleared, TZ)).toEqual({ coverImageUrl: null, coverImageAlt: null });

    const added = { ...postToForm(post, TZ), coverImageUrl: " https://x.test/b.png ", coverImageAlt: "Cat" };
    expect(buildPostPatch(post, added, TZ)).toEqual({ coverImageUrl: "https://x.test/b.png", coverImageAlt: "Cat" });
  });

  it("does not resend an untouched publication date (keeps its seconds)", () => {
    expect(postToForm(post, TZ).publishedAtLocal).toBe("2026-07-01T12:30");
    expect(buildPostPatch(post, postToForm(post, TZ), TZ)).not.toHaveProperty("publishedAt");
  });

  it("converts an edited publication date from the blog timezone", () => {
    const form = { ...postToForm(post, TZ), publishedAtLocal: "2026-07-02T09:00" };
    expect(buildPostPatch(post, form, TZ)).toEqual({ publishedAt: "2026-07-02T07:00:00.000Z" });
  });

  it("unschedules by sending null", () => {
    const form = { ...postToForm(post, TZ), publishedAtLocal: "" };
    expect(buildPostPatch(post, form, TZ)).toEqual({ publishedAt: null });
  });

  it("schedules a draft", () => {
    const draft = { ...post, publishedAt: null };
    const form = { ...postToForm(draft, TZ), publishedAtLocal: "2026-12-25T08:00" };
    expect(buildPostPatch(draft, form, TZ)).toEqual({ publishedAt: "2026-12-25T07:00:00.000Z" });
  });
});

describe("slugs", () => {
  it("normalizes typing", () => {
    expect(normalizeSlugInput("Hello World")).toBe("hello-world");
    expect(normalizeSlugInput("a  b")).toBe("a-b");
  });

  it("validates the slug pattern", () => {
    for (const ok of ["a", "my-post", "post-2026", "a1-b2-c3", "как-выбрать", "日本語"]) expect(SLUG_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["", "-a", "a-", "a--b", "A", "a b", "Ж", "a_b"]) expect(SLUG_PATTERN.test(bad), bad).toBe(false);
  });
});
