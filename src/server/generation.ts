// Generation pipeline (docs/architecture.md, "Generation pipeline"):
// topics, article, title fix, images, Markdown, insert with a unique slug.
// Also the automation tick, automation status and re-spacing.

import "server-only";

import { randomUUID } from "node:crypto";
import {
  assembleMarkdown,
  ensureImagePrompts,
  finalizeImagePrompt,
  parseGeneratedArticle,
} from "@/core/article";
import { createImageModel, createTextModel, LlmError, MissingApiKeyError } from "@/core/llm";
import { buildArticlePrompt, buildSystemPrompt, buildTitleFixPrompt } from "@/core/prompts";
import { computeNextSlot, planSlots } from "@/core/schedule";
import { clampMetaDescription, clampMetaTitle, normalizeTitle, titleIssues } from "@/core/seo";
import { nextAvailableSlug, slugify } from "@/core/slug";
import { annotateTopics, buildTopicsPrompt, parseTopics } from "@/core/topics";
import type {
  BlogSettings,
  GeneratedArticle,
  ImageModel,
  Post,
  PostSource,
  RecentPost,
  TextModel,
  TopicSuggestion,
} from "@/core/types";
import type { PostInsertRow } from "./db-types";
import { getLlmKeys } from "./env";
import { errorMessage, GenerationError, SlotTakenError, SlugTakenError } from "./errors";
import { isAllowedImageType, sniffImageType } from "./images";
import { cleanTitleReply, horizonEnd, planRespacing, runTick, topicWindowStart, type TickOutcome } from "./pipeline";
import {
  autoPostExistsAt,
  countUpcomingAutoPosts,
  createPost,
  findSlugsWithPrefix,
  getLastAutoSlot,
  getLastLiveAutoPublishedAt,
  getRecentPosts,
  listUpcomingAutoPosts,
  setPublishedAt,
} from "./posts";
import { getSettings } from "./settings";
import { removeImages, uploadImage } from "./storage";
import type { AutomationStatus, GeneratePostResult, ProviderAvailability } from "./types";

const ARTICLE_TEMPERATURE = 0.9;
// A long article is ~3k tokens of JSON; reasoning models also spend thinking tokens from this budget.
const ARTICLE_MAX_OUTPUT_TOKENS = 16384;
const TOPICS_TEMPERATURE = 1;
// Thinking tokens count against these limits on some models: keep headroom.
const TOPICS_MAX_OUTPUT_TOKENS = 4096;
const TITLE_FIX_TEMPERATURE = 0.4;
const TITLE_FIX_MAX_OUTPUT_TOKENS = 1024;
const AUTOMATION_TOPIC_CANDIDATES = 3;

function textModelFor(settings: BlogSettings): TextModel {
  return createTextModel(settings.textProvider, settings.textModel, getLlmKeys());
}

// ---- Topics ----------------------------------------------------------------

async function requestTopics(
  settings: BlogSettings,
  p: { count: number; recent: RecentPost[]; exclude: string[]; now: Date },
): Promise<{ title: string; angle: string }[]> {
  const model = textModelFor(settings);
  const { system, prompt } = buildTopicsPrompt(settings, p);
  const raw = await model.generate({
    system,
    prompt,
    temperature: TOPICS_TEMPERATURE,
    maxOutputTokens: TOPICS_MAX_OUTPUT_TOKENS,
    json: true,
  });
  try {
    return parseTopics(raw);
  } catch (err) {
    throw new GenerationError("invalid_llm_output", errorMessage(err));
  }
}

/** Topic suggestions for the admin, each annotated with its overlap with recent posts. */
export async function suggestTopics(p: { count: number; exclude: string[]; now: Date }): Promise<TopicSuggestion[]> {
  const settings = await getSettings();
  const recent = await getRecentPosts(topicWindowStart(p.now));
  const topics = await requestTopics(settings, { count: p.count, recent, exclude: p.exclude, now: p.now });
  return annotateTopics(topics.slice(0, p.count), recent, p.now);
}

// ---- Article ---------------------------------------------------------------

/** Malformed or truncated JSON happens now and then: one more attempt before giving up. */
const ARTICLE_ATTEMPTS = 2;

