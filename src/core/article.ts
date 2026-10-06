// Turning model output into a validated article, and an article into Markdown.
// Models rarely return perfectly clean JSON, so parsing is tolerant about the
// wrapping (code fences, prose around the object, trailing commas, raw newlines
// in strings) and strict about the content (a title and at least one section).

import { z } from "zod";
import type { BlogSettings, GeneratedArticle, ImagePrompt, Section } from "./types";

// ---- JSON extraction --------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fixes the two most common model slips: raw control characters inside strings and trailing commas. */
function repairJson(source: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        out += c;
      } else if (c === "\\") {
        escaped = true;
        out += c;
      } else if (c === '"') {
        inString = false;
        out += c;
      } else if (c === "\n") {
        out += "\\n";
      } else if (c === "\r") {
        out += "\\r";
      } else if (c === "\t") {
        out += "\\t";
      } else {
        out += c;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === ",") {
      const next = source.slice(i + 1).match(/^\s*(.)/)?.[1];
      if (next !== "}" && next !== "]") out += c;
    } else {
      out += c;
    }
  }
  return out;
}

function parseLoose(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    try {
      return JSON.parse(repairJson(source));
    } catch {
      return undefined;
    }
  }
}

/** Objects, and arrays holding at least one object: what the pipeline is looking for. */
function isUsable(value: unknown): boolean {
  return isRecord(value) || (Array.isArray(value) && value.some(isRecord));
}

