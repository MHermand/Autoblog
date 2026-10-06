// Title hygiene and SEO metadata helpers. Pure functions, no dependencies.
// Nothing here rewrites meaning: titles are only cleaned mechanically, and
// anything that needs rewording is reported by `titleIssues` so the pipeline can
// decide to ask the model for a fix.

/** Maximum title length, punctuation included. */
export const TITLE_MAX_LEN = 65;
/** Google truncates `<title>` tags around this length. */
export const META_TITLE_MAX_LEN = 60;
export const META_DESCRIPTION_MAX_LEN = 160;

const WORDS_PER_MINUTE = 220;

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}]*/gu;

/** Languages whose headlines use sentence case (only the first word capitalized). */
const SENTENCE_CASE_LANGUAGES = new Set(["fr", "es", "it", "pt"]);

/** "fr-CA" -> "fr". Empty or malformed input -> "". */
export function baseLanguage(lang: string): string {
  return (lang ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

/** True for languages where headlines conventionally use sentence case (fr, es, it, pt). */
export function usesSentenceCase(lang: string): boolean {
  return SENTENCE_CASE_LANGUAGES.has(baseLanguage(lang));
}

// ---- Title ------------------------------------------------------------------

const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ["«", "»"],
  ["“", "”"],
  ["'", "'"],
  ["‘", "’"],
];

/**
 * Removes quotes that wrap the WHOLE string. A title with inner quotes
 * (`"Rent" or "buy"`) is left alone: stripping would unbalance it.
 */
function stripWrappingQuotes(s: string): string {
  for (const [open, close] of QUOTE_PAIRS) {
    if (s.length <= open.length + close.length) continue;
    if (!s.startsWith(open) || !s.endsWith(close)) continue;
    const end = s.length - close.length;
    const nextOpen = s.indexOf(open, open.length);
    if (nextOpen !== -1 && nextOpen !== end) continue;
    if (s.indexOf(close, open.length) !== end) continue;
    return s.slice(open.length, end).trim();
  }
  return s;
}

/** A single trailing period is removed; an ellipsis ("...") is kept. */
function stripTrailingPeriod(s: string): string {
  return s.replace(/(^|[^.])\.$/, "$1").trim();
}

function isUpperChar(c: string): boolean {
  return c !== c.toLowerCase() && c === c.toUpperCase();
}

function isShouting(title: string): boolean {
  const words = title.match(WORD_RE) ?? [];
  const letters = title.replace(/[^\p{L}]/gu, "");
  return (
    words.length >= 2 &&
    letters.length >= 4 &&
    title === title.toUpperCase() &&
    title !== title.toLowerCase()
  );
}

/** Acronyms ("NASA", "3D") and words with inner capitals ("iPhone", "LinkedIn") keep their case. */
function keepsCase(token: string): boolean {
  const chars = [...token];
  if (chars.slice(1).some(isUpperChar)) return true;
  return /\d/.test(token) && /\p{Lu}/u.test(token);
}

interface WordMatch {
  word: string;
  index: number;
  /** Followed by an apostrophe: an elision fragment such as the "l" of "l'impact". */
  elided: boolean;
}

function wordsOf(text: string): WordMatch[] {
  return [...text.matchAll(WORD_RE)].map((m) => ({
    word: m[0],
    index: m.index ?? 0,
    elided: /['’]/.test(text[(m.index ?? 0) + m[0].length] ?? ""),
  }));
}

/**
 * Detects "Every Word Capitalized" headlines. We look at the PROPORTION of
 * capitalized words after the first one: a single proper noun
 * ("Selling in Lisbon") is not enough to be accused of Title Case.
 */
function looksLikeTitleCase(title: string): boolean {
  const rest = wordsOf(title)
    .slice(1)
    .filter((w) => /^\p{L}/u.test(w.word) && !w.elided && !keepsCase(w.word));
  if (rest.length < 2) return false;
  const capitalized = rest.filter((w) => isUpperChar([...w.word][0])).length;
  return capitalized / rest.length >= 0.6;
}

function capitalizeFirst(s: string): string {
  const i = s.search(/[\p{L}\p{N}]/u);
  if (i === -1) return s;
  const chars = [...s.slice(i)];
  return s.slice(0, i) + chars[0].toUpperCase() + chars.slice(1).join("");
}

function toSentenceCase(title: string): string {
  const shouting = isShouting(title);
  let position = 0;
  const out = title.replace(WORD_RE, (token) => {
    const current = position++;
    if (current === 0 && !shouting) return token;
    if (!shouting && keepsCase(token)) return token;
    return token.toLowerCase();
  });
  return capitalizeFirst(out);
}

/**
 * Generic, language-agnostic problems with a title. Returns human-readable
 * English sentences (they are fed back to the model by the title-fix prompt).
 * `lang` only matters for the casing check, which applies to languages that use
 * sentence case (fr, es, it, pt).
 */
export function titleIssues(title: string, lang: string): string[] {
  const t = (title ?? "").trim();
  if (t === "") return ["The title is empty."];

  const issues: string[] = [];
  if (t.length > TITLE_MAX_LEN) {
    issues.push(`The title is ${t.length} characters long; the maximum is ${TITLE_MAX_LEN}.`);
  }
  if (stripTrailingPeriod(t) !== t) issues.push("The title ends with a period.");
  if (isShouting(t)) issues.push("The title is written in ALL CAPS.");
  if (stripWrappingQuotes(t) !== t) issues.push("The title is wrapped in quotation marks.");
  if (usesSentenceCase(lang) && !isShouting(t) && looksLikeTitleCase(t)) {
    issues.push("The title capitalizes every word; use sentence case (only the first word and proper nouns are capitalized).");
  }
  return issues;
}

/**
 * Mechanical, safe clean-up: collapse spaces, drop wrapping quotes and the
 * trailing period. For fr/es/it/pt, a title written in Title Case (or in all
 * caps) is converted to sentence case, keeping acronyms and words with inner
 * capitals. English and other languages keep their casing. Never shortens or
 * rewords.
 */
export function normalizeTitle(title: string, lang: string): string {
  let s = (title ?? "").replace(/\s+/g, " ").trim();
  if (s === "") return "";
  // Two passes: the period can sit inside the quotes ("Title.") or outside ("Title".).
  for (let i = 0; i < 2; i++) {
    s = stripWrappingQuotes(s);
    s = stripTrailingPeriod(s);
  }
  if (s === "") return "";
  if (usesSentenceCase(lang) && (isShouting(s) || looksLikeTitleCase(s))) {
    return toSentenceCase(s);
  }
  return s;
}

// ---- Meta tags --------------------------------------------------------------

/** Cuts on a word boundary (unless that would drop more than half the text). */
function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  // Do not split a surrogate pair (emoji).
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > max / 2) cut = cut.slice(0, lastSpace);
  return cut.replace(/[\s,;:\-–—]+$/u, "");
}

