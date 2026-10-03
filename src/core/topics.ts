// Topic suggestion: the prompt, tolerant parsing of the answer, and a mechanical
// overlap check against recent posts. The check is language-agnostic and never
// relies on a hardcoded theme list: it only uses the titles and tags the blog
// has actually published.
//
// Two rules decide that a candidate overlaps recent content:
//  1. Lexical: the stemmed keywords of the candidate title and of a recent title
//     share at least 3 words AND a Jaccard similarity of at least 0.25.
//  2. Tag cooldown: a tag of a recent post appears in the candidate title and is
//     "hot": used at least twice inside the 60-day window, or once in the last
//     21 days (scheduled posts count as recent).

import { extractJson } from "./article";
import { buildSystemPrompt, languageLabel, titleGuidelines } from "./prompts";
import type { BlogSettings, RecentPost, TopicSuggestion } from "./types";

/** Posts older than this no longer count towards tag saturation. */
export const TOPIC_WINDOW_DAYS = 60;
/** A tag used this many times inside the window is saturated. */
const TAG_SATURATION_COUNT = 2;
/** A tag used once stays blocked for this many days. */
const TAG_COOLDOWN_DAYS = 21;
const LEXICAL_MIN_SHARED = 3;
const LEXICAL_MIN_JACCARD = 0.25;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AVOID_TITLES = 40;
const MAX_LISTED_TAGS = 20;
const CITED_TITLE_MAX = 80;

// ---- Text analysis ----------------------------------------------------------

// Function words and generic blog filler (en, fr, es, de), accents removed.
// Deliberately small: it only keeps the most common noise out of the keyword
// comparison; domain words are never listed here.
const STOPWORDS = new Set(
  `
  the and for with from that this these those your you our are was were will have has had not but can how what when where which who why
  whom into over under about after before than then them they their there here more most less best top guide guides complete ultimate
  tips tip ways way things thing need needs know make makes using use should could would every each many much very also just only
  been being does doing done beyond easy simple essential everything
  les des une aux que qui quoi dont pour par sur sous avec sans dans chez vers entre comme plus moins tres tout tous toute toutes
  cette cela ceux elle elles leur leurs vous votre vos nous notre nos sont etre fait faire avez avoir comment pourquoi quand quel
  quelle quels quelles avant apres aussi meme bien complet conseils conseil astuces astuce decouvrez voici
  los las unos unas del con sin por para como mas menos muy todo todos toda todas esta este estos estas esto ese esa sus nuestro
  nuestra tus cuando donde quien porque sobre desde hasta antes despues tambien guia completa completo consejos consejo trucos claves
  der die das den dem ein eine einer einen einem und oder aber mit ohne fur von vom zum zur auf aus bei nach vor uber unter wie
  wer wann warum wenn dass nicht auch nur sehr mehr alle alles ihre ihr ihren sind wird werden haben kann konnen ratgeber tipps
  tipp anleitung komplett komplette kompletter
`
    .split(/\s+/)
    .filter((w) => w !== ""),
);

/** Lowercase, accents and ligatures folded, typographic apostrophes straightened. */
function normalize(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘]/g, "'");
}

function tokensOf(value: string): string[] {
  return normalize(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t !== "");
}

/**
 * Deliberately crude stemmer shared by all languages: plurals, a few English
 * suffixes and a final "e", so that "price", "prices" and "pricing" (or
 * "aide"/"aides") compare equal. Both sides are stemmed the same way.
 */
