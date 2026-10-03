import { describe, expect, it } from "vitest";
import {
  clampMetaDescription,
  clampMetaTitle,
  normalizeTitle,
  readingTimeMinutes,
  titleIssues,
  TITLE_MAX_LEN,
} from "./seo";

describe("titleIssues", () => {
  it("reports nothing for a clean title", () => {
    expect(titleIssues("How to price your first product", "en")).toEqual([]);
    expect(titleIssues("Comment fixer le prix de son premier produit", "fr")).toEqual([]);
  });

  it("flags an empty title", () => {
    expect(titleIssues("", "en")).toHaveLength(1);
    expect(titleIssues("   ", "en")[0]).toMatch(/empty/i);
  });

  it("flags titles over the limit", () => {
    const long = "x".repeat(TITLE_MAX_LEN + 1);
    expect(titleIssues(long, "en").join(" ")).toMatch(/66 characters/);
    expect(titleIssues("x".repeat(TITLE_MAX_LEN), "en")).toEqual([]);
  });

  it("flags a trailing period but not an ellipsis", () => {
    expect(titleIssues("A finished sentence.", "en").join(" ")).toMatch(/period/i);
    expect(titleIssues("To be continued...", "en")).toEqual([]);
  });

  it("flags ALL CAPS titles", () => {
    expect(titleIssues("SELL YOUR HOUSE FAST", "en").join(" ")).toMatch(/ALL CAPS/);
    expect(titleIssues("Learn SEO in 3D", "en")).toEqual([]);
  });

  it("flags titles wrapped in quotes, but not inner quotes", () => {
    expect(titleIssues('"A quoted title"', "en").join(" ")).toMatch(/quotation/i);
    expect(titleIssues("« Un titre cité »", "fr").join(" ")).toMatch(/quotation/i);
    expect(titleIssues('"Rent" or "buy"?', "en")).toEqual([]);
  });

  it("flags Title Case only in sentence-case languages", () => {
    const titleCase = "Comment Vendre Sa Maison Rapidement";
    expect(titleIssues(titleCase, "fr").join(" ")).toMatch(/sentence case/);
    expect(titleIssues(titleCase, "fr-CA").join(" ")).toMatch(/sentence case/);
    expect(titleIssues("How To Sell Your House Fast", "en")).toEqual([]);
  });

  it("does not mistake a proper noun for Title Case", () => {
    expect(titleIssues("Vendre à Nantes", "fr")).toEqual([]);
    expect(titleIssues("Pourquoi investir à Lisbonne en 2026", "fr")).toEqual([]);
  });

  it("can report several issues at once", () => {
    expect(titleIssues('"A very long title that goes on and on and on and on and on and on forever."', "en").length).toBeGreaterThanOrEqual(2);
  });
});

describe("normalizeTitle", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeTitle("  Hello   world \n", "en")).toBe("Hello world");
  });

  it("removes wrapping quotes and a trailing period, in any order", () => {
    expect(normalizeTitle('"Hello world"', "en")).toBe("Hello world");
    expect(normalizeTitle('"Hello world."', "en")).toBe("Hello world");
    expect(normalizeTitle('"Hello world".', "en")).toBe("Hello world");
    expect(normalizeTitle("« Bonjour le monde »", "fr")).toBe("Bonjour le monde");
    expect(normalizeTitle("“Hello world”", "en")).toBe("Hello world");
  });

  it("keeps inner quotes and ellipses", () => {
    expect(normalizeTitle('"Rent" or "buy"?', "en")).toBe('"Rent" or "buy"?');
    expect(normalizeTitle("Wait for it...", "en")).toBe("Wait for it...");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeTitle("", "en")).toBe("");
    expect(normalizeTitle("   ", "fr")).toBe("");
  });

  it("does not touch English casing", () => {
    expect(normalizeTitle("How To Sell Your House Fast", "en")).toBe("How To Sell Your House Fast");
    expect(normalizeTitle("SELL FAST", "en")).toBe("SELL FAST");
  });

  it("does not touch other languages, such as German", () => {
    expect(normalizeTitle("Wie Sie Ihr Haus Schnell Verkaufen", "de")).toBe("Wie Sie Ihr Haus Schnell Verkaufen");
  });

  it("converts Title Case to sentence case in French", () => {
    expect(normalizeTitle("Comment Vendre Sa Maison Rapidement", "fr")).toBe("Comment vendre sa maison rapidement");
    expect(normalizeTitle("Acheter Un Appartement", "fr")).toBe("Acheter un appartement");
  });

  it("works for Spanish, Italian and Portuguese, including regional tags", () => {
    expect(normalizeTitle("Cómo Vender Tu Casa Más Rápido", "es")).toBe("Cómo vender tu casa más rápido");
    expect(normalizeTitle("Come Vendere La Tua Casa Velocemente", "it")).toBe("Come vendere la tua casa velocemente");
    expect(normalizeTitle("Como Vender Sua Casa Mais Rápido", "pt-BR")).toBe("Como vender sua casa mais rápido");
    expect(normalizeTitle("Cómo Vender Tu Casa Más Rápido", "es-MX")).toBe("Cómo vender tu casa más rápido");
  });

  it("keeps acronyms and words with inner capitals", () => {
    expect(normalizeTitle("Les Meilleurs Outils SEO Pour LinkedIn Et L'IA", "fr")).toBe(
      "Les meilleurs outils SEO pour LinkedIn et l'IA",
    );
    expect(normalizeTitle("Mettre À Jour Son Profil Sur iPhone", "fr")).toBe("Mettre à jour son profil sur iPhone");
    expect(normalizeTitle("Passer À La 3D Et Au PDF", "fr")).toBe("Passer à la 3D et au PDF");
  });

  it("handles elisions", () => {
    expect(normalizeTitle("L'Estimation Des Travaux Expliquée", "fr")).toBe("L'estimation des travaux expliquée");
  });

  it("leaves a title that is already in sentence case alone, proper nouns included", () => {
    expect(normalizeTitle("Vendre à Nantes", "fr")).toBe("Vendre à Nantes");
    expect(normalizeTitle("Vendre à Nantes et Lyon", "fr")).toBe("Vendre à Nantes et Lyon");
    expect(normalizeTitle("5 erreurs à éviter avant de vendre", "fr")).toBe("5 erreurs à éviter avant de vendre");
  });

  it("converts a shouting title in a sentence-case language", () => {
    expect(normalizeTitle("COMMENT VENDRE VITE", "fr")).toBe("Comment vendre vite");
  });

  it("capitalizes the first letter after a leading number or symbol", () => {
    expect(normalizeTitle("5 Erreurs Qui Coûtent Cher", "fr")).toBe("5 erreurs qui coûtent cher");
    expect(normalizeTitle("¿Cómo Vender Tu Casa Rápido?", "es")).toBe("¿Cómo vender tu casa rápido?");
  });

  it("is idempotent", () => {
    for (const [title, lang] of [
      ["Comment Vendre Sa Maison Rapidement", "fr"],
      ['"Hello world."', "en"],
    ] as const) {
      const once = normalizeTitle(title, lang);
      expect(normalizeTitle(once, lang)).toBe(once);
    }
  });
});

