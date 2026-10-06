import { describe, expect, it } from "vitest";
import {
  assembleMarkdown,
  ensureImagePrompts,
  extractJson,
  finalizeImagePrompt,
  parseGeneratedArticle,
} from "./article";
import { DEFAULT_SETTINGS } from "./settings";
import type { GeneratedArticle, Section } from "./types";

const validArticle = {
  title: "A practical guide to composting",
  excerpt: "Start composting today.",
  metaTitle: "Composting guide",
  metaDescription: "Learn how to compost at home in five steps.",
  tags: ["composting", "garden", "soil"],
  sections: [
    { type: "h2", text: "Why compost?" },
    { type: "p", text: "It **reduces** waste." },
    { type: "ul", items: ["Less waste", "Better soil"] },
  ],
  images: [
    { prompt: "A compost bin in a sunny garden", alt: "Compost bin" },
    { prompt: "Hands holding dark soil", alt: "Rich soil" },
  ],
};

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('  \n{"a":1}\n ')).toEqual({ a: 1 });
  });

  it("strips code fences, with or without a language tag", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```JSON {"a":1}```')).toEqual({ a: 1 });
  });

  it("ignores text before and after the JSON", () => {
    expect(extractJson('Sure! Here is the article:\n{"a":1}\nHope this helps.')).toEqual({ a: 1 });
    expect(extractJson('Intro\n```json\n{"a":[1,2]}\n```\nOutro {not json}')).toEqual({ a: [1, 2] });
  });

  it("is not confused by braces and brackets inside strings", () => {
    const raw = 'Result: {"text":"use { and } and [ freely","n":{"deep":"}"}} trailing }';
    expect(extractJson(raw)).toEqual({ text: "use { and } and [ freely", n: { deep: "}" } });
    expect(extractJson('{"q":"she said \\"{\\" loudly"}')).toEqual({ q: 'she said "{" loudly' });
  });

  it("skips earlier blocks that are not JSON", () => {
    expect(extractJson('Note [see below] and {oops} then {"ok":true}')).toEqual({ ok: true });
  });

  it("tolerates trailing commas", () => {
    expect(extractJson('{"a":[1,2,],"b":{"c":1,},}')).toEqual({ a: [1, 2], b: { c: 1 } });
  });

  it("tolerates raw newlines and tabs inside strings", () => {
    expect(extractJson('{"text":"line one\nline two\tend"}')).toEqual({ text: "line one\nline two\tend" });
  });

  it("returns a bare array of objects", () => {
    expect(extractJson('Here: [{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("does not return arrays of scalars that happen to appear in prose", () => {
    expect(extractJson('Items [1, 2] and then {"ok":true}')).toEqual({ ok: true });
  });

  it("throws on an empty response", () => {
    expect(() => extractJson("")).toThrow(/empty/i);
    expect(() => extractJson("   \n")).toThrow(/empty/i);
    expect(() => extractJson(undefined as unknown as string)).toThrow(/empty/i);
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractJson("I cannot help with that.")).toThrow(/No valid JSON/);
  });

  it("reports truncated output explicitly", () => {
    expect(() => extractJson('{"title":"x","sections":[{"type":"p","text":"cut o')).toThrow(/incomplete|truncated/i);
    expect(() => extractJson('Sure:\n```json\n{"title":"x","sections":[{"type":"p"')).toThrow(/incomplete|truncated/i);
  });

  it("does not salvage a nested fragment of truncated output", () => {
    const truncated = '{"title":"x","sections":[{"type":"p","text":"done"},{"type":"p","text":"cut';
    expect(() => extractJson(truncated)).toThrow(/truncated/i);
  });
});

