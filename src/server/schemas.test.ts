import { describe, expect, it } from "vitest";
import {
  generateBodySchema,
  isValidSlug,
  magicLinkBodySchema,
  postPatchSchema,
  topicsBodySchema,
} from "./schemas";

describe("postPatchSchema", () => {
  it("keeps documented fields and strips everything else", () => {
    const parsed = postPatchSchema.parse({
      title: "  New title ",
      tags: ["a", " a ", "", "b"],
      id: "other",
      source: "auto",
      lang: "fr",
    });
    expect(parsed).toEqual({ title: "New title", tags: ["a", "b"] });
  });

  it("accepts publishedAt as an ISO string with offset, or null", () => {
    expect(postPatchSchema.parse({ publishedAt: "2026-10-03T09:00:00Z" }).publishedAt).toBe("2026-10-03T09:00:00Z");
    expect(postPatchSchema.parse({ publishedAt: "2026-10-03T09:00:00+02:00" }).publishedAt).toBeDefined();
    expect(postPatchSchema.parse({ publishedAt: null }).publishedAt).toBeNull();
    expect(postPatchSchema.safeParse({ publishedAt: "tomorrow" }).success).toBe(false);
    expect(postPatchSchema.safeParse({ publishedAt: "2026-10-03" }).success).toBe(false);
  });

  it("rejects malformed slugs, empty titles and non-http cover URLs", () => {
    expect(postPatchSchema.safeParse({ slug: "Hello World" }).success).toBe(false);
    expect(postPatchSchema.safeParse({ slug: "a--b" }).success).toBe(false);
    expect(postPatchSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(postPatchSchema.safeParse({ coverImageUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(postPatchSchema.safeParse({ coverImageUrl: "https://cdn.example.com/a.png" }).success).toBe(true);
    expect(postPatchSchema.safeParse({ coverImageUrl: null }).success).toBe(true);
  });
});

describe("isValidSlug", () => {
  it("accepts slugify-style slugs, including numbered ones", () => {
    expect(isValidSlug("hello-world-2")).toBe(true);
    expect(isValidSlug("-hello")).toBe(false);
    expect(isValidSlug("Hello")).toBe(false);
    expect(isValidSlug("hello world")).toBe(false);
    expect(isValidSlug("как-выбрать-ноутбук")).toBe(true);
    expect(isValidSlug("日本語のタイトル")).toBe(true);
    expect(isValidSlug("a".repeat(201))).toBe(false);
  });
});

describe("other bodies", () => {
  it("topics: defaults and bounds", () => {
    expect(topicsBodySchema.parse({})).toEqual({ count: 3, exclude: [] });
    expect(topicsBodySchema.parse({ exclude: ["x", " "] }).exclude).toEqual(["x"]);
    expect(topicsBodySchema.safeParse({ count: 6 }).success).toBe(false);
    expect(topicsBodySchema.safeParse({ count: 0 }).success).toBe(false);
  });

  it("generate: topic required, publishedAt optional or null", () => {
    expect(generateBodySchema.parse({ topic: " SEO basics " })).toEqual({ topic: "SEO basics" });
    expect(generateBodySchema.parse({ topic: "x", publishedAt: null }).publishedAt).toBeNull();
    expect(generateBodySchema.safeParse({ topic: "" }).success).toBe(false);
  });

  it("magic link: normalizes the email", () => {
    expect(magicLinkBodySchema.parse({ email: "  Admin@Example.COM " })).toEqual({ email: "admin@example.com" });
    expect(magicLinkBodySchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });
});