describe("clampMetaTitle", () => {
  it("keeps a valid meta title", () => {
    expect(clampMetaTitle("A short meta title", "The article title")).toBe("A short meta title");
    const exactly60 = "a".repeat(30) + " " + "b".repeat(29);
    expect(clampMetaTitle(exactly60, "T")).toBe(exactly60);
  });

  it("falls back to the title when the meta title is empty", () => {
    expect(clampMetaTitle("", "The article title")).toBe("The article title");
    expect(clampMetaTitle("   ", "The article title")).toBe("The article title");
  });

  it("falls back to the title when the meta title is too long", () => {
    expect(clampMetaTitle("m".repeat(61), "The article title")).toBe("The article title");
  });

  it("cuts a long fallback title at a word boundary, within 60 characters", () => {
    const title = "Understanding the long road to a reliable and repeatable publishing routine";
    const result = clampMetaTitle("", title);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(title.startsWith(result)).toBe(true);
    expect(title[result.length]).toBe(" ");
  });

  it("does not leave dangling punctuation", () => {
    const title = `${"word ".repeat(11)}-, rest of the title`;
    expect(clampMetaTitle("", title)).not.toMatch(/[-,:;\s]$/);
  });
});

describe("clampMetaDescription", () => {
  it("keeps a valid description and collapses whitespace", () => {
    expect(clampMetaDescription("A  useful\n description.", "fallback")).toBe("A useful description.");
  });

  it("falls back when empty", () => {
    expect(clampMetaDescription("", "Fallback text")).toBe("Fallback text");
    expect(clampMetaDescription("  ", "Fallback text")).toBe("Fallback text");
  });

  it("returns an empty string when both are empty", () => {
    expect(clampMetaDescription("", "")).toBe("");
  });

  it("accepts exactly 160 characters unchanged", () => {
    const exact = `${"word ".repeat(31)}wordy`; // 155 + 5 = 160
    expect(exact).toHaveLength(160);
    expect(clampMetaDescription(exact, "")).toBe(exact);
  });

  it("cuts over-long text at a word boundary, with an ellipsis, within 160 characters", () => {
    const long = "lorem ipsum dolor sit amet ".repeat(20).trim();
    const result = clampMetaDescription(long, "");
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith("…")).toBe(true);
    const body = result.slice(0, -1);
    expect(long.startsWith(body)).toBe(true);
    expect(long[body.length]).toBe(" ");
  });

  it("clamps the fallback too", () => {
    const result = clampMetaDescription("", "x ".repeat(200));
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith("…")).toBe(true);
  });

  it("does not split an emoji", () => {
    const result = clampMetaDescription("😀".repeat(200), "");
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result).not.toMatch(/[\ud800-\udbff]…$/);
  });
});

describe("readingTimeMinutes", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

  it("is at least one minute", () => {
    expect(readingTimeMinutes("")).toBe(1);
    expect(readingTimeMinutes("short")).toBe(1);
  });

  it("rounds up at 220 words per minute", () => {
    expect(readingTimeMinutes(words(220))).toBe(1);
    expect(readingTimeMinutes(words(221))).toBe(2);
    expect(readingTimeMinutes(words(1100))).toBe(5);
  });

  it("ignores Markdown syntax, images and link targets", () => {
    const md = `## Heading\n\n![alt text](https://example.com/very/long/url.png)\n\n- [a link](https://example.com/${"x".repeat(500)})\n\n${words(219)}`;
    // Heading(1) + link text(2) + 219 words = 222 -> 2 minutes; the image and URLs add nothing
    expect(readingTimeMinutes(md)).toBe(2);
    expect(readingTimeMinutes(`![only an image](https://example.com/a.png)`)).toBe(1);
  });

  it("does not count hyphenated words twice or list markers as words", () => {
    expect(readingTimeMinutes(`- ${words(219)} well-known`)).toBe(1);
  });
});