describe("parseGeneratedArticle", () => {
  it("maps a valid response, renaming images to imagePrompts", () => {
    const article = parseGeneratedArticle(JSON.stringify(validArticle));
    expect(article).toEqual({
      title: "A practical guide to composting",
      excerpt: "Start composting today.",
      metaTitle: "Composting guide",
      metaDescription: "Learn how to compost at home in five steps.",
      tags: ["composting", "garden", "soil"],
      sections: validArticle.sections,
      imagePrompts: validArticle.images,
    });
    expect((article as unknown as Record<string, unknown>).images).toBeUndefined();
  });

  it("copes with code fences and trailing text", () => {
    const raw = `Here you go:\n\`\`\`json\n${JSON.stringify(validArticle)}\n\`\`\`\nLet me know if you need changes.`;
    expect(parseGeneratedArticle(raw).title).toBe(validArticle.title);
  });

  it("copes with a response that has trailing commas and raw newlines", () => {
    const raw = `{"title":"T","sections":[{"type":"p","text":"first line
second line"},],}`;
    const article = parseGeneratedArticle(raw);
    expect(article.sections).toEqual([{ type: "p", text: "first line\nsecond line" }]);
  });

  it("drops empty and unusable sections", () => {
    const article = parseGeneratedArticle(
      JSON.stringify({
        title: "T",
        sections: [
          { type: "h2", text: "Kept" },
          { type: "p", text: "   " },
          { type: "p" },
          { type: "ul", items: [] },
          { type: "ul", items: ["", "  "] },
          null,
          42,
          { type: "quote", text: "" },
          { type: "ol", items: ["one", "", "two"] },
        ],
      }),
    );
    expect(article.sections).toEqual([
      { type: "h2", text: "Kept" },
      { type: "ol", items: ["one", "two"] },
    ]);
  });

  it("trims texts and strips list bullets and heading hashes", () => {
    const article = parseGeneratedArticle(
      JSON.stringify({
        title: "  T  ",
        sections: [
          { type: "h2", text: "## A heading " },
          { type: "ul", items: ["- first", "* second", "1. third", "2024 outlook"] },
        ],
      }),
    );
    expect(article.title).toBe("T");
    expect(article.sections).toEqual([
      { type: "h2", text: "A heading" },
      { type: "ul", items: ["first", "second", "third", "2024 outlook"] },
    ]);
  });

  it("understands common section type aliases and string sections", () => {
    const article = parseGeneratedArticle(
      JSON.stringify({
        title: "T",
        sections: [
          { type: "heading", text: "H" },
          { type: "paragraph", text: "P" },
          { type: "blockquote", text: "Q" },
          { type: "list", items: ["a"] },
          { type: "numbered_list", items: ["b"] },
          { type: "h4", text: "Sub" },
          "A bare string",
          { type: "mystery", text: "falls back to a paragraph" },
          { type: "constructor", text: "not a prototype lookup" },
        ],
      }),
    );
    expect(article.sections.map((s) => s.type)).toEqual(["h2", "p", "quote", "ul", "ol", "h3", "p", "p", "p"]);
  });

  it("accepts a list given as multi-line text", () => {
    const article = parseGeneratedArticle(
      JSON.stringify({ title: "T", sections: [{ type: "ul", text: "- one\n- two" }] }),
    );
    expect(article.sections).toEqual([{ type: "ul", items: ["one", "two"] }]);
  });

  it("accepts snake_case meta fields", () => {
    const article = parseGeneratedArticle(
      JSON.stringify({ title: "T", sections: [{ type: "p", text: "x" }], meta_title: "MT", meta_description: "MD" }),
    );
    expect(article.metaTitle).toBe("MT");
    expect(article.metaDescription).toBe("MD");
  });

  it("defaults optional fields", () => {
    const article = parseGeneratedArticle(JSON.stringify({ title: "T", sections: [{ type: "p", text: "x" }] }));
    expect(article).toEqual({
      title: "T",
      excerpt: "",
      metaTitle: "",
      metaDescription: "",
      tags: [],
      sections: [{ type: "p", text: "x" }],
      imagePrompts: [],
    });
  });

  it("cleans tags: strips hashes, dedupes case-insensitively, drops non-strings, keeps 5", () => {
    const article = parseGeneratedArticle(
      JSON.stringify({
        title: "T",
        sections: [{ type: "p", text: "x" }],
        tags: ["#Soil", "soil", " garden  tips ", 7, null, "", "a", "b", "c", "d"],
      }),
    );
    expect(article.tags).toEqual(["Soil", "garden tips", "a", "b", "c"]);
  });

  it("drops invalid image entries without failing", () => {
    const article = parseGeneratedArticle(
      JSON.stringify({
        title: "T",
        sections: [{ type: "p", text: "x" }],
        images: [{ prompt: "ok", alt: "A" }, { prompt: "", alt: "empty" }, { alt: "no prompt" }, "nope", { prompt: "no alt" }],
      }),
    );
    expect(article.imagePrompts).toEqual([
      { prompt: "ok", alt: "A" },
      { prompt: "no alt", alt: "" },
    ]);
  });

  it("tolerates images being a non-array", () => {
    const article = parseGeneratedArticle(
      JSON.stringify({ title: "T", sections: [{ type: "p", text: "x" }], images: "none", tags: "a,b" }),
    );
    expect(article.imagePrompts).toEqual([]);
    expect(article.tags).toEqual([]);
  });

  describe("errors", () => {
    it("explains a missing title", () => {
      expect(() => parseGeneratedArticle('{"sections":[{"type":"p","text":"x"}]}')).toThrow(/Invalid article: title/);
    });

    it("explains an empty title", () => {
      expect(() => parseGeneratedArticle('{"title":"  ","sections":[{"type":"p","text":"x"}]}')).toThrow(/title/);
    });

    it("explains missing sections", () => {
      expect(() => parseGeneratedArticle('{"title":"T"}')).toThrow(/sections/);
      expect(() => parseGeneratedArticle('{"title":"T","sections":"text"}')).toThrow(/sections/);
    });

    it("explains when no section is usable", () => {
      expect(() => parseGeneratedArticle('{"title":"T","sections":[]}')).toThrow(/no usable sections/);
      expect(() => parseGeneratedArticle('{"title":"T","sections":[{"type":"p","text":""}]}')).toThrow(/no usable sections/);
    });

    it("rejects a response that is not an object", () => {
      expect(() => parseGeneratedArticle('[{"title":"T"}]')).toThrow(/not a JSON object/);
    });

    it("rejects garbage and empty responses", () => {
      expect(() => parseGeneratedArticle("")).toThrow();
      expect(() => parseGeneratedArticle("Sorry, I can't do that.")).toThrow(/No valid JSON/);
    });

    it("rejects truncated output", () => {
      const cut = JSON.stringify(validArticle).slice(0, 120);
      expect(() => parseGeneratedArticle(cut)).toThrow(/truncated|incomplete/i);
    });

    it("always throws an Error instance", () => {
      for (const raw of ["", "nope", "{}", '{"title":1}', "[]"]) {
        expect(() => parseGeneratedArticle(raw)).toThrow(Error);
      }
    });
  });
});