/**
 * `<title>` tag text: at most 60 characters. Keeps `metaTitle` when it is usable,
 * otherwise falls back to the article title (cut on a word boundary if needed).
 */
export function clampMetaTitle(metaTitle: string, title: string): string {
  const meta = (metaTitle ?? "").replace(/\s+/g, " ").trim();
  if (meta !== "" && meta.length <= META_TITLE_MAX_LEN) return meta;
  return cutAtWord((title ?? "").replace(/\s+/g, " ").trim(), META_TITLE_MAX_LEN);
}

function ellipsize(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${cutAtWord(s, max - 1)}…`;
}

/**
 * Meta description: at most 160 characters. Over-long text is cut on a word
 * boundary and ends with an ellipsis; an empty description falls back to
 * `fallback` (typically the excerpt), clamped the same way.
 */
export function clampMetaDescription(desc: string, fallback: string): string {
  const clean = (value: string) => (value ?? "").replace(/\s+/g, " ").trim();
  const text = clean(desc) !== "" ? clean(desc) : clean(fallback);
  return ellipsize(text, META_DESCRIPTION_MAX_LEN);
}

// ---- Reading time -----------------------------------------------------------

/** Estimated reading time: ceil(words / 220), never below 1 minute. */
export function readingTimeMinutes(markdown: string): number {
  const text = (markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`~|]+/g, " ");
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
