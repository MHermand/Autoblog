import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/core/settings";
import type { BlogSettings } from "@/core/types";
import { SlotTakenError } from "./errors";
import {
  cleanTitleReply,
  formatTopic,
  planRespacing,
  runTick,
  scheduleChanged,
  SECOND_ARTICLE_DEADLINE_MS,
  type TickDeps,
} from "./pipeline";

// The schedule math has its own tests; here the next slot is scripted.
vi.mock("@/core/schedule", () => ({ computeNextSlot: vi.fn() }));
const { computeNextSlot } = await import("@/core/schedule");
const nextSlot = vi.mocked(computeNextSlot);

const NOW = new Date("2026-10-03T06:00:00Z");
const SLOT_1 = new Date("2026-10-04T07:00:00Z");
const SLOT_2 = new Date("2026-10-07T07:00:00Z");

function settings(enabled: boolean): BlogSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), automation: { ...DEFAULT_SETTINGS.automation, enabled } };
}

/** In-memory fake: auto posts are just their publication dates. */
function fakeDeps(overrides: Partial<TickDeps> = {}) {
  const autoSlots: Date[] = [];
  const generate = vi.fn(async ({ publishedAt }: { topic: string; publishedAt: Date }) => {
    autoSlots.push(publishedAt);
  });
  const deps: TickDeps = {
    getSettings: async () => settings(true),
    getLastAutoSlot: async () =>
      autoSlots.length ? new Date(Math.max(...autoSlots.map((d) => d.getTime()))) : null,
    getRecentPosts: async () => [],
    suggestTopics: async () => [
      { title: "How to write better titles", angle: "A practical checklist" },
      { title: "Another idea", angle: "" },
    ],
    generate,
    elapsedMs: () => 0,
    ...overrides,
  };
  return { deps, generate, autoSlots };
}

beforeEach(() => {
  nextSlot.mockReset();
});

