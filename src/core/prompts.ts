// Prompt builders. Every brand- or domain-specific word comes from BlogSettings;
// the text below is deliberately generic and works for any niche and language.

import { languageName } from "./settings";
import { TITLE_MAX_LEN, usesSentenceCase } from "./seo";
import type { BlogSettings } from "./types";

const COMPANY_CONTEXT_MAX_CHARS = 4000;
// Same cap as POST /api/admin/generate.
const TOPIC_MAX_CHARS = 500;

/** "French (fr)": the name helps the model, the tag disambiguates dialects. */
export function languageLabel(tag: string): string {
  const name = languageName(tag);
  return name === tag.trim() ? name : `${name} (${tag.trim()})`;
}

function clean(value: string): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function brandOf(settings: BlogSettings): string {
  return clean(settings.brandName);
}

/**
 * Title rules shared by the topic, article and title-fix prompts, so the model
 * is told the same thing at every step.
 */
export function titleGuidelines(language: string): string {
  const label = languageLabel(language);
  const casing = usesSentenceCase(language)
    ? "Use sentence case: capitalize only the first word and proper nouns, never Every Word Of The Title."
    : `Follow the usual headline capitalization of ${label}, and avoid Capitalizing Every Word unless that is the norm.`;
  return [
    `- At most ${TITLE_MAX_LEN} characters, punctuation included. A shorter title is a better title.`,
    `- ${casing}`,
    "- Vary the shape from one title to the next: a number, a question, a concrete promise, an action verb, or just a plain clear sentence. Use at most one colon, and prefer none.",
    `- No clickbait or hype: avoid words such as "ultimate", "revolutionary", "game-changing", "secret", "shocking", "you won't believe" and their equivalents in ${label}. Never promise more than the article delivers.`,
    "- No quotation marks around the title, no final period, no emoji, no ALL CAPS.",
  ].join("\n");
}

/** Writer persona for the whole generation pipeline. */
export function buildSystemPrompt(settings: BlogSettings): string {
  const brand = brandOf(settings);
  const audience = clean(settings.audience);
  const tone = clean(settings.tone);

  const lines = [
    brand ? `You are the lead writer of the blog of ${brand}.` : "You are the lead writer of a company blog.",
    `Audience: ${audience || "a general readership interested in the topic"}.`,
    `Voice and tone: ${tone || "clear, friendly and practical"}.`,
    `Language: write everything in ${languageLabel(settings.language)}.`,
    "",
    "Standards:",
    "- Be accurate and concrete: examples, steps and figures you are sure of, rather than generalities.",
    "- Never invent statistics, studies, quotes, testimonials or facts about the company. When unsure, stay general.",
    "- Write for readers first and search engines second: a clear structure, natural wording, no keyword stuffing, no filler introduction.",
    "- Do not use emojis.",
    "- Follow the output format requested in each task exactly.",
  ];

  const context = (settings.companyContext ?? "")
    .replace(/<\/?company_context>/gi, "")
    .trim()
    .slice(0, COMPANY_CONTEXT_MAX_CHARS)
    .trimEnd();
  if (context !== "") {
    lines.push(
      "",
      `Reference material about ${brand || "the company"}, provided by the site owner. Use it for facts and positioning; do not copy it verbatim:`,
      "<company_context>",
      context,
      "</company_context>",
    );
  }
  return lines.join("\n");
}