async function writeArticle(model: TextModel, settings: BlogSettings, topic: string): Promise<GeneratedArticle> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ARTICLE_ATTEMPTS; attempt++) {
    const raw = await model.generate({
      system: buildSystemPrompt(settings),
      prompt: buildArticlePrompt(settings, topic),
      temperature: ARTICLE_TEMPERATURE,
      maxOutputTokens: ARTICLE_MAX_OUTPUT_TOKENS,
      json: true,
    });
    try {
      return parseGeneratedArticle(raw);
    } catch (err) {
      lastError = err;
    }
  }
  throw new GenerationError("invalid_llm_output", errorMessage(lastError));
}

/** Normalized title; when issues remain, ONE cheap fix call, keeping whichever version has fewer issues. */
async function finalizeTitle(
  model: TextModel,
  settings: BlogSettings,
  rawTitle: string,
  warnings: string[],
): Promise<string> {
  const lang = settings.language;
  const title = normalizeTitle(rawTitle, lang);
  const issues = titleIssues(title, lang);
  if (issues.length === 0) return title;

  try {
    const reply = await model.generate({
      system: buildSystemPrompt(settings),
      prompt: buildTitleFixPrompt(settings, title, issues),
      temperature: TITLE_FIX_TEMPERATURE,
      maxOutputTokens: TITLE_FIX_MAX_OUTPUT_TOKENS,
    });
    const fixed = normalizeTitle(cleanTitleReply(reply), lang);
    if (fixed !== "" && titleIssues(fixed, lang).length < issues.length) return fixed;
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    warnings.push(`Title fix skipped: ${err.message}`);
  }
  return title;
}

// ---- Images ----------------------------------------------------------------

interface ArticleImages {
  cover: { url: string; alt: string } | null;
  body: { url: string; alt: string }[];
  /** Storage paths of every uploaded image (for cleanup if the insert fails). */
  paths: string[];
}

async function renderImage(
  model: ImageModel,
  p: { prompt: string; aspectRatio: "16:9" | "4:3"; folder: string; name: string },
) {
  const image = await model.generate({ prompt: p.prompt, aspectRatio: p.aspectRatio });
  const type = sniffImageType(image.data) ?? (isAllowedImageType(image.mimeType) ? image.mimeType : null);
  if (!type) throw new Error(`unsupported image format (${image.mimeType})`);
  return uploadImage({ bytes: image.data, type, name: p.name, folder: p.folder });
}

/** Cover (16:9) + body images (4:3) in parallel. Failures become warnings, never errors. */
async function generateImages(
  settings: BlogSettings,
  article: GeneratedArticle,
  folder: string,
  warnings: string[],
): Promise<ArticleImages> {
  const result: ArticleImages = { cover: null, body: [], paths: [] };

  let model: ImageModel | null;
  try {
    model = createImageModel(settings.imageProvider, settings.imageModel, getLlmKeys());
  } catch (err) {
    if (!(err instanceof MissingApiKeyError)) throw err;
    warnings.push(`Images skipped: ${err.message}`);
    return result;
  }
  if (!model) return result; // imageProvider "none"
  const imageModel = model;

  const prompts = ensureImagePrompts(article, 1 + settings.bodyImageCount);
  const settled = await Promise.allSettled(
    prompts.map((p, index) => {
      const kind = index === 0 ? "cover" : "body";
      return renderImage(imageModel, {
        prompt: finalizeImagePrompt(p.prompt, settings, kind),
        aspectRatio: kind === "cover" ? "16:9" : "4:3",
        folder,
        name: index === 0 ? "cover" : `image-${index}`,
      });
    }),
  );

  settled.forEach((outcome, index) => {
    const label = index === 0 ? "Cover image" : `Body image ${index}`;
    if (outcome.status === "rejected") {
      warnings.push(`${label} failed: ${errorMessage(outcome.reason)}`);
      return;
    }
    result.paths.push(outcome.value.path);
    const image = { url: outcome.value.url, alt: prompts[index].alt };
    if (index === 0) result.cover = image;
    else result.body.push(image);
  });
  return result;
}

// ---- Insert ----------------------------------------------------------------

/** Inserts with the first free slug derived from the title; retries once on a concurrent slug clash. */
async function insertWithUniqueSlug(row: Omit<PostInsertRow, "slug">, title: string): Promise<Post> {
  const base = slugify(title);
  for (let attempt = 1; ; attempt++) {
    const slug = nextAvailableSlug(base, await findSlugsWithPrefix(base));
    try {
      return await createPost({ ...row, slug });
    } catch (err) {
      if (err instanceof SlugTakenError && attempt < 2) continue;
      throw err;
    }
  }
}

export interface GeneratePostInput {
  topic: string;
  /** null = draft. */
  publishedAt: Date | null;
  source: PostSource;
}

