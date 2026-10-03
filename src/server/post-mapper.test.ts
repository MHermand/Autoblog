import { describe, expect, it } from "vitest";
import type { PostRow } from "./db-types";
import {
  escapeLikePattern,
  patchToRow,
  rowToPost,
  rowToPublicPost,
  rowToPublicSummary,
  toPgTextArrayLiteral,
  type PostPatch,
} from "./post-mapper";

const row: PostRow = {
  id: "8c6a7f0e-3b1d-4c2a-9f1e-1a2b3c4d5e6f",
  slug: "hello-world",
  title: "Hello world",
  excerpt: "An excerpt.",
  content_markdown: "## Intro\n\nSome **bold** text.\n\n<script>alert(1)</script>",
  cover_image_url: "https://cdn.example.com/cover.png",
  cover_image_alt: "A cover",
  tags: ["news", "tips"],
  meta_title: "Hello",
  meta_description: "Meta description",
  lang: "en",
  source: "auto",
  published_at: "2026-10-01 09:00:00+00",
  created_at: "2026-09-30T10:00:00.123456+00:00",
  updated_at: "2026-09-30T11:00:00+00:00",
};

describe("rowToPost", () => {
  it("maps snake_case columns to the Post shape with canonical ISO dates", () => {
    expect(rowToPost(row)).toEqual({
      id: row.id,
      slug: "hello-world",
      title: "Hello world",
      excerpt: "An excerpt.",
      contentMarkdown: row.content_markdown,
      coverImageUrl: "https://cdn.example.com/cover.png",
      coverImageAlt: "A cover",
      tags: ["news", "tips"],
      metaTitle: "Hello",
      metaDescription: "Meta description",
      lang: "en",
      source: "auto",
      publishedAt: "2026-10-01T09:00:00.000Z",
      createdAt: "2026-09-30T10:00:00.123Z",
      updatedAt: "2026-09-30T11:00:00.000Z",
    });
  });

  it("keeps drafts as null and coerces an unknown source to manual", () => {
    const post = rowToPost({ ...row, published_at: null, source: "weird" });
    expect(post.publishedAt).toBeNull();
    expect(post.source).toBe("manual");
  });
});

describe("public mappers", () => {
  it("summaries expose only public fields", () => {
    const summary = rowToPublicSummary(row);
    expect(Object.keys(summary).sort()).toEqual(
      [
        "coverImageAlt",
        "coverImageUrl",
        "excerpt",
        "lang",
        "metaDescription",
        "metaTitle",
        "publishedAt",
        "slug",
        "tags",
        "title",
      ].sort(),
    );
    expect(summary).not.toHaveProperty("id");
    expect(summary).not.toHaveProperty("source");
  });

  it("full posts carry sanitized HTML and a reading time", () => {
    const post = rowToPublicPost(row);
    expect(post.contentMarkdown).toBe(row.content_markdown);
    expect(post.contentHtml).toContain("<strong>bold</strong>");
    expect(post.contentHtml).not.toContain("<script");
    expect(post.readingTimeMinutes).toBeGreaterThanOrEqual(1);
    expect(post.updatedAt).toBe("2026-09-30T11:00:00.000Z");
  });
});

describe("patchToRow", () => {
  it("maps each editable field to its column", () => {
    expect(
      patchToRow({
        title: "T",
        slug: "s",
        excerpt: "e",
        contentMarkdown: "md",
        coverImageUrl: null,
        coverImageAlt: null,
        tags: ["a"],
        metaTitle: "mt",
        metaDescription: "md2",
        publishedAt: "2026-10-01T11:00:00+02:00",
      }),
    ).toEqual({
      title: "T",
      slug: "s",
      excerpt: "e",
      content_markdown: "md",
      cover_image_url: null,
      cover_image_alt: null,
      tags: ["a"],
      meta_title: "mt",
      meta_description: "md2",
      published_at: "2026-10-01T09:00:00.000Z",
    });
  });

  it("drops keys outside the whitelist and keeps null publishedAt (back to draft)", () => {
    const sneaky = { publishedAt: null, id: "x", source: "auto", created_at: "2000-01-01" } as unknown as PostPatch;
    expect(patchToRow(sneaky)).toEqual({ published_at: null });
    expect(patchToRow({})).toEqual({});
  });
});

describe("filter escaping", () => {
  it("escapes LIKE wildcards and the PostgREST * alias", () => {
    expect(escapeLikePattern("100%_off\\*")).toBe("100\\%\\_off\\\\_");
    expect(escapeLikePattern("plain text")).toBe("plain text");
  });

  it("quotes array literal items", () => {
    expect(toPgTextArrayLiteral(["seo"])).toBe('{"seo"}');
    expect(toPgTextArrayLiteral(['a,b}', 'q"\\'])).toBe('{"a,b}","q\\"\\\\"}');
  });
});
