// Timezone helpers for the admin UI. Everything is built on Intl, so it is
// DST-safe and needs no dependency. The blog's timezone (an IANA name such as
// "Europe/Paris") is independent of the browser's timezone.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock reading of an instant in the given timezone. */
export function getWallTime(instant: number | Date, timeZone: string): WallTime {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** Offset of the timezone from UTC at the given instant, in milliseconds. */
function offsetMs(instant: number, timeZone: string): number {
  const w = getWallTime(instant, timeZone);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's own timezone, used only as a fallback. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * All IANA timezones the runtime knows, sorted, always including "UTC" and
 * the extra names passed in (so a saved value is never missing from a list).
 */
export function listTimeZones(extra: string[] = []): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  return Array.from(new Set([...zones, "UTC", ...extra.filter(isValidTimeZone)])).sort();
}

const pad = (n: number, length = 2) => String(n).padStart(length, "0");

/**
 * Formats an ISO date in an IANA timezone for display. Returns "" for an
 * invalid date. `options` must not set `timeZone`.
 */
export function formatInZone(
  iso: string | null | undefined,
  timeZone: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(ms);
}

/**
 * Converts an ISO instant to the value of a `<input type="datetime-local">`
 * ("YYYY-MM-DDTHH:mm") as read on a wall clock in `timeZone`.
 * Returns "" for null or an invalid date.
 */
export function isoToZonedInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const w = getWallTime(ms, timeZone);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

const INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Converts a `datetime-local` value, read as a wall clock in `timeZone`, to an
 * ISO instant (UTC). Returns null for an empty or malformed value.
 *
 * DST edge cases follow the usual "compatible" rule:
 * - a wall time that happens twice (clocks go back) resolves to the first one;
 * - a wall time that never happens (clocks go forward) resolves to the same
 *   offset applied before the jump, i.e. it moves forward by the gap.
 */
export function zonedInputToIso(value: string, timeZone: string): string | null {
  const m = INPUT_RE.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number);
  const second = m[6] ? Number(m[6]) : 0;

  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null; // e.g. month 13, February 30th, 25:00
  }

  // The offset can only change at a transition; sampling a day on each side
  // gives every offset that may apply to this wall time.
  const before = offsetMs(wall - DAY_MS, timeZone);
  const after = offsetMs(wall + DAY_MS, timeZone);
  const candidates = Array.from(new Set([wall - before, wall - after])).filter(
    (instant) => offsetMs(instant, timeZone) === wall - instant,
  );

  const instant = candidates.length > 0 ? Math.min(...candidates) : wall - before;
  return new Date(instant).toISOString();
}

export type PostState = "draft" | "scheduled" | "live";

/** draft = no date, scheduled = in the future, live = in the past. */
export function getPostState(publishedAt: string | null | undefined, now: number = Date.now()): PostState {
  if (!publishedAt) return "draft";
  const ms = Date.parse(publishedAt);
  if (Number.isNaN(ms)) return "draft";
  return ms > now ? "scheduled" : "live";
}