/** Generates one article end to end and stores it. Returns the post and non-fatal warnings. */
export async function generatePost(input: GeneratePostInput): Promise<GeneratePostResult> {
  const settings = await getSettings();
  const model = textModelFor(settings);
  const lang = settings.language;
  const warnings: string[] = [];

  const article = await writeArticle(model, settings, input.topic);
  const title = await finalizeTitle(model, settings, article.title, warnings);

  // Pre-generated so the images can live under posts/<post id>/.
  const id = randomUUID();
  const images = await generateImages(settings, article, id, warnings);

  try {
    // Concurrency guard for overlapping automation runs: see runAutomationTick.
    if (input.source === "auto" && input.publishedAt && (await autoPostExistsAt(input.publishedAt))) {
      throw new SlotTakenError(input.publishedAt);
    }
    const post = await insertWithUniqueSlug(
      {
        id,
        title,
        excerpt: article.excerpt,
        content_markdown: assembleMarkdown(article.sections, images.body),
        cover_image_url: images.cover?.url ?? null,
        cover_image_alt: images.cover?.alt ?? null,
        tags: article.tags,
        meta_title: clampMetaTitle(article.metaTitle, title),
        meta_description: clampMetaDescription(article.metaDescription, article.excerpt),
        lang,
        source: input.source,
        published_at: input.publishedAt ? input.publishedAt.toISOString() : null,
      },
      title,
    );
    return { post, warnings };
  } catch (err) {
    await removeImages(images.paths);
    throw err;
  }
}

// ---- Automation ------------------------------------------------------------

/**
 * Fills the next empty automation slots (at most 2 per call).
 *
 * Concurrency: two overlapping ticks would compute the same slot. Right before
 * inserting, generatePost re-checks that no auto post exists at that exact
 * timestamp and aborts with SlotTakenError (reason "slot_taken", uploaded
 * images are removed). The remaining race window is the few milliseconds
 * between that check and the insert; at worst it yields two auto posts at the
 * same time, which the admin can delete, and later ticks are unaffected (the
 * next slot is computed from the latest one).
 */
export async function runAutomationTick(now: Date): Promise<TickOutcome> {
  const startedAt = Date.now();
  return runTick(
    {
      getSettings,
      getLastAutoSlot,
      getRecentPosts,
      suggestTopics: (settings, recent, at) =>
        requestTopics(settings, { count: AUTOMATION_TOPIC_CANDIDATES, recent, exclude: [], now: at }),
      generate: async ({ topic, publishedAt }) => {
        await generatePost({ topic, publishedAt, source: "auto" });
      },
      elapsedMs: () => Date.now() - startedAt,
    },
    now,
  );
}

/** Moves upcoming auto posts onto the slots of the current schedule. Returns how many moved. */
export async function respaceUpcomingAutoPosts(settings: BlogSettings, now: Date): Promise<number> {
  const [upcoming, lastPublished] = await Promise.all([listUpcomingAutoPosts(now), getLastLiveAutoPublishedAt(now)]);
  if (upcoming.length === 0) return 0;
  const slots = planSlots({
    automation: settings.automation,
    timezone: settings.timezone,
    now,
    count: upcoming.length,
    lastPublished,
  });
  const changes = planRespacing(upcoming, slots);
  for (const change of changes) await setPublishedAt(change.id, change.publishedAt);
  return changes.length;
}

export async function getAutomationStatus(settings: BlogSettings, now: Date): Promise<AutomationStatus> {
  const [lastSlot, lastLive, upcomingAutoCount] = await Promise.all([
    getLastAutoSlot(horizonEnd(settings, now)),
    getLastLiveAutoPublishedAt(now),
    countUpcomingAutoPosts(now),
  ]);
  const nextSlot = settings.automation.enabled
    ? computeNextSlot({ automation: settings.automation, timezone: settings.timezone, lastSlot, now })
    : null;
  return {
    nextSlot: nextSlot ? nextSlot.toISOString() : null,
    upcomingAutoCount,
    lastAutoPublishedAt: lastLive ? lastLive.toISOString() : null,
  };
}

/** Which providers have an API key configured (never the keys themselves). */
export function getProviderAvailability(): ProviderAvailability {
  const keys = getLlmKeys();
  return {
    text: { gemini: Boolean(keys.gemini), openai: Boolean(keys.openai), anthropic: Boolean(keys.anthropic) },
    image: { gemini: Boolean(keys.gemini), openai: Boolean(keys.openai) },
  };
}