describe("runTick", () => {
  it("asks for the last slot within the horizon only", async () => {
    nextSlot.mockReturnValue(null);
    const getLastAutoSlot = vi.fn(async () => null);
    const { deps } = fakeDeps({ getLastAutoSlot });
    await runTick(deps, NOW);
    const horizonDays = DEFAULT_SETTINGS.automation.horizonDays;
    expect(getLastAutoSlot).toHaveBeenCalledWith(new Date(NOW.getTime() + horizonDays * 24 * 60 * 60 * 1000));
  });

  it("does nothing when automation is disabled", async () => {
    const { deps, generate } = fakeDeps({ getSettings: async () => settings(false) });
    expect(await runTick(deps, NOW)).toEqual({ generated: 0, reason: "disabled" });
    expect(generate).not.toHaveBeenCalled();
    expect(nextSlot).not.toHaveBeenCalled();
  });

  it("fills at most two slots per call, each after the previous one", async () => {
    nextSlot.mockImplementation(({ lastSlot }) => (lastSlot === null ? SLOT_1 : SLOT_2));
    const { deps, generate, autoSlots } = fakeDeps();

    expect(await runTick(deps, NOW)).toEqual({ generated: 2 });
    expect(autoSlots).toEqual([SLOT_1, SLOT_2]);
    expect(nextSlot).toHaveBeenNthCalledWith(2, expect.objectContaining({ lastSlot: SLOT_1, now: NOW }));
    expect(generate).toHaveBeenCalledWith({
      topic: "How to write better titles — A practical checklist",
      publishedAt: SLOT_1,
    });
  });

  it("stops with stock_full when no slot is left within the horizon", async () => {
    nextSlot.mockReturnValueOnce(SLOT_1).mockReturnValueOnce(null);
    const { deps } = fakeDeps();
    expect(await runTick(deps, NOW)).toEqual({ generated: 1, reason: "stock_full" });
  });

  it("stops with no_fresh_topic when every candidate overlaps (or none came back)", async () => {
    nextSlot.mockReturnValue(SLOT_1);
    const { deps, generate } = fakeDeps({ suggestTopics: async () => [] });
    expect(await runTick(deps, NOW)).toEqual({ generated: 0, reason: "no_fresh_topic" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("skips topics that overlap recent posts", async () => {
    nextSlot.mockReturnValueOnce(SLOT_1).mockReturnValueOnce(null);
    const recentTitle = "How to write better titles";
    const { deps, generate } = fakeDeps({
      getRecentPosts: async () => [{ title: recentTitle, tags: [], publishedAt: "2026-10-01T07:00:00.000Z" }],
    });
    await runTick(deps, NOW);
    expect(generate).toHaveBeenCalledWith({ topic: "Another idea", publishedAt: SLOT_1 });
  });

  it("reports slot_taken when a concurrent run filled the slot", async () => {
    nextSlot.mockReturnValue(SLOT_1);
    const { deps } = fakeDeps({
      generate: async ({ publishedAt }) => {
        throw new SlotTakenError(publishedAt);
      },
    });
    expect(await runTick(deps, NOW)).toEqual({ generated: 0, reason: "slot_taken" });
  });

  it("returns the error with what was generated before it", async () => {
    nextSlot.mockImplementation(({ lastSlot }) => (lastSlot === null ? SLOT_1 : SLOT_2));
    const failure = new Error("provider down");
    const { deps, autoSlots } = fakeDeps();
    const realGenerate = deps.generate;
    let calls = 0;
    deps.generate = async (p) => {
      calls++;
      if (calls === 2) throw failure;
      await realGenerate(p);
    };
    expect(await runTick(deps, NOW)).toEqual({ generated: 1, reason: "generation_failed", error: failure });
    expect(autoSlots).toEqual([SLOT_1]);
  });

  it("does not start a second article when the time budget is spent", async () => {
    nextSlot.mockImplementation(({ lastSlot }) => (lastSlot === null ? SLOT_1 : SLOT_2));
    const { deps, generate } = fakeDeps({ elapsedMs: () => SECOND_ARTICLE_DEADLINE_MS + 1 });
    expect(await runTick(deps, NOW)).toEqual({ generated: 1, reason: "time_budget" });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleChanged", () => {
  const base = settings(true);

  it("detects publish hour, timezone and rule changes", () => {
    expect(scheduleChanged(base, structuredClone(base))).toBe(false);
    expect(scheduleChanged(base, { ...base, timezone: "Europe/Paris" })).toBe(true);
    expect(scheduleChanged(base, { ...base, automation: { ...base.automation, publishHour: 10 } })).toBe(true);
    expect(
      scheduleChanged(base, { ...base, automation: { ...base.automation, rule: { kind: "interval", everyDays: 5 } } }),
    ).toBe(true);
  });

  it("ignores changes that do not move slots, and weekday order", () => {
    expect(scheduleChanged(base, { ...base, automation: { ...base.automation, horizonDays: 30, enabled: false } })).toBe(
      false,
    );
    const weekly = { ...base, automation: { ...base.automation, rule: { kind: "weekly" as const, weekdays: [1, 3] } } };
    const reordered = { ...base, automation: { ...base.automation, rule: { kind: "weekly" as const, weekdays: [3, 1] } } };
    expect(scheduleChanged(weekly, reordered)).toBe(false);
  });
});

describe("planRespacing", () => {
  it("assigns slots in order and returns only the posts that move", () => {
    const upcoming = [
      { id: "a", publishedAt: "2026-10-04T07:00:00.000Z" },
      { id: "b", publishedAt: "2026-10-06T07:00:00.000Z" },
      { id: "c", publishedAt: "2026-10-08T07:00:00.000Z" },
    ];
    const slots = [new Date("2026-10-04T07:00:00Z"), new Date("2026-10-05T07:00:00Z")];
    expect(planRespacing(upcoming, slots)).toEqual([{ id: "b", publishedAt: slots[1] }]);
  });
});

describe("text helpers", () => {
  it("cleanTitleReply strips quotes, labels and Markdown", () => {
    expect(cleanTitleReply('"Seven ways to plan a garden"')).toBe("Seven ways to plan a garden");
    expect(cleanTitleReply("Title: **Plan a garden**\nBecause...")).toBe("Plan a garden");
    expect(cleanTitleReply("\n\n« Planifier son jardin »")).toBe("Planifier son jardin");
    expect(cleanTitleReply("## A heading")).toBe("A heading");
  });

  it("formatTopic adds the angle when present", () => {
    expect(formatTopic({ title: "Topic", angle: " Angle " })).toBe("Topic — Angle");
    expect(formatTopic({ title: "Topic", angle: "" })).toBe("Topic");
  });
});
