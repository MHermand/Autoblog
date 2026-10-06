import { describe, expect, it } from "vitest";
import { nextAvailableSlug, slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips diacritics", () => {
    expect(slugify("Éco-rénovation : l'été à Zürich")).toBe("eco-renovation-l-ete-a-zurich");
    expect(slugify("Ñandú y canción")).toBe("nandu-y-cancion");
  });

  it("folds Latin letters that NFD does not decompose", () => {
    expect(slugify("Straße")).toBe("strasse");
    expect(slugify("Cœur d'Æsir")).toBe("coeur-d-aesir");
    expect(slugify("Łódź Øresund")).toBe("lodz-oresund");
  });

  it("collapses runs of separators and trims dashes", () => {
    expect(slugify("  --Hello,   world!!  ")).toBe("hello-world");
    expect(slugify("a___b///c")).toBe("a-b-c");
  });

  it("keeps digits", () => {
    expect(slugify("10 tips for 2026")).toBe("10-tips-for-2026");
  });

  it("keeps letters of non-Latin scripts", () => {
    expect(slugify("日本語のタイトル")).toBe("日本語のタイトル");
    expect(slugify("Как выбрать ноутбук?")).toBe("как-выбрать-ноутбук");
    expect(slugify("Ελληνικά άρθρα")).toBe("ελληνικα-αρθρα");
    expect(slugify("한국어 제목")).toBe("한국어-제목");
    expect(slugify("مقالة عربية")).toBe("مقالة-عربية");
    // Uppercase letters without a lowercase form are dropped.
    expect(slugify("ϒ test")).toBe("test");
  });

  it('returns "post" when nothing usable remains', () => {
    expect(slugify("")).toBe("post");
    expect(slugify("   ")).toBe("post");
    expect(slugify("!!! ???")).toBe("post");
    expect(slugify("😀")).toBe("post");
  });

  it("keeps short slugs untouched", () => {
    const slug = "a".repeat(80);
    expect(slugify(slug)).toBe(slug);
  });

  it("cuts long slugs at a word boundary, within 80 characters", () => {
    const title = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const full = title.replace(/ /g, "-");
    const slug = slugify(title);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
    expect(full.startsWith(slug)).toBe(true);
    // the next character in the full slug is the separator: no word was cut
    expect(full[slug.length]).toBe("-");
  });

  it("cuts exactly at 80 when the 81st character is a separator", () => {
    const first = "a".repeat(80);
    expect(slugify(`${first} tail`)).toBe(first);
  });

  it("hard-cuts a single very long word", () => {
    expect(slugify("x".repeat(200))).toBe("x".repeat(80));
  });

  it("never ends with a dash after cutting", () => {
    const title = `${"ab ".repeat(40)}`;
    expect(slugify(title).endsWith("-")).toBe(false);
  });

  it("is idempotent", () => {
    const once = slugify("Héllo Wörld ! 2026 — a long title about nothing much");
    expect(slugify(once)).toBe(once);
  });
});

describe("nextAvailableSlug", () => {
  it("returns the base when it is free", () => {
    expect(nextAvailableSlug("hello", [])).toBe("hello");
    expect(nextAvailableSlug("hello", ["other", "hello-2"])).toBe("hello");
  });

  it("appends the first free number starting at 2", () => {
    expect(nextAvailableSlug("hello", ["hello"])).toBe("hello-2");
    expect(nextAvailableSlug("hello", ["hello", "hello-2"])).toBe("hello-3");
    expect(nextAvailableSlug("hello", ["hello", "hello-2", "hello-4"])).toBe("hello-3");
  });

  it("accepts any iterable", () => {
    expect(nextAvailableSlug("a", new Set(["a", "a-2"]))).toBe("a-3");
    function* taken() {
      yield "a";
      yield "a-2";
      yield "a-3";
    }
    expect(nextAvailableSlug("a", taken())).toBe("a-4");
  });
});