/** One full article as strict JSON (see `GeneratedArticle`). */
export function buildArticlePrompt(settings: BlogSettings, topic: string): string {
  const brand = brandOf(settings);
  const label = languageLabel(settings.language);
  const cta = clean(settings.callToAction);
  const siteUrl = settings.siteUrl.trim();
  const imageCount = 1 + settings.bodyImageCount;
  const subject = clean(topic).slice(0, TOPIC_MAX_CHARS);

  const ending = cta
    ? [
        `- Ending: finish with a short closing paragraph that delivers this call to action in your own words and in the voice above: "${cta}".`,
        siteUrl
          ? `  You may point readers to ${siteUrl} once, as a Markdown link inside that closing paragraph. It is the only place where a URL or link may appear in the article.`
          : "  Do not include any URL or link anywhere in the article.",
      ].join("\n")
    : "- Ending: conclude with a natural takeaway. Do not add a call to action, and do not include any URL or link anywhere in the article.";

  const bodyImages =
    settings.bodyImageCount > 0
      ? `; the following ${settings.bodyImageCount} illustrate specific sections of the article, in reading order`
      : "";

  return [
    `Write a complete blog article in ${label} about this topic:`,
    `"${subject}"`,
    "",
    "## Article requirements",
    `- Length: between ${settings.wordCountMin} and ${settings.wordCountMax} words of body text.`,
    "- Structure: 4 to 6 sections, each introduced by an h2 heading (h3 subheadings are optional), with developed paragraphs and at least one bulleted or numbered list. Start directly with content: no heading or label for the introduction.",
    "- Substance: concrete advice, examples and steps. No filler. Do not invent statistics, sources or quotes.",
    brand
      ? `- Brand: mention ${brand} only where it is genuinely relevant, naturally and at most once or twice. Never force it.`
      : "- Do not name any company or product unless the topic requires it.",
    ending,
    "- Formatting: text fields may use inline Markdown emphasis (**bold**, *italic*). Apart from the closing link described above, if any, they contain no headings, HTML or links.",
    "",
    "## Title rules (the \"title\" field)",
    titleGuidelines(settings.language),
    "",
    "## SEO fields",
    "- excerpt: one or two sentences that make a reader want to continue. Plain text.",
    "- metaTitle: at most 60 characters. Plain text.",
    "- metaDescription: at most 160 characters (aim for 140-155) that summarize the article. Plain text.",
    `- tags: 3 to 5 short, reusable topic tags (one to three words each) in ${label}. Tags are categories, not sentences.`,
    "",
    "## Images",
    `- Provide exactly ${imageCount} entries in "images". The first is the cover image${bodyImages}.`,
    `- "prompt": a description in ENGLISH of one concrete scene tied to the article (subject, setting, composition, lighting). Describe the scene, not the visual style: the style is added automatically. Never ask for text, numbers, logos, watermarks or screenshots of interfaces in the image.`,
    `- "alt": a short, descriptive alt text in ${label}.`,
    "",
    "## Output",
    "Return STRICT JSON only: a single object, no Markdown fences, no commentary before or after. Exact shape:",
    "{",
    '  "title": "...",',
    '  "excerpt": "...",',
    '  "metaTitle": "...",',
    '  "metaDescription": "...",',
    '  "tags": ["...", "...", "..."],',
    '  "sections": [',
    '    { "type": "h2", "text": "..." },',
    '    { "type": "p", "text": "..." },',
    '    { "type": "ul", "items": ["...", "..."] }',
    "  ],",
    '  "images": [ { "prompt": "...", "alt": "..." } ]',
    "}",
    'Section types: "h2", "h3", "p" and "quote" use "text"; "ul" and "ol" use "items" (an array of strings).',
  ].join("\n");
}

/** Asks for ONE corrected title, as plain text. */
export function buildTitleFixPrompt(settings: BlogSettings, title: string, issues: string[]): string {
  const label = languageLabel(settings.language);
  const problems = issues.length > 0 ? issues.map((issue) => `- ${clean(issue)}`).join("\n") : "- (none reported: just make it fit the rules)";
  return [
    "Rewrite this blog post title so that it fixes the problems listed below.",
    "",
    `Title: ${clean(title)}`,
    "Problems:",
    problems,
    "",
    "Rules:",
    titleGuidelines(settings.language),
    `- Keep the same meaning and the same language (${label}). Do not add information.`,
    "",
    "Reply with the corrected title only: plain text on a single line, without quotation marks or any explanation.",
  ].join("\n");
}
