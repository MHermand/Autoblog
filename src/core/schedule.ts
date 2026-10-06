// Publication slots: when the next automatic article should go live.
//
// Pure date arithmetic on top of `Intl` (no date library). Slots are anchored to
// a LOCAL wall-clock hour in an IANA timezone, so they stay at "09:00" across
// daylight-saving changes. All reasoning about calendar days happens on the
// local calendar of that timezone, never on UTC days: a 00:30 local slot falls
// on the previous UTC day and would otherwise shift weekdays.

import type { AutomationConfig, ScheduleRule } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Hard bound on calendar scans, so a malformed rule can never loop forever. */
const MAX_SCAN_DAYS = 400;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

// ---- Timezone plumbing ------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function getFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (formatters.has(timeZone)) return formatters.get(timeZone) ?? null;
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  } catch {
    formatter = null;
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

/** True when the runtime knows this IANA timezone (e.g. "America/New_York", "UTC"). */
export function isValidTimeZone(timeZone: string): boolean {
  return typeof timeZone === "string" && timeZone.trim() !== "" && getFormatter(timeZone.trim()) !== null;
}

/** Scheduling must never throw on a bad stored value: unknown zones fall back to UTC. */
function resolveTimeZone(timeZone: string): string {
  return isValidTimeZone(timeZone) ? timeZone.trim() : "UTC";
}

/** Local offset (ms to add to UTC to get wall-clock time) at a given instant. */
function offsetMs(instantMs: number, timeZone: string): number {
  const formatter = getFormatter(timeZone) as Intl.DateTimeFormat;
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
  // formatToParts drops milliseconds: compare against the truncated instant.
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Calendar day of an instant, as seen in the timezone. */
function ymdOf(instantMs: number, timeZone: string): Ymd {
  const wall = new Date(instantMs + offsetMs(instantMs, timeZone));
  return { y: wall.getUTCFullYear(), m: wall.getUTCMonth() + 1, d: wall.getUTCDate() };
}

/**
 * UTC instant of `hour`:00 local time on a calendar day.
 *
 * Daylight-saving edge cases: when the wall time is ambiguous (clocks go back)
 * the EARLIER instant is used; when it does not exist (clocks go forward) the
 * time moves forward past the gap, e.g. 02:00 becomes 03:00.
 */
function wallToUtc(day: Ymd, hour: number, timeZone: string): Date {
  const wallAsUtc = Date.UTC(day.y, day.m - 1, day.d, hour, 0, 0);
  // Offsets a day before and a day after bracket any transition on this day.
  const before = offsetMs(wallAsUtc - DAY_MS, timeZone);
  const after = offsetMs(wallAsUtc + DAY_MS, timeZone);
  const candidates = before === after ? [wallAsUtc - before] : [wallAsUtc - before, wallAsUtc - after];
  const valid = candidates.filter((c) => offsetMs(c, timeZone) === wallAsUtc - c);
  if (valid.length > 0) return new Date(Math.min(...valid));
  return new Date(wallAsUtc - before);
}

// ---- Calendar arithmetic (no instants, no timezone: DST cannot interfere) ---

function addDays(day: Ymd, days: number): Ymd {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d) + days * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function dayNumber(day: Ymd): number {
  return Math.round(Date.UTC(day.y, day.m - 1, day.d) / DAY_MS);
}

/** ISO weekday of a calendar day: 1 = Monday … 7 = Sunday. */
function isoWeekday(day: Ymd): number {
  const dow = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

// ---- Rule normalization -----------------------------------------------------

type Grid = (day: Ymd) => boolean;

type NormalizedRule =
  | { kind: "interval"; everyDays: number }
  | { kind: "grid"; matches: Grid };

function toInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeRule(rule: ScheduleRule): NormalizedRule | null {
  switch (rule?.kind) {
    case "interval":
      return { kind: "interval", everyDays: toInt(rule.everyDays, 1, 365, 1) };
    case "weekly": {
      const weekdays = new Set(
        (Array.isArray(rule.weekdays) ? rule.weekdays : []).filter(
          (d) => Number.isInteger(d) && d >= 1 && d <= 7,
        ),
      );
      if (weekdays.size === 0) return null;
      return { kind: "grid", matches: (day) => weekdays.has(isoWeekday(day)) };
    }
    case "monthly": {
      const dayOfMonth = toInt(rule.dayOfMonth, 1, 28, 1);
      return { kind: "grid", matches: (day) => day.d === dayOfMonth };
    }
    default:
      return null;
  }
}

interface Resolved {
  timeZone: string;
  hour: number;
  horizonDays: number;
  rule: NormalizedRule;
}

function resolve(automation: AutomationConfig, timezone: string): Resolved | null {
  const rule = normalizeRule(automation?.rule);
  if (!rule) return null;
  return {
    timeZone: resolveTimeZone(timezone),
    hour: toInt(automation.publishHour, 0, 23, 9),
    horizonDays: toInt(automation.horizonDays, 0, 366, 14),
    rule,
  };
}

/** First calendar day whose slot is strictly after `nowMs` (today if the hour has not passed). */
function firstDayAfter(nowMs: number, hour: number, timeZone: string): Ymd {
  let day = ymdOf(nowMs, timeZone);
  for (let i = 0; i < 4; i++) {
    if (wallToUtc(day, hour, timeZone).getTime() > nowMs) break;
    day = addDays(day, 1);
  }
  return day;
}

// ---- Public API -------------------------------------------------------------

/**
 * Next publication slot strictly after max(lastSlot, now), at `publishHour` local
 * time, or null when that slot lies beyond `now + horizonDays` (enough articles
 * are already queued) or the rule cannot produce a slot.
 *
 * - interval: `lastSlot` + everyDays calendar days. Without a last slot, or when
 *   that date is already in the past, the next slot from now (today if the
 *   publish hour has not passed yet, otherwise tomorrow).
 * - weekly / monthly: the grid is absolute. The slot is the first matching day
 *   that is still in the future and on a later local day than `lastSlot`
 *   (never two articles on the same day). For monthly rules, null is the normal
 *   answer most of the time.
 *
 * `automation.enabled` is not consulted here: callers decide whether to run.
 * An unknown timezone falls back to UTC rather than throwing.
 */
export function computeNextSlot(p: {
  automation: AutomationConfig;
  timezone: string;
  lastSlot: Date | null;
  now: Date;
}): Date | null {
  const resolved = resolve(p.automation, p.timezone);
  const nowMs = p.now.getTime();
  if (!resolved || !Number.isFinite(nowMs)) return null;
  const { timeZone, hour, rule } = resolved;
  const horizonLimit = nowMs + resolved.horizonDays * DAY_MS;

  const lastMs = p.lastSlot ? p.lastSlot.getTime() : Number.NaN;
  const lastDay = Number.isFinite(lastMs) ? ymdOf(lastMs, timeZone) : null;

  if (rule.kind === "interval") {
    let slot: Date | null = null;
    if (lastDay) {
      const candidate = wallToUtc(addDays(lastDay, rule.everyDays), hour, timeZone);
      if (candidate.getTime() > nowMs) slot = candidate;
    }
    slot ??= wallToUtc(firstDayAfter(nowMs, hour, timeZone), hour, timeZone);
    return slot.getTime() > horizonLimit ? null : slot;
  }

  const lastDayNumber = lastDay ? dayNumber(lastDay) : null;
  let day = ymdOf(nowMs, timeZone);
  for (let i = 0; i < MAX_SCAN_DAYS; i++, day = addDays(day, 1)) {
    const slot = wallToUtc(day, hour, timeZone);
    // Slots only move forward: once one is beyond the horizon, so are the rest.
    if (slot.getTime() > horizonLimit) return null;
    if (
      rule.matches(day) &&
      slot.getTime() > nowMs &&
      (lastDayNumber === null || dayNumber(day) > lastDayNumber)
    ) {
      return slot;
    }
  }
  return null;
}

/**
 * The first `count` consecutive slots after `now`, used to re-space already
 * scheduled posts when the schedule changes. No horizon applies: every existing
 * post gets a slot.
 *
 * `lastPublished` is the latest post already live: the rhythm continues from
 * it, so changing only the hour never brings the next post closer than the rule
 * allows, and no slot lands on the same local day.
 *
 * - interval: the later of the next slot from now and lastPublished + everyDays,
 *   then every `everyDays` days.
 * - weekly / monthly: the first `count` future occurrences of the grid.
 */
export function planSlots(p: {
  automation: AutomationConfig;
  timezone: string;
  now: Date;
  count: number;
  lastPublished?: Date | null;
}): Date[] {
  const count = Math.floor(p.count);
  const resolved = resolve(p.automation, p.timezone);
  const nowMs = p.now.getTime();
  if (!resolved || !Number.isFinite(nowMs) || !(count > 0)) return [];
  const { timeZone, hour, rule } = resolved;

  const lastMs = p.lastPublished ? p.lastPublished.getTime() : Number.NaN;
  const lastDayNumber = Number.isFinite(lastMs) ? dayNumber(ymdOf(lastMs, timeZone)) : null;

  const slots: Date[] = [];
  if (rule.kind === "interval") {
    let first = firstDayAfter(nowMs, hour, timeZone);
    if (Number.isFinite(lastMs)) {
      const fromLast = addDays(ymdOf(lastMs, timeZone), rule.everyDays);
      if (dayNumber(fromLast) > dayNumber(first)) first = fromLast;
    }
    for (let i = 0; i < count; i++) {
      slots.push(wallToUtc(addDays(first, i * rule.everyDays), hour, timeZone));
    }
    return slots;
  }

  let day = ymdOf(nowMs, timeZone);
  // A grid has at least one match per month: 32 days per requested slot is a safe ceiling.
  for (let i = 0; i < MAX_SCAN_DAYS + count * 32 && slots.length < count; i++, day = addDays(day, 1)) {
    const slot = wallToUtc(day, hour, timeZone);
    if (
      rule.matches(day) &&
      slot.getTime() > nowMs &&
      (lastDayNumber === null || dayNumber(day) > lastDayNumber)
    ) {
      slots.push(slot);
    }
  }
  return slots;
}
