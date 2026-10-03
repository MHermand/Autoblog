// Shared domain types. Pure TypeScript: no runtime imports, usable from
// server code, client components and tests alike.

/** When automatic articles are published. Weekdays are ISO (1 = Monday … 7 = Sunday). */
export type ScheduleRule =
  | { kind: "interval"; everyDays: number } // 1-14
  | { kind: "weekly"; weekdays: number[] } // non-empty, values 1-7
  | { kind: "monthly"; dayOfMonth: number }; // 1-28

export interface AutomationConfig {
  enabled: boolean;
  /** Local hour (0-23) in `BlogSettings.timezone`. */
  publishHour: number;
  rule: ScheduleRule;
  /** How many days of articles are kept generated in advance. 1-30. */
  horizonDays: number;
}

export type TextProvider = "gemini" | "openai" | "anthropic";
export type ImageProvider = "gemini" | "openai" | "none";

/** Everything that makes an Autoblog instance "white label". Stored as JSON in DB. */
export interface BlogSettings {
  brandName: string;
  /** Public URL of the user's site, used in calls to action. May be empty. */
  siteUrl: string;
  /** Language articles are written in, as a BCP 47 tag ("en", "fr", "es-MX"…). */
  language: string;
  /** IANA timezone used for scheduling ("Europe/Paris"). */
  timezone: string;
  /** Who the articles are for. */
  audience: string;
  /** Voice and style ("friendly and practical", "expert, no jargon"…). */
  tone: string;
  /** Free-text angles / themes the topic generator should explore. */
  topicGuidelines: string;
  /** Markdown context about the company, injected into every prompt (truncated). */
  companyContext: string;
  /** Closing call to action. Empty string = no call to action. */
  callToAction: string;
  wordCountMin: number;
  wordCountMax: number;
  /** Images inside the article body, in addition to the cover. 0-3. */
  bodyImageCount: number;
  /** Visual style appended to every image prompt. */
  imageStyle: string;
  textProvider: TextProvider;
  /** null = provider default model. */
  textModel: string | null;
  imageProvider: ImageProvider;
  /** null = provider default model. */
  imageModel: string | null;
  automation: AutomationConfig;
}

export type PostSource = "manual" | "auto";

/** A stored article. `publishedAt` null = draft; future = scheduled; past = live. */
export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  contentMarkdown: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  tags: string[];
  metaTitle: string;
  metaDescription: string;
  lang: string;
  source: PostSource;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One block of an article as returned by the LLM. */
export type Section =
  | { type: "h2" | "h3" | "p" | "quote"; text: string }
  | { type: "ul" | "ol"; items: string[] };

export interface ImagePrompt {
  /** Scene description in English (image models follow English best). */
  prompt: string;
  /** Alt text in the article language. */
  alt: string;
}

/** Validated LLM output for one article. `imagePrompts[0]` is the cover. */
export interface GeneratedArticle {
  title: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  tags: string[];
  sections: Section[];
  imagePrompts: ImagePrompt[];
}

export interface TopicSuggestion {
  title: string;
  /** One sentence describing the angle. */
  angle: string;
  /** Human-readable reason this topic overlaps recent posts, or null. */
  overlap: string | null;
}

/** Minimal shape of a recent post used for topic de-duplication. */
export interface RecentPost {
  title: string;
  tags: string[];
  publishedAt: string; // ISO
}

// ---- LLM adapters ---------------------------------------------------------

export interface TextGenerationRequest {
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask the provider for a JSON object when it supports it. */
  json?: boolean;
}

export interface TextModel {
  provider: TextProvider;
  model: string;
  generate(req: TextGenerationRequest): Promise<string>;
}

export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio?: "16:9" | "4:3" | "1:1";
}

export interface GeneratedImage {
  data: Uint8Array;
  mimeType: string; // "image/png", "image/jpeg", "image/webp"
}

export interface ImageModel {
  provider: Exclude<ImageProvider, "none">;
  model: string;
  generate(req: ImageGenerationRequest): Promise<GeneratedImage>;
}

// ---- HTTP API shapes (docs/architecture.md) --------------------------------

export interface PublicPostSummary {
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  tags: string[];
  lang: string;
  publishedAt: string;
  metaTitle: string;
  metaDescription: string;
}

export interface PublicPost extends PublicPostSummary {
  contentMarkdown: string;
  /** Sanitized HTML rendered from `contentMarkdown`. */
  contentHtml: string;
  readingTimeMinutes: number;
  updatedAt: string;
}

export interface AutomationStatus {
  /** ISO, null when automation is disabled or the stock is full. */
  nextSlot: string | null;
  /** Scheduled auto posts in the future. */
  upcomingAutoCount: number;
  lastAutoPublishedAt: string | null;
}

export interface ProviderAvailability {
  /** true when the provider's API key is configured. */
  text: Record<"gemini" | "openai" | "anthropic", boolean>;
  image: Record<"gemini" | "openai", boolean>;
}