describe("assembleMarkdown", () => {
  const img = (n: number) => ({ url: `https://cdn.example/img-${n}.png`, alt: `Image ${n}` });

  /** 12 blocks: h2 p p h2 p p h2 p p h2 p p */
  const longArticle: Section[] = Array.from({ length: 12 }, (_, i) =>
    i % 3 === 0
      ? ({ type: "h2", text: `Heading ${i / 3 + 1}` } as Section)
      : ({ type: "p", text: `Paragraph ${i}` } as Section),
  );

  function blocksOf(markdown: string): string[] {
    return markdown.split("\n\n");
  }
  const isImage = (block: string) => block.startsWith("![");

  it("renders every block type", () => {
    const md = assembleMarkdown(
      [
        { type: "h2", text: "Title two" },
        { type: "h3", text: "Title three" },
        { type: "p", text: "Para with **bold** and *italic*." },
        { type: "quote", text: "Line one\nLine two" },
        { type: "ul", items: ["a", "b"] },
        { type: "ol", items: ["first", "second"] },
      ],
      [],
    );
    expect(md).toBe(
      [
        "## Title two",
        "### Title three",
        "Para with **bold** and *italic*.",
        "> Line one\n> Line two",
        "- a\n- b",
        "1. first\n2. second",
      ].join("\n\n"),
    );
  });

  it("returns an empty string for no sections", () => {
    expect(assembleMarkdown([], [img(1)])).toBe("");
  });

  it("collapses newlines inside headings and list items", () => {
    const md = assembleMarkdown(
      [
        { type: "h2", text: "Two\nlines" },
        { type: "ul", items: ["one\nitem"] },
      ],
      [],
    );
    expect(md).toBe("## Two lines\n\n- one item");
  });

  it("is deterministic", () => {
    const images = [img(1), img(2)];
    expect(assembleMarkdown(longArticle, images)).toBe(assembleMarkdown(longArticle, images));
  });

  it("places no image before the first block", () => {
    for (let k = 1; k <= 3; k++) {
      const md = assembleMarkdown(longArticle, Array.from({ length: k }, (_, i) => img(i)));
      expect(isImage(blocksOf(md)[0])).toBe(false);
    }
  });

  it("places no image after the last block", () => {
    const blocks = blocksOf(assembleMarkdown(longArticle, [img(1), img(2), img(3)]));
    expect(isImage(blocks[blocks.length - 1])).toBe(false);
  });

  it("never places two images in a row", () => {
    for (const total of [3, 4, 5, 8, 12]) {
      const sections: Section[] = Array.from({ length: total }, (_, i) => ({ type: "p", text: `P${i}` }));
      for (let k = 1; k <= 3; k++) {
        const blocks = blocksOf(assembleMarkdown(sections, Array.from({ length: k }, (_, i) => img(i))));
        blocks.forEach((block, i) => {
          if (isImage(block)) expect(isImage(blocks[i + 1] ?? "")).toBe(false);
        });
      }
    }
  });

  it("spreads images evenly between blocks, in the given order", () => {
    const sections: Section[] = Array.from({ length: 10 }, (_, i) => ({ type: "p", text: `P${i}` }));
    const blocks = blocksOf(assembleMarkdown(sections, [img(1), img(2)]));
    const positions = blocks.map((b, i) => (isImage(b) ? i : -1)).filter((i) => i >= 0);
    expect(positions).toHaveLength(2);
    // 10 text blocks, 2 images: one roughly a third in, one roughly two thirds in
    expect(blocks[positions[0]]).toContain("img-1.png");
    expect(blocks[positions[1]]).toContain("img-2.png");
    const textBefore = positions.map((p, i) => p - i);
    expect(textBefore).toEqual([3, 7]);
  });

  it("keeps all blocks and all images, in order", () => {
    const md = assembleMarkdown(longArticle, [img(1), img(2), img(3)]);
    const texts = blocksOf(md).filter((b) => !isImage(b));
    expect(texts).toEqual(longArticle.map((s) => (s.type === "h2" ? `## ${s.text}` : (s as { text: string }).text)));
    expect(blocksOf(md).filter(isImage)).toHaveLength(3);
  });

  it("avoids putting an image right under a heading", () => {
    const blocks = blocksOf(assembleMarkdown(longArticle, [img(1), img(2), img(3)]));
    blocks.forEach((block, i) => {
      if (isImage(block)) expect(blocks[i - 1].startsWith("##")).toBe(false);
    });
  });

  it("falls back to any inner gap when every gap is under a heading", () => {
    const headings: Section[] = [
      { type: "h2", text: "A" },
      { type: "h2", text: "B" },
      { type: "h2", text: "C" },
    ];
    const blocks = blocksOf(assembleMarkdown(headings, [img(1)]));
    expect(blocks.filter(isImage)).toHaveLength(1);
    expect(isImage(blocks[0])).toBe(false);
  });

  it("drops trailing images when there are not enough gaps", () => {
    const two: Section[] = [
      { type: "p", text: "one" },
      { type: "p", text: "two" },
    ];
    const blocks = blocksOf(assembleMarkdown(two, [img(1), img(2), img(3)]));
    expect(blocks).toEqual(["one", "![Image 1](https://cdn.example/img-1.png)", "two"]);
  });

  it("puts the image after a single block rather than losing it", () => {
    const blocks = blocksOf(assembleMarkdown([{ type: "p", text: "only" }], [img(1), img(2)]));
    expect(blocks).toEqual(["only", "![Image 1](https://cdn.example/img-1.png)"]);
  });

  it("ignores images without a URL", () => {
    const md = assembleMarkdown(longArticle, [{ url: "  ", alt: "empty" }]);
    expect(md).not.toContain("![");
  });

  it("escapes alt text and URLs", () => {
    const md = assembleMarkdown(
      [
        { type: "p", text: "a" },
        { type: "p", text: "b" },
      ],
      [{ url: "https://cdn.example/my image (1).png", alt: "A [tricky]\nalt \\ text" }],
    );
    expect(md).toContain("![A \\[tricky\\] alt \\\\ text](https://cdn.example/my%20image%20%281%29.png)");
  });
});

