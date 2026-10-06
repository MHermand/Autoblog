// Settings: defaults, strict validation (admin writes) and lenient parsing
// (reads of whatever is stored). Everything that makes an instance "white label"
// lives in `BlogSettings`; no brand or domain knowledge belongs in this file.

import { z } from "zod";
import { isValidTimeZone } from "./schedule";
import type { BlogSettings, ScheduleRule } from "./types";

export const DEFAULT_SETTINGS: BlogSettings = {
  brandName: "",
  siteUrl: "",
  language: "en",
  timezone: "UTC",
  audience: "",
  tone: "",
  topicGuidelines: "",
  companyContext: "",
  callToAction: "",
  wordCountMin: 800,
  wordCountMax: 1200,
  bodyImageCount: 2,
  imageStyle: "",
  textProvider: "gemini",
  textModel: null,
  imageProvider: "gemini",
  imageModel: null,
  automation: {
    enabled: false,
    publishHour: 9,
    rule: { kind: "interval", everyDays: 3 },
    horizonDays: 14,
  },
};

// ---- Field schemas ----------------------------------------------------------

const TIMEZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

function isLanguageTag(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const text = (max: number) => z.string().trim().max(max);

const modelName = z
  .union([text(100), z.null()])
  .transform((value) => (value === "" ? null : value));

const scheduleRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("interval"),
    everyDays: z.number().int().min(1).max(14),
  }),
  z.object({
    kind: z.literal("weekly"),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, "weekdays must be unique"),
  }),
  z.object({
    kind: z.literal("monthly"),
    dayOfMonth: z.number().int().min(1).max(28),
  }),
]);

const automationShape = {
  enabled: z.boolean(),
  publishHour: z.number().int().min(0).max(23),
  rule: scheduleRuleSchema,
  horizonDays: z.number().int().min(1).max(30),
};

const fieldShape = {
  brandName: text(100),
  siteUrl: text(300).refine((v) => v === "" || isHttpUrl(v), "siteUrl must be an http(s) URL or empty"),
  language: text(35).refine(isLanguageTag, "language must be a valid BCP 47 tag"),
  timezone: text(64).refine(
    (v) => TIMEZONE_SHAPE.test(v) && isValidTimeZone(v),
    "timezone must be a valid IANA timezone",
  ),
  audience: text(500),
  tone: text(300),
  topicGuidelines: text(4000),
  companyContext: text(8000),
  callToAction: text(500),
  wordCountMin: z.number().int().min(300).max(3000),
  wordCountMax: z.number().int().min(300).max(3000),
  bodyImageCount: z.number().int().min(0).max(3),
  imageStyle: text(500),
  textProvider: z.enum(["gemini", "openai", "anthropic"]),
  textModel: modelName,
  imageProvider: z.enum(["gemini", "openai", "none"]),
  imageModel: modelName,
};

/**
 * Strict validation, used when an admin saves settings. Unknown keys are
 * stripped; every known key is required and bounds-checked.
 */
export const settingsSchema: z.ZodType<BlogSettings> = z
  .object({ ...fieldShape, automation: z.object(automationShape) })
  .refine((s) => s.wordCountMin <= s.wordCountMax, {
    message: "wordCountMin must not exceed wordCountMax",
    path: ["wordCountMin"],
  });

// ---- Lenient parsing --------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copies every valid, present field of `source` over `target`; invalid ones are ignored. */
function mergeValid(
  target: Record<string, unknown>,
  shape: Record<string, z.ZodType>,
  source: Record<string, unknown>,
): void {
  for (const key of Object.keys(shape)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    try {
      const result = shape[key].safeParse(source[key]);
      if (result.success) target[key] = result.data;
    } catch {
      // A throwing getter or proxy on untrusted input: treat the field as invalid.
    }
  }
}

/** Weekdays are cheap to repair (dedupe, sort, drop junk) before validating a stored rule. */
function repairRule(raw: unknown): unknown {
  if (!isRecord(raw) || raw.kind !== "weekly" || !Array.isArray(raw.weekdays)) return raw;
  const days = raw.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7);
  return { kind: "weekly", weekdays: [...new Set(days)].sort((a, b) => a - b) } satisfies ScheduleRule;
}

/**
 * Lenient reader for stored or untrusted data. Merges valid fields onto the
 * defaults and ignores everything else; it never throws, whatever the input.
 * Always returns a fresh object.
 */
export function parseSettings(input: unknown): BlogSettings {
  try {
    return mergeStored(input);
  } catch {
    // Hostile input (throwing getters, proxies): the defaults are always a safe answer.
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function mergeStored(input: unknown): BlogSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (!isRecord(input)) return settings;

  mergeValid(settings as unknown as Record<string, unknown>, fieldShape, input);

  if (isRecord(input.automation)) {
    const automation = { ...input.automation, rule: repairRule(input.automation.rule) };
    mergeValid(settings.automation as unknown as Record<string, unknown>, automationShape, automation);
  }

  // Both bounds are valid on their own but contradict each other: fall back to the defaults.
  if (settings.wordCountMin > settings.wordCountMax) {
    settings.wordCountMin = DEFAULT_SETTINGS.wordCountMin;
    settings.wordCountMax = DEFAULT_SETTINGS.wordCountMax;
  }
  return settings;
}

// ---- Helpers shared by the prompt builders ----------------------------------

/** English name of a BCP 47 language tag ("fr" -> "French"), or the tag itself if unknown. */
export function languageName(tag: string): string {
  const value = (tag ?? "").trim() || "en";
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(value);
    return name && name !== "undefined" ? name : value;
  } catch {
    return value;
  }
}