/** Index of the bracket closing the one at `start`, ignoring brackets inside strings; -1 if none. */
function findClosing(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function preview(raw: string): string {
  const flat = raw.trim().replace(/\s+/g, " ");
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}

function extractFrom(text: string): unknown {
  const trimmed = text.trim();
  const direct = parseLoose(trimmed);
  if (isUsable(direct)) return direct;

  // Prose around the JSON: take the first balanced block that parses.
  let cursor = 0;
  for (let attempts = 0; attempts < 25; attempts++) {
    const start = trimmed.slice(cursor).search(/[{[]/);
    if (start === -1) break;
    const from = cursor + start;
    const end = findClosing(trimmed, from);
    if (end === -1) {
      // Something that starts like JSON but never closes: the output stopped early
      // (token limit). Do not "salvage" a nested fragment of it.
      if (/^(\{\s*"|\[\s*\{)/.test(trimmed.slice(from, from + 24))) {
        throw new Error("The JSON in the model response is incomplete (the output was probably truncated).");
      }
      cursor = from + 1;
      continue;
    }
    const parsed = parseLoose(trimmed.slice(from, end + 1));
    if (isUsable(parsed)) return parsed;
    cursor = end + 1;
  }
  return undefined;
}

/**
 * Pulls the JSON value out of a model response. Handles code fences, text before
 * and after the JSON, trailing commas and raw newlines inside strings. Throws a
 * descriptive Error when nothing usable is found.
 */
export function extractJson(raw: string): unknown {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("The model returned an empty response.");
  }

  const candidates: string[] = [];
  for (const match of raw.matchAll(/```[A-Za-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/g)) {
    if (match[1].trim() !== "") candidates.push(match[1]);
  }
  candidates.push(raw);

  for (const candidate of candidates) {
    const value = extractFrom(candidate);
    if (value !== undefined) return value;
  }
  throw new Error(`No valid JSON found in the model response (starts with: "${preview(raw)}").`);
}

// ---- Article parsing --------------------------------------------------------

const SECTION_TYPE_ALIASES = new Map<string, Section["type"]>([
  ["h1", "h2"],
  ["heading", "h2"],
  ["header", "h2"],
  ["h4", "h3"],
  ["h5", "h3"],
  ["h6", "h3"],
  ["subheading", "h3"],
  ["paragraph", "p"],
  ["text", "p"],
  ["blockquote", "quote"],
  ["list", "ul"],
  ["bullets", "ul"],
  ["bullet_list", "ul"],
  ["unordered_list", "ul"],
  ["ordered_list", "ol"],
  ["numbered_list", "ol"],
]);

const SECTION_TYPES = new Set(["h2", "h3", "p", "quote", "ul", "ol"]);

function cleanItem(item: unknown): string {
  if (typeof item !== "string") return "";
  return item
    .trim()
    .replace(/^(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ");
}

/** One raw section from the model -> a clean Section, or null when it has no content. */
function normalizeSection(raw: unknown): Section | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    return text === "" ? null : { type: "p", text };
  }
  if (!isRecord(raw)) return null;

  const declared = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : "";
  let type = SECTION_TYPES.has(declared) ? (declared as Section["type"]) : SECTION_TYPE_ALIASES.get(declared);
  if (!type) type = Array.isArray(raw.items) ? "ul" : "p";

  if (type === "ul" || type === "ol") {
    // Some models put the list in `text`, one item per line.
    const source = Array.isArray(raw.items)
      ? raw.items
      : typeof raw.text === "string"
        ? raw.text.split(/\r?\n/)
        : [];
    const items = source.map(cleanItem).filter((i) => i !== "");
    return items.length > 0 ? { type, items } : null;
  }

  if (typeof raw.text !== "string") return null;
  const text =
    type === "h2" || type === "h3"
      ? raw.text.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim()
      : raw.text.trim();
  return text === "" ? null : { type, text };
}

function normalizeTags(values: unknown[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const tag = value.replace(/^#+/, "").replace(/\s+/g, " ").trim();
    const key = tag.toLowerCase();
    if (tag === "" || tag.length > 40 || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags.slice(0, 5);
}

function normalizeImagePrompts(values: unknown[]): ImagePrompt[] {
  const prompts: ImagePrompt[] = [];
  for (const value of values) {
    if (!isRecord(value) || typeof value.prompt !== "string") continue;
    const prompt = value.prompt.trim();
    if (prompt === "") continue;
    prompts.push({ prompt, alt: typeof value.alt === "string" ? value.alt.trim() : "" });
  }
  return prompts;
}

const text = () => z.string().trim().catch("");
const list = () => z.array(z.unknown()).catch([]);

const articleSchema = z.object({
  title: z.string({ error: "title is missing" }).trim().min(1, "title is empty"),
  excerpt: text(),
  metaTitle: text(),
  metaDescription: text(),
  tags: list().transform(normalizeTags),
  sections: z
    .array(z.unknown(), { error: "sections is missing" })
    .transform((sections) => sections.map(normalizeSection).filter((s): s is Section => s !== null))
    .refine((sections) => sections.length > 0, "the article has no usable sections"),
  images: list().transform(normalizeImagePrompts),
});

/**
 * Parses and validates the article JSON returned by the model. `images` becomes
 * `imagePrompts`; empty sections and invalid image entries are dropped. Throws an
 * Error with a clear message when the response is unusable.
 */
export function parseGeneratedArticle(raw: string): GeneratedArticle {
  const data = extractJson(raw);
  if (!isRecord(data)) {
    throw new Error("Invalid article: the model response is not a JSON object.");
  }

  // Tolerate snake_case keys, a common drift when a model ignores the requested casing.
  const result = articleSchema.safeParse({
    ...data,
    metaTitle: data.metaTitle ?? data.meta_title,
    metaDescription: data.metaDescription ?? data.meta_description,
  });
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const where = issue.path.join(".");
      return where === "" ? issue.message : `${where}: ${issue.message}`;
    });
    throw new Error(`Invalid article: ${problems.join("; ")}.`);
  }

  const { images, ...article } = result.data;
  return { ...article, imagePrompts: images };
}

// ---- Markdown assembly ------------------------------------------------------

const isHeading = (section: Section) => section.type === "h2" || section.type === "h3";

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sectionToMarkdown(section: Section): string {
  switch (section.type) {
    case "h2":
      return `## ${oneLine(section.text)}`;
    case "h3":
      return `### ${oneLine(section.text)}`;
    case "p":
      return section.text.trim();
    case "quote":
      return section.text
        .trim()
        .split(/\r?\n/)
        .map((line) => `> ${line}`.trimEnd())
        .join("\n");
    case "ul":
      return section.items.map((item) => `- ${oneLine(item)}`).join("\n");
    case "ol":
      return section.items.map((item, i) => `${i + 1}. ${oneLine(item)}`).join("\n");
  }
}

function escapeAlt(alt: string): string {
  return oneLine(alt).replace(/[\\[\]]/g, (c) => `\\${c}`);
}

function imageToMarkdown(image: { url: string; alt: string }): string {
  // encodeURIComponent leaves parentheses alone, but they would end the Markdown link early.
  const url = image.url
    .trim()
    .replace(/[\s()<>]/g, (c) => (c === "(" ? "%28" : c === ")" ? "%29" : encodeURIComponent(c)));
  return `![${escapeAlt(image.alt)}](${url})`;
}

/**
 * Gaps (indices where an image may be inserted: before block `g`) that avoid the
 * start of the article and the spot right under a heading. Falls back to every
 * inner gap when that leaves nothing, and to "after the only block" for a
 * one-block article.
 */
function imageGaps(sections: Section[]): number[] {
  const inner = Array.from({ length: Math.max(0, sections.length - 1) }, (_, i) => i + 1);
  if (inner.length === 0) return sections.length === 1 ? [1] : [];
  const underHeading = (gap: number) => isHeading(sections[gap - 1]);
  const preferred = inner.filter((gap) => !underHeading(gap));
  return preferred.length > 0 ? preferred : inner;
}

/**
 * Deterministic Markdown for an article. Body images are spread evenly between
 * blocks: never before the first block, never directly under a heading when
 * avoidable, never two in a row. If the article has fewer usable gaps than images,
 * the trailing images are dropped.
 */
export function assembleMarkdown(
  sections: Section[],
  bodyImages: { url: string; alt: string }[],
): string {
  const blocks = sections.map(sectionToMarkdown);
  if (blocks.length === 0) return "";

  const gaps = imageGaps(sections);
  const images = bodyImages.filter((image) => image.url.trim() !== "").slice(0, gaps.length);

  // Each image goes to the valid gap closest to its even-spacing target, always after
  // the previous image and leaving enough gaps for the ones still to place.
  const before = new Map<number, string>();
  let previous = -1;
  images.forEach((image, i) => {
    const target = ((i + 1) * blocks.length) / (images.length + 1);
    const last = gaps.length - (images.length - i);
    let best = previous + 1;
    for (let candidate = best; candidate <= last; candidate++) {
      if (Math.abs(gaps[candidate] - target) < Math.abs(gaps[best] - target)) best = candidate;
    }
    previous = best;
    before.set(gaps[best], imageToMarkdown(image));
  });

  const out: string[] = [];
  blocks.forEach((block, index) => {
    const image = before.get(index);
    if (image) out.push(image);
    out.push(block);
  });
  const trailing = before.get(blocks.length);
  if (trailing) out.push(trailing);
  return out.join("\n\n");
}

// ---- Image prompts ----------------------------------------------------------

const COVER_HINT = "Wide 16:9 landscape composition with generous negative space, suitable as a blog cover image.";
const NO_TEXT_RULE = "Strict rule: no text, lettering, numbers, watermark or logos anywhere in the image.";

/** Final prompt sent to the image model: scene + configured style + hard constraints. */
export function finalizeImagePrompt(
  prompt: string,
  settings: BlogSettings,
  kind: "cover" | "body",
): string {
  const parts = [prompt.trim()];
  if (kind === "cover") parts.push(COVER_HINT);
  const style = settings.imageStyle.trim();
  if (style !== "") parts.push(`Visual style: ${style}`);
  parts.push(NO_TEXT_RULE);
  return parts.join("\n\n");
}

/**
 * Exactly `count` image prompts, cover first. Prompts the model provided are
 * used in order; missing ones are synthesized from the article title (cover) and
 * its h2 headings (body images).
 */
export function ensureImagePrompts(article: GeneratedArticle, count: number): ImagePrompt[] {
  const total = Math.max(0, Math.floor(count));
  const title = article.title.trim() || "the article";
  const headings = article.sections
    .filter((s) => s.type === "h2")
    .map((s) => (s.type === "h2" ? s.text.trim() : ""))
    .filter((h) => h !== "");
  const provided = article.imagePrompts
    .map((p) => ({ prompt: p.prompt.trim(), alt: p.alt.trim() }))
    .filter((p) => p.prompt !== "");

  const result: ImagePrompt[] = [];
  for (let i = 0; i < total; i++) {
    const fallbackAlt = i === 0 ? title : (headings[i - 1] ?? title);
    const given = provided[i];
    if (given) {
      result.push({ prompt: given.prompt, alt: given.alt || fallbackAlt });
    } else if (i === 0) {
      result.push({ prompt: `A representative scene illustrating the topic: "${title}"`, alt: title });
    } else if (headings[i - 1]) {
      result.push({
        prompt: `A realistic scene illustrating this section of an article: "${headings[i - 1]}" (article topic: "${title}")`,
        alt: headings[i - 1],
      });
    } else {
      result.push({ prompt: `Another realistic scene related to the topic: "${title}"`, alt: title });
    }
  }
  return result;
}
