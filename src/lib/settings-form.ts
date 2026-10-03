// Form model for the settings screen: conversion to/from `BlogSettings` and
// client-side validation. The bounds mirror `settingsSchema` in
// src/core/settings.ts (the server stays the source of truth).

import type { BlogSettings, ImageProvider, ScheduleRule, TextProvider } from "@/core/types";
import { isValidTimeZone } from "@/lib/datetime";

export const LIMITS = {
  brandName: 100,
  siteUrl: 300,
  language: 35,
  audience: 500,
  tone: 300,
  topicGuidelines: 4000,
  companyContext: 8000,
  callToAction: 500,
  imageStyle: 500,
  model: 100,
  wordCount: { min: 300, max: 3000 },
  bodyImageCount: { min: 0, max: 3 },
  everyDays: { min: 1, max: 14 },
  dayOfMonth: { min: 1, max: 28 },
  publishHour: { min: 0, max: 23 },
  horizonDays: { min: 1, max: 30 },
} as const;

/** Flat, string-friendly state of the settings form (numbers stay strings while typing). */
export interface SettingsFormState {
  brandName: string;
  siteUrl: string;
  companyContext: string;
  language: string;
  audience: string;
  tone: string;
  topicGuidelines: string;
  callToAction: string;
  wordCountMin: string;
  wordCountMax: string;
  imageProvider: ImageProvider;
  imageModel: string;
  bodyImageCount: string;
  imageStyle: string;
  textProvider: TextProvider;
  textModel: string;
  automationEnabled: boolean;
  ruleKind: ScheduleRule["kind"];
  everyDays: string;
  /** ISO weekdays, 1 = Monday ... 7 = Sunday, kept sorted. */
  weekdays: number[];
  dayOfMonth: string;
  publishHour: string;
  horizonDays: string;
  timezone: string;
}

export type FieldErrorCode =
  | "invalidUrl"
  | "invalidLanguage"
  | "invalidTimezone"
  | "range"
  | "minGreaterThanMax"
  | "weekdays";

export interface FieldError {
  code: FieldErrorCode;
  min?: number;
  max?: number;
}

export type SettingsErrors = Partial<Record<keyof SettingsFormState, FieldError>>;

const DEFAULT_RULE_VALUES = { everyDays: "3", weekdays: [1], dayOfMonth: "1" };

export function settingsToForm(s: BlogSettings): SettingsFormState {
  const rule = s.automation.rule;
  return {
    brandName: s.brandName,
    siteUrl: s.siteUrl,
    companyContext: s.companyContext,
    language: s.language,
    audience: s.audience,
    tone: s.tone,
    topicGuidelines: s.topicGuidelines,
    callToAction: s.callToAction,
    wordCountMin: String(s.wordCountMin),
    wordCountMax: String(s.wordCountMax),
    imageProvider: s.imageProvider,
    imageModel: s.imageModel ?? "",
    bodyImageCount: String(s.bodyImageCount),
    imageStyle: s.imageStyle,
    textProvider: s.textProvider,
    textModel: s.textModel ?? "",
    automationEnabled: s.automation.enabled,
    ruleKind: rule.kind,
    everyDays: rule.kind === "interval" ? String(rule.everyDays) : DEFAULT_RULE_VALUES.everyDays,
    weekdays: rule.kind === "weekly" ? [...rule.weekdays].sort((a, b) => a - b) : DEFAULT_RULE_VALUES.weekdays,
    dayOfMonth: rule.kind === "monthly" ? String(rule.dayOfMonth) : DEFAULT_RULE_VALUES.dayOfMonth,
    publishHour: String(s.automation.publishHour),
    horizonDays: String(s.automation.horizonDays),
    timezone: s.timezone,
  };
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

function inRange(value: string, { min, max }: { min: number; max: number }): boolean {
  const n = parseInteger(value);
  return n !== null && n >= min && n <= max;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function isLanguageTag(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value.trim()).length === 1;
  } catch {
    return false;
  }
}

export function validateSettingsForm(form: SettingsFormState): SettingsErrors {
  const errors: SettingsErrors = {};
  const range = (key: keyof SettingsFormState, bounds: { min: number; max: number }) => {
    if (!inRange(String(form[key]), bounds)) errors[key] = { code: "range", ...bounds };
  };

  const siteUrl = form.siteUrl.trim();
  if (siteUrl !== "" && !isHttpUrl(siteUrl)) errors.siteUrl = { code: "invalidUrl" };

  if (!isLanguageTag(form.language)) errors.language = { code: "invalidLanguage" };
  if (!isValidTimeZone(form.timezone)) errors.timezone = { code: "invalidTimezone" };

  range("wordCountMin", LIMITS.wordCount);
  range("wordCountMax", LIMITS.wordCount);
  if (!errors.wordCountMin && !errors.wordCountMax && Number(form.wordCountMin) > Number(form.wordCountMax)) {
    errors.wordCountMin = { code: "minGreaterThanMax" };
  }

  range("bodyImageCount", LIMITS.bodyImageCount);
  range("publishHour", LIMITS.publishHour);
  range("horizonDays", LIMITS.horizonDays);

  if (form.ruleKind === "interval") range("everyDays", LIMITS.everyDays);
  if (form.ruleKind === "monthly") range("dayOfMonth", LIMITS.dayOfMonth);
  if (form.ruleKind === "weekly" && form.weekdays.length === 0) errors.weekdays = { code: "weekdays" };

  return errors;
}

function buildRule(form: SettingsFormState): ScheduleRule {
  switch (form.ruleKind) {
    case "interval":
      return { kind: "interval", everyDays: Number(form.everyDays) };
    case "weekly":
      return { kind: "weekly", weekdays: [...form.weekdays].sort((a, b) => a - b) };
    case "monthly":
      return { kind: "monthly", dayOfMonth: Number(form.dayOfMonth) };
  }
}

/** Builds the payload to save. Call it only when `validateSettingsForm` found no error. */
export function formToSettings(form: SettingsFormState): BlogSettings {
  return {
    brandName: form.brandName.trim(),
    siteUrl: form.siteUrl.trim(),
    language: form.language.trim(),
    timezone: form.timezone,
    audience: form.audience.trim(),
    tone: form.tone.trim(),
    topicGuidelines: form.topicGuidelines.trim(),
    companyContext: form.companyContext.trim(),
    callToAction: form.callToAction.trim(),
    wordCountMin: Number(form.wordCountMin),
    wordCountMax: Number(form.wordCountMax),
    bodyImageCount: Number(form.bodyImageCount),
    imageStyle: form.imageStyle.trim(),
    textProvider: form.textProvider,
    textModel: form.textModel.trim() || null,
    imageProvider: form.imageProvider,
    imageModel: form.imageModel.trim() || null,
    automation: {
      enabled: form.automationEnabled,
      publishHour: Number(form.publishHour),
      rule: buildRule(form),
      horizonDays: Number(form.horizonDays),
    },
  };
}

export function isSettingsFormEqual(a: SettingsFormState, b: SettingsFormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
