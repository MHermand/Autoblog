// Pure decision logic of the automation and generation pipeline. No I/O:
// dependencies are injected, so it is unit-tested with fakes. Wired to the
// real database and LLMs in generation.ts.

import { computeNextSlot } from "@/core/schedule";
import { pickFreshTopic, TOPIC_WINDOW_DAYS } from "@/core/topics";
import type { BlogSettings, RecentPost, ScheduleRule } from "@/core/types";
import { SlotTakenError } from "./errors";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Documented limit: at most 2 articles per tick. */
export const MAX_ARTICLES_PER_TICK = 2;

/**
 * The tick route has maxDuration = 300 s and one article takes 1-2 minutes.
 * A second article is only started while there is time left to finish it.
 */
export const SECOND_ARTICLE_DEADLINE_MS = 150_000;

/** Start of the window of recent posts used for topic de-duplication. */
export function topicWindowStart(now: Date): Date {
  return new Date(now.getTime() - TOPIC_WINDOW_DAYS * DAY_MS);
}

/** Topic string handed to the article prompt. */
export function formatTopic(topic: { title: string; angle: string }): string {
  const angle = topic.angle.trim();
  return angle ? `${topic.title.trim()} — ${angle}` : topic.title.trim();
}

// ---- Automation tick -------------------------------------------------------

export type TickReason =
  | "disabled"
  | "stock_full"
  | "no_fresh_topic"
  | "slot_taken"
  | "time_budget"
  | "generation_failed";

export interface TickOutcome {
  generated: number;
  reason?: TickReason;
  /** Set with reason "generation_failed". */
  error?: unknown;
}

export interface TickDeps {
  getSettings(): Promise<BlogSettings>;
  /** Latest published_at among auto posts up to horizonEnd, future ones included. */
  getLastAutoSlot(horizonEnd: Date): Promise<Date | null>;
  getRecentPosts(since: Date): Promise<RecentPost[]>;
  /** Topic candidates suggested by the LLM. */
  suggestTopics(settings: BlogSettings, recent: RecentPost[], now: Date): Promise<{ title: string; angle: string }[]>;
  /** Generates and inserts one auto post. Throws SlotTakenError if the slot got filled meanwhile. */
  generate(p: { topic: string; publishedAt: Date }): Promise<void>;
  /** Milliseconds since the tick started. */
  elapsedMs(): number;
}

/**
 * Fills the next empty publication slots, at most MAX_ARTICLES_PER_TICK.
 * Stops at the first slot it cannot fill and says why.
 */
export async function runTick(deps: TickDeps, now: Date): Promise<TickOutcome> {
  const settings = await deps.getSettings();
  if (!settings.automation.enabled) return { generated: 0, reason: "disabled" };

  let generated = 0;
  for (let i = 0; i < MAX_ARTICLES_PER_TICK; i++) {
    if (i > 0 && deps.elapsedMs() > SECOND_ARTICLE_DEADLINE_MS) return { generated, reason: "time_budget" };
    try {
      const lastSlot = await deps.getLastAutoSlot(horizonEnd(settings, now));
      const slot = computeNextSlot({
        automation: settings.automation,
        timezone: settings.timezone,
        lastSlot,
        now,
      });
      if (!slot) return { generated, reason: "stock_full" };

      const recent = await deps.getRecentPosts(topicWindowStart(now));
      const candidates = await deps.suggestTopics(settings, recent, now);
      const topic = pickFreshTopic(candidates, recent, now);
      if (!topic) return { generated, reason: "no_fresh_topic" };

      await deps.generate({ topic: formatTopic(topic), publishedAt: slot });
      generated++;
    } catch (error) {
      if (error instanceof SlotTakenError) return { generated, reason: "slot_taken" };
      return { generated, reason: "generation_failed", error };
    }
  }
  return { generated };
}

/** End of the window the automation keeps filled. */
export function horizonEnd(settings: BlogSettings, now: Date): Date {
  return new Date(now.getTime() + settings.automation.horizonDays * 24 * 60 * 60 * 1000);
}

// ---- Re-spacing ------------------------------------------------------------

function sameRule(a: ScheduleRule, b: ScheduleRule): boolean {
  switch (a.kind) {
    case "interval":
      return b.kind === "interval" && a.everyDays === b.everyDays;
    case "monthly":
      return b.kind === "monthly" && a.dayOfMonth === b.dayOfMonth;
    case "weekly": {
      if (b.kind !== "weekly") return false;
      const left = [...new Set(a.weekdays)].sort((x, y) => x - y).join(",");
      const right = [...new Set(b.weekdays)].sort((x, y) => x - y).join(",");
      return left === right;
    }
  }
}

/** true when upcoming auto posts must be re-spaced (publish hour, rule or timezone changed). */
export function scheduleChanged(previous: BlogSettings, next: BlogSettings): boolean {
  return (
    previous.timezone !== next.timezone ||
    previous.automation.publishHour !== next.automation.publishHour ||
    !sameRule(previous.automation.rule, next.automation.rule)
  );
}

/**
 * Assigns `slots[i]` to the i-th upcoming post (both soonest first) and returns
 * only the posts whose date actually changes. Posts without a slot keep theirs.
 */
export function planRespacing(
  upcoming: { id: string; publishedAt: string }[],
  slots: Date[],
): { id: string; publishedAt: Date }[] {
  const changes: { id: string; publishedAt: Date }[] = [];
  upcoming.forEach((post, i) => {
    const slot = slots[i];
    if (slot && slot.getTime() !== Date.parse(post.publishedAt)) changes.push({ id: post.id, publishedAt: slot });
  });
  return changes;
}

// ---- Title fix -------------------------------------------------------------

/**
 * The title-fix prompt asks for the title alone on one line; models still add
 * quotes, a "Title:" label or Markdown now and then.
 */
export function cleanTitleReply(raw: string): string {
  const line =
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "";
  return line
    .replace(/^#+\s*/, "")
    .replace(/^(?:\*\*)?title(?:\*\*)?\s*:\s*/i, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^["'“”«»‘’„]+|["'“”«»‘’„]+$/g, "")
    .trim();
}