function stem(word: string): string {
  let w = word;
  if (w.length > 4) {
    if (w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
    else if (/[sx]$/.test(w) && !w.endsWith("ss")) w = w.slice(0, -1);
  }
  if (w.length > 6 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 5 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Meaningful words (4+ letters, not numbers, not stopwords), stemmed. */
function keywordsOf(value: string): Set<string> {
  const out = new Set<string>();
  for (const raw of tokensOf(value)) {
    if (raw.length < 4 || /^\d+$/.test(raw)) continue;
    const root = stem(raw);
    if (STOPWORDS.has(raw) || STOPWORDS.has(root)) continue;
    out.add(root);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

function cite(title: string): string {
  const t = title.trim().replace(/\s+/g, " ");
  return t.length <= CITED_TITLE_MAX ? t : `${t.slice(0, CITED_TITLE_MAX - 1).trimEnd()}…`;
}

// ---- Recent-post analysis ---------------------------------------------------

interface HotTag {
  label: string;
  /** Stemmed tokens, matched as a contiguous sequence inside a stemmed title. */
  tokens: string[];
  count: number;
  /** Used within the cooldown period (or still to be published). */
  fresh: boolean;
  example: string;
}

interface Analysis {
  posts: { title: string; keywords: Set<string> }[];
  /** Every tag seen in the window, hot or not. */
  tags: HotTag[];
}

function isHot(tag: HotTag): boolean {
  return tag.count >= TAG_SATURATION_COUNT || tag.fresh;
}

function analyze(recent: RecentPost[], now: Date): Analysis {
  const nowMs = now.getTime();
  const windowStart = nowMs - TOPIC_WINDOW_DAYS * DAY_MS;
  const cooldownStart = nowMs - TAG_COOLDOWN_DAYS * DAY_MS;

  const byKey = new Map<string, HotTag>();
  for (const post of recent) {
    const publishedMs = Date.parse(post.publishedAt);
    // Unknown dates count towards saturation but never towards freshness.
    const inWindow = Number.isNaN(publishedMs) || publishedMs >= windowStart;
    if (!inWindow) continue;
    const fresh = !Number.isNaN(publishedMs) && publishedMs >= cooldownStart;

    const seenInPost = new Set<string>();
    for (const rawTag of post.tags ?? []) {
      const words = tokensOf(rawTag);
      const tokens = words.map(stem);
      const key = tokens.join(" ");
      // Tags that are too short or made only of filler words would block half of all titles.
      if (key.length < 3 || words.every((w) => STOPWORDS.has(w) || STOPWORDS.has(stem(w)))) continue;
      if (seenInPost.has(key)) continue;
      seenInPost.add(key);

      const entry = byKey.get(key) ?? {
        label: rawTag.trim(),
        tokens,
        count: 0,
        fresh: false,
        example: post.title,
      };
      entry.count++;
      entry.fresh = entry.fresh || fresh;
      byKey.set(key, entry);
    }
  }

  return {
    posts: recent.map((post) => ({ title: post.title, keywords: keywordsOf(post.title) })),
    tags: [...byKey.values()],
  };
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}

function overlapReason(analysis: Analysis, title: string): string | null {
  const candidate = keywordsOf(title);
  for (const post of analysis.posts) {
    const shared = [...candidate].filter((word) => post.keywords.has(word));
    if (shared.length >= LEXICAL_MIN_SHARED && jaccard(candidate, post.keywords) >= LEXICAL_MIN_JACCARD) {
      return `Too close to "${cite(post.title)}" (shared keywords: ${shared.join(", ")}).`;
    }
  }

  const titleTokens = tokensOf(title).map(stem);
  for (const tag of analysis.tags) {
    if (!isHot(tag) || !containsSequence(titleTokens, tag.tokens)) continue;
    return tag.count >= TAG_SATURATION_COUNT
      ? `The topic "${tag.label}" was already covered ${tag.count} times in the last ${TOPIC_WINDOW_DAYS} days (e.g. "${cite(tag.example)}").`
      : `The topic "${tag.label}" was covered recently (within ${TAG_COOLDOWN_DAYS} days) in "${cite(tag.example)}".`;
  }
  return null;
}

// ---- Public API: overlap ----------------------------------------------------

/**
 * Why a candidate title overlaps recent posts (a short English sentence), or
 * null when it is fresh. See the file header for the two rules.
 */
export function topicOverlap(title: string, recent: RecentPost[], now: Date): string | null {
  return overlapReason(analyze(recent, now), title);
}

/** Attaches the overlap reason (or null) to each topic, for the admin UI. */
export function annotateTopics(
  topics: { title: string; angle: string }[],
  recent: RecentPost[],
  now: Date,
): TopicSuggestion[] {
  const analysis = analyze(recent, now);
  return topics.map((topic) => ({ ...topic, overlap: overlapReason(analysis, topic.title) }));
}

/** First topic that overlaps nothing, in the order given, or null. */
export function pickFreshTopic(
  topics: { title: string; angle: string }[],
  recent: RecentPost[],
  now: Date,
): { title: string; angle: string } | null {
  const analysis = analyze(recent, now);
  return topics.find((topic) => overlapReason(analysis, topic.title) === null) ?? null;
}

// ---- Public API: prompt -----------------------------------------------------

function coverageBlock(analysis: Analysis): string {
  const hot = analysis.tags
    .filter(isHot)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, MAX_LISTED_TAGS);
  const cooling = analysis.tags
    .filter((tag) => !isHot(tag))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, MAX_LISTED_TAGS);
  if (hot.length === 0 && cooling.length === 0) return "";

  const lines = ["## Coverage of the last two months"];
  if (hot.length > 0) {
    lines.push("Already covered: do not propose another article centered on these subjects, even under a new angle or format:");
    for (const tag of hot) {
      lines.push(
        tag.count >= TAG_SATURATION_COUNT
          ? `- ${tag.label} (${tag.count} posts)`
          : `- ${tag.label} (covered in the last ${TAG_COOLDOWN_DAYS} days)`,
      );
    }
  }
  if (cooling.length > 0) {
    lines.push(
      `Covered once, a while ago: allowed only with a clearly different angle: ${cooling.map((tag) => tag.label).join("; ")}.`,
    );
  }
  return lines.join("\n");
}

function avoidBlock(recent: RecentPost[], exclude: string[]): string {
  const newestFirst = [...recent].sort((a, b) => {
    const diff = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    return Number.isNaN(diff) ? 0 : diff;
  });
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const title of [...exclude, ...newestFirst.map((post) => post.title)]) {
    const clean = (title ?? "").trim().replace(/\s+/g, " ");
    const key = clean.toLowerCase();
    if (clean === "" || seen.has(key)) continue;
    seen.add(key);
    titles.push(cite(clean));
  }
  if (titles.length === 0) return "";
  return [
    "## Already published or already proposed: do not repeat or rephrase",
    ...titles.slice(0, MAX_AVOID_TITLES).map((title) => `- ${title}`),
  ].join("\n");
}

/** Prompt asking for `count` fresh topics as strict JSON. */
export function buildTopicsPrompt(
  settings: BlogSettings,
  p: { count: number; recent: RecentPost[]; exclude: string[]; now: Date },
): { system: string; prompt: string } {
  const count = Math.max(1, Math.floor(p.count));
  const label = languageLabel(settings.language);
  const guidelines = settings.topicGuidelines.trim();
  const audience = settings.audience.trim();
  const today = Number.isNaN(p.now.getTime()) ? "" : p.now.toISOString().slice(0, 10);

  const sections = [
    `Propose ${count} new blog article ${count === 1 ? "topic" : "topics"}, written in ${label}.`,
    "",
    "## What makes a good topic",
    `- Useful and specific for the audience${audience ? ` (${audience})` : ""}: something a real reader would search for or want to read.`,
    "- A clear angle, not a vague theme. The angle is one sentence saying what the article will teach or show.",
    ...(count > 1
      ? ["- The topics must differ clearly from each other: different subjects and different formats (practical guide, case study, comparison, checklist, myth-busting, step-by-step...)."]
      : []),
    "- Never rely on invented facts or figures.",
    ...(today ? [`- Today is ${today}: favor timely subjects only when they are genuinely relevant.`] : []),
  ];

  if (guidelines !== "") sections.push("", "## Editorial guidelines", guidelines);
  sections.push("", "## Title rules", titleGuidelines(settings.language));

  const coverage = coverageBlock(analyze(p.recent, p.now));
  if (coverage !== "") sections.push("", coverage);
  const avoid = avoidBlock(p.recent, p.exclude);
  if (avoid !== "") sections.push("", avoid);

  sections.push(
    "",
    "## Output",
    `Return STRICT JSON only, with no Markdown fences and no commentary: exactly ${count} ${count === 1 ? "topic" : "topics"} in this shape.`,
    '{"topics":[{"title":"...","angle":"one sentence describing the angle"}]}',
    `Titles and angles are written in ${label}.`,
  );

  return { system: buildSystemPrompt(settings), prompt: sections.join("\n") };
}

// ---- Public API: parsing ----------------------------------------------------

function toTopic(raw: unknown): { title: string; angle: string } | null {
  if (typeof raw === "string") {
    const title = raw.trim().replace(/\s+/g, " ");
    return title === "" ? null : { title, angle: "" };
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { title, angle } = raw as { title?: unknown; angle?: unknown };
  if (typeof title !== "string" || title.trim() === "") return null;
  return {
    title: title.trim().replace(/\s+/g, " "),
    angle: typeof angle === "string" ? angle.trim().replace(/\s+/g, " ") : "",
  };
}

/**
 * Reads the topics out of a model response. Accepts `{"topics":[…]}` or a bare
 * array, with or without code fences or surrounding prose; invalid entries are
 * skipped and duplicates removed. Throws when nothing usable remains.
 */
export function parseTopics(raw: string): { title: string; angle: string }[] {
  const data = extractJson(raw);
  const list = Array.isArray(data) ? data : (data as { topics?: unknown }).topics;
  if (!Array.isArray(list)) {
    throw new Error('The model response has no "topics" array.');
  }

  const seen = new Set<string>();
  const topics: { title: string; angle: string }[] = [];
  for (const item of list) {
    const topic = toTopic(item);
    if (!topic) continue;
    const key = topic.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
  }
  if (topics.length === 0) {
    throw new Error("The model response contains no usable topic (each topic needs a non-empty title).");
  }
  return topics;
}