describe("finalizeImagePrompt", () => {
  const settings = { ...DEFAULT_SETTINGS, imageStyle: "flat vector illustration, pastel colors" };

  it("appends the style and the no-text rule", () => {
    const prompt = finalizeImagePrompt("  A bin in a garden ", settings, "body");
    expect(prompt.startsWith("A bin in a garden")).toBe(true);
    expect(prompt).toContain("flat vector illustration, pastel colors");
    expect(prompt).toMatch(/no text/i);
    expect(prompt).toMatch(/watermark/i);
    expect(prompt).toMatch(/logos/i);
    expect(prompt).not.toMatch(/16:9/);
  });

  it("adds a wide 16:9 hint for covers only", () => {
    expect(finalizeImagePrompt("scene", settings, "cover")).toMatch(/16:9/);
    expect(finalizeImagePrompt("scene", settings, "body")).not.toMatch(/16:9/);
  });

  it("omits the style line when no style is configured", () => {
    const prompt = finalizeImagePrompt("scene", DEFAULT_SETTINGS, "body");
    expect(prompt).not.toMatch(/visual style/i);
    expect(prompt).toMatch(/no text/i);
  });
});

describe("ensureImagePrompts", () => {
  const article = (images: { prompt: string; alt: string }[], sections?: Section[]): GeneratedArticle => ({
    title: "Composting basics",
    excerpt: "",
    metaTitle: "",
    metaDescription: "",
    tags: [],
    sections: sections ?? [
      { type: "h2", text: "Choosing a bin" },
      { type: "p", text: "text" },
      { type: "h2", text: "What to add" },
      { type: "p", text: "text" },
      { type: "h2", text: "Turning the pile" },
    ],
    imagePrompts: images,
  });

  it("returns exactly the requested number of prompts", () => {
    for (const count of [0, 1, 2, 3, 4, 7]) {
      expect(ensureImagePrompts(article([]), count)).toHaveLength(count);
      expect(ensureImagePrompts(article([{ prompt: "p", alt: "a" }]), count)).toHaveLength(count);
    }
  });

  it("returns an empty list for a non-positive count", () => {
    expect(ensureImagePrompts(article([]), 0)).toEqual([]);
    expect(ensureImagePrompts(article([]), -2)).toEqual([]);
  });

  it("keeps the model's prompts, cover first", () => {
    const given = [
      { prompt: "cover scene", alt: "Cover alt" },
      { prompt: "body one", alt: "Body alt" },
    ];
    expect(ensureImagePrompts(article(given), 2)).toEqual(given);
  });

  it("drops extra prompts beyond the count", () => {
    const given = [1, 2, 3, 4].map((n) => ({ prompt: `scene ${n}`, alt: `alt ${n}` }));
    expect(ensureImagePrompts(article(given), 2).map((p) => p.prompt)).toEqual(["scene 1", "scene 2"]);
  });

  it("synthesizes the cover from the title and body images from h2 headings", () => {
    const result = ensureImagePrompts(article([]), 3);
    expect(result[0].prompt).toContain("Composting basics");
    expect(result[0].alt).toBe("Composting basics");
    expect(result[1].prompt).toContain("Choosing a bin");
    expect(result[1].alt).toBe("Choosing a bin");
    expect(result[2].prompt).toContain("What to add");
  });

  it("only fills the missing slots", () => {
    const result = ensureImagePrompts(article([{ prompt: "cover scene", alt: "Cover" }]), 3);
    expect(result[0]).toEqual({ prompt: "cover scene", alt: "Cover" });
    expect(result[1].alt).toBe("Choosing a bin");
  });

  it("falls back to headings or the title when a provided alt is empty", () => {
    const result = ensureImagePrompts(
      article([
        { prompt: "cover", alt: "" },
        { prompt: "body", alt: "" },
      ]),
      2,
    );
    expect(result[0].alt).toBe("Composting basics");
    expect(result[1].alt).toBe("Choosing a bin");
  });

  it("still returns the right count when the article has no headings", () => {
    const result = ensureImagePrompts(article([], [{ type: "p", text: "x" }]), 4);
    expect(result).toHaveLength(4);
    result.forEach((p) => {
      expect(p.prompt.length).toBeGreaterThan(0);
      expect(p.alt.length).toBeGreaterThan(0);
    });
  });

  it("ignores blank provided prompts", () => {
    const result = ensureImagePrompts(article([{ prompt: "  ", alt: "x" }]), 1);
    expect(result[0].prompt).toContain("Composting basics");
  });
});
