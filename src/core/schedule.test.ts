import { describe, expect, it } from "vitest";
import { computeNextSlot, isValidTimeZone, planSlots } from "./schedule";
import type { AutomationConfig, ScheduleRule } from "./types";

const PARIS = "Europe/Paris";
const NEW_YORK = "America/New_York";

function config(rule: ScheduleRule, publishHour = 9, horizonDays = 14): AutomationConfig {
  return { enabled: true, publishHour, rule, horizonDays };
}

const every = (everyDays: number): ScheduleRule => ({ kind: "interval", everyDays });

function local(date: Date | null, timeZone: string): string {
  if (!date) return "null";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

function next(
  rule: ScheduleRule,
  p: { timezone?: string; lastSlot?: string | null; now: string; publishHour?: number; horizonDays?: number },
): Date | null {
  return computeNextSlot({
    automation: config(rule, p.publishHour ?? 9, p.horizonDays ?? 14),
    timezone: p.timezone ?? PARIS,
    lastSlot: p.lastSlot ? new Date(p.lastSlot) : null,
    now: new Date(p.now),
  });
}

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects garbage", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("   ")).toBe(false);
  });
});

describe("computeNextSlot: interval", () => {
  it("without history, picks today when the publish hour has not passed yet", () => {
    // 06:00 in Paris (winter, UTC+1) -> today 09:00 Paris = 08:00Z
    const slot = next(every(3), { now: "2026-01-15T05:00:00Z" });
    expect(iso(slot)).toBe("2026-01-15T08:00:00.000Z");
  });

  it("without history, picks tomorrow once the publish hour has passed", () => {
    const slot = next(every(3), { now: "2026-01-15T10:00:00Z" });
    expect(iso(slot)).toBe("2026-01-16T08:00:00.000Z");
  });

  it("is strictly after now: a slot equal to now is skipped", () => {
    const slot = next(every(3), { now: "2026-01-15T08:00:00Z" });
    expect(iso(slot)).toBe("2026-01-16T08:00:00.000Z");
  });

  it("adds everyDays calendar days to the last slot", () => {
    const slot = next(every(3), { lastSlot: "2026-01-10T08:00:00Z", now: "2026-01-11T12:00:00Z" });
    expect(iso(slot)).toBe("2026-01-13T08:00:00.000Z");
  });

  it("works from the local day of the last slot, not the UTC day", () => {
    // 00:30 Paris on Jan 11 is still Jan 10 in UTC.
    const slot = next(every(1), {
      lastSlot: "2026-01-10T23:30:00Z",
      now: "2026-01-11T12:00:00Z",
      horizonDays: 14,
    });
    expect(local(slot, PARIS)).toBe("2026-01-12 09:00");
  });

  it("falls back to the next slot from now when the last slot is too old", () => {
    const slot = next(every(3), { lastSlot: "2025-12-01T08:00:00Z", now: "2026-01-15T05:00:00Z" });
    expect(iso(slot)).toBe("2026-01-15T08:00:00.000Z");
  });

  it("never returns a date in the past", () => {
    const now = new Date("2026-06-20T14:30:00Z");
    for (const lastSlot of ["2026-06-19T07:00:00Z", "2026-06-01T07:00:00Z", "2026-06-20T07:00:00Z", null]) {
      const slot = next(every(2), { lastSlot, now: now.toISOString() });
      expect(slot!.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("keeps the local hour across the Paris spring-forward change (2026-03-29)", () => {
    // Fri Mar 27 09:00 CET = 08:00Z; +3 days = Mon Mar 30 09:00 CEST = 07:00Z
    const slot = next(every(3), { lastSlot: "2026-03-27T08:00:00Z", now: "2026-03-28T10:00:00Z" });
    expect(iso(slot)).toBe("2026-03-30T07:00:00.000Z");
    expect(local(slot, PARIS)).toBe("2026-03-30 09:00");
  });

  it("keeps the local hour across the Paris fall-back change (2026-10-25)", () => {
    // Fri Oct 23 09:00 CEST = 07:00Z; +3 days = Mon Oct 26 09:00 CET = 08:00Z
    const slot = next(every(3), { lastSlot: "2026-10-23T07:00:00Z", now: "2026-10-24T10:00:00Z" });
    expect(iso(slot)).toBe("2026-10-26T08:00:00.000Z");
    expect(local(slot, PARIS)).toBe("2026-10-26 09:00");
  });

  it("keeps the local hour across the New York spring-forward change (2026-03-08)", () => {
    // Fri Mar 6 09:00 EST = 14:00Z; +3 days = Mon Mar 9 09:00 EDT = 13:00Z
    const slot = next(every(3), {
      timezone: NEW_YORK,
      lastSlot: "2026-03-06T14:00:00Z",
      now: "2026-03-07T12:00:00Z",
    });
    expect(iso(slot)).toBe("2026-03-09T13:00:00.000Z");
  });

  it("keeps the local hour across the New York fall-back change (2026-11-01)", () => {
    // Fri Oct 30 09:00 EDT = 13:00Z; +3 days = Mon Nov 2 09:00 EST = 14:00Z
    const slot = next(every(3), {
      timezone: NEW_YORK,
      lastSlot: "2026-10-30T13:00:00Z",
      now: "2026-10-31T12:00:00Z",
    });
    expect(iso(slot)).toBe("2026-11-02T14:00:00.000Z");
  });

  it("handles zones with half-hour offsets", () => {
    // 09:00 in Kolkata (UTC+5:30) = 03:30Z
    const slot = next(every(1), { timezone: "Asia/Kolkata", now: "2026-01-15T00:00:00Z" });
    expect(iso(slot)).toBe("2026-01-15T03:30:00.000Z");
  });

  it("moves a non-existent local time forward past the gap", () => {
    // 02:00 does not exist on 2026-03-29 in Paris: the clocks jump to 03:00.
    const slot = next(every(1), {
      publishHour: 2,
      lastSlot: "2026-03-28T01:00:00Z",
      now: "2026-03-28T12:00:00Z",
    });
    expect(local(slot, PARIS)).toBe("2026-03-29 03:00");
    expect(iso(slot)).toBe("2026-03-29T01:00:00.000Z");
  });

  it("uses the earlier instant when a local time happens twice", () => {
    // 02:00 happens twice on 2026-10-25 in Paris; the first one is 00:00Z.
    const slot = next(every(1), {
      publishHour: 2,
      lastSlot: "2026-10-24T00:00:00Z",
      now: "2026-10-24T12:00:00Z",
    });
    expect(iso(slot)).toBe("2026-10-25T00:00:00.000Z");
  });

  it("falls back to UTC for an unknown timezone instead of throwing", () => {
    const slot = next(every(1), { timezone: "Not/AZone", now: "2026-01-15T05:00:00Z" });
    expect(iso(slot)).toBe("2026-01-15T09:00:00.000Z");
  });

  it("treats a degenerate everyDays as 1 instead of looping or throwing", () => {
    const slot = next(every(0), { lastSlot: "2026-01-10T08:00:00Z", now: "2026-01-10T12:00:00Z" });
    expect(iso(slot)).toBe("2026-01-11T08:00:00.000Z");
  });
});

describe("computeNextSlot: horizon (stock full)", () => {
  it("returns null when the next slot is beyond now + horizonDays", () => {
    // last = now + 13 days; +3 days = 16 days > 14
    const slot = next(every(3), { lastSlot: "2026-01-14T08:00:00Z", now: "2026-01-01T12:00:00Z" });
    expect(slot).toBeNull();
  });

  it("accepts a slot exactly on the horizon limit", () => {
    // limit = Jan 1 09:00Z + 3 days = Jan 4 09:00Z, slot = Jan 1 + 3 days
    const slot = next(every(3), {
      timezone: "UTC",
      lastSlot: "2026-01-01T09:00:00Z",
      now: "2026-01-01T09:00:00Z",
      horizonDays: 3,
    });
    expect(iso(slot)).toBe("2026-01-04T09:00:00.000Z");
  });

  it("fills the horizon one slot at a time, then reports the stock as full", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const slots: string[] = [];
    let last: Date | null = null;
    for (let i = 0; i < 20; i++) {
      const slot = computeNextSlot({ automation: config(every(3)), timezone: "UTC", lastSlot: last, now });
      if (!slot) break;
      slots.push(slot.toISOString());
      last = slot;
    }
    expect(slots).toEqual([
      "2026-01-02T09:00:00.000Z",
      "2026-01-05T09:00:00.000Z",
      "2026-01-08T09:00:00.000Z",
      "2026-01-11T09:00:00.000Z",
      "2026-01-14T09:00:00.000Z",
    ]);
  });

  it("returns null with a zero-day horizon", () => {
    expect(next(every(1), { now: "2026-01-15T05:00:00Z", horizonDays: 0 })).toBeNull();
  });
});

describe("computeNextSlot: weekly", () => {
  const monThu: ScheduleRule = { kind: "weekly", weekdays: [1, 4] };

  it("picks the next matching weekday", () => {
    // Wed 2026-01-14 -> Thu 2026-01-15 09:00 Paris = 08:00Z
    expect(iso(next(monThu, { now: "2026-01-14T12:00:00Z" }))).toBe("2026-01-15T08:00:00.000Z");
  });

  it("picks today when it matches and the hour has not passed", () => {
    // Thu 2026-01-15 05:00Z = 06:00 Paris
    expect(iso(next(monThu, { now: "2026-01-15T05:00:00Z" }))).toBe("2026-01-15T08:00:00.000Z");
  });

  it("skips today when the hour has passed", () => {
    // Thu 10:00Z -> next is Mon 2026-01-19
    expect(iso(next(monThu, { now: "2026-01-15T10:00:00Z" }))).toBe("2026-01-19T08:00:00.000Z");
  });

  it("never schedules two posts on the same local day", () => {
    // Monday 06:00 Paris, with a post already at 09:00 that Monday -> Thursday.
    const slot = next(monThu, { lastSlot: "2026-01-19T08:00:00Z", now: "2026-01-19T05:00:00Z" });
    expect(iso(slot)).toBe("2026-01-22T08:00:00.000Z");
  });

  it("uses the local weekday, not the UTC one (midnight slots)", () => {
    // Monday 00:00 Paris is still Sunday 23:00Z.
    const slot = next({ kind: "weekly", weekdays: [1] }, { now: "2026-01-17T12:00:00Z", publishHour: 0 });
    expect(iso(slot)).toBe("2026-01-18T23:00:00.000Z");
    expect(local(slot, PARIS)).toBe("2026-01-19 00:00");
  });

  it("treats 7 as Sunday and stays at the local hour across DST", () => {
    // Sunday 2026-03-29 is the spring-forward day: 09:00 CEST = 07:00Z
    const slot = next({ kind: "weekly", weekdays: [7] }, { now: "2026-03-25T12:00:00Z" });
    expect(iso(slot)).toBe("2026-03-29T07:00:00.000Z");
  });

  it("is time-zone aware for the weekday near midnight UTC", () => {
    // 20:00 Monday in New York is already Tuesday in UTC. Tuesday-only rule, hour 9.
    const slot = next(
      { kind: "weekly", weekdays: [2] },
      { timezone: NEW_YORK, now: "2026-01-12T01:00:00Z" /* Sun 20:00 NY */ },
    );
    expect(local(slot, NEW_YORK)).toBe("2026-01-13 09:00");
  });

  it("returns null for a weekly rule without valid weekdays", () => {
    expect(next({ kind: "weekly", weekdays: [] }, { now: "2026-01-15T05:00:00Z" })).toBeNull();
    expect(next({ kind: "weekly", weekdays: [0, 8] }, { now: "2026-01-15T05:00:00Z" })).toBeNull();
  });

  it("returns null when the matching day is beyond a short horizon", () => {
    // Saturday-only rule, now = Sunday, horizon 3 days.
    const slot = next({ kind: "weekly", weekdays: [6] }, { now: "2026-01-11T12:00:00Z", horizonDays: 3 });
    expect(slot).toBeNull();
  });
});

describe("computeNextSlot: monthly", () => {
  const day15: ScheduleRule = { kind: "monthly", dayOfMonth: 15 };

  it("picks the day of the current month when it is ahead", () => {
    expect(iso(next(day15, { now: "2026-01-10T12:00:00Z" }))).toBe("2026-01-15T08:00:00.000Z");
  });

  it("is null most of the time: next month is beyond a 14-day horizon", () => {
    expect(next(day15, { now: "2026-01-16T12:00:00Z" })).toBeNull();
  });

  it("finds next month's slot when the horizon is long enough", () => {
    expect(iso(next(day15, { now: "2026-01-16T12:00:00Z", horizonDays: 30 }))).toBe("2026-02-15T08:00:00.000Z");
  });

  it("does not repeat the month of the last slot", () => {
    const slot = next(day15, {
      lastSlot: "2026-01-15T08:00:00Z",
      now: "2026-01-15T10:00:00Z",
      horizonDays: 31,
    });
    expect(iso(slot)).toBe("2026-02-15T08:00:00.000Z");
  });

  it("supports the 28th in a non-leap February", () => {
    const slot = next({ kind: "monthly", dayOfMonth: 28 }, { now: "2026-02-10T12:00:00Z", horizonDays: 30 });
    expect(iso(slot)).toBe("2026-02-28T08:00:00.000Z");
  });

  it("supports the 1st across a year boundary", () => {
    const slot = next({ kind: "monthly", dayOfMonth: 1 }, { now: "2026-12-20T12:00:00Z", horizonDays: 30 });
    expect(iso(slot)).toBe("2027-01-01T08:00:00.000Z");
  });

  it("handles a monthly slot that lands on a DST change month", () => {
    // 2026-03-29 DST; the 30th would not be allowed (max 28), so use the 28th: still CET.
    const march = next({ kind: "monthly", dayOfMonth: 28 }, { now: "2026-03-20T12:00:00Z" });
    expect(iso(march)).toBe("2026-03-28T08:00:00.000Z");
    // The 5th of April is in CEST (UTC+2).
    const april = next({ kind: "monthly", dayOfMonth: 5 }, { now: "2026-03-31T12:00:00Z", horizonDays: 30 });
    expect(iso(april)).toBe("2026-04-05T07:00:00.000Z");
  });

  it("clamps an out-of-range day of month into 1-28", () => {
    const slot = next({ kind: "monthly", dayOfMonth: 31 }, { now: "2026-01-10T12:00:00Z", horizonDays: 30 });
    expect(local(slot, PARIS)).toBe("2026-01-28 09:00");
  });
});

describe("planSlots", () => {
  const now = new Date("2026-01-15T05:00:00Z"); // 06:00 Paris

  it("interval: keeps the rhythm from the last live post when only the hour changes", () => {
    // Every 7 days, last live Fri Oct 2 09:00. On Oct 3 the hour moves to 10:00:
    // the next post must stay a week after Oct 2, not jump to tomorrow.
    const slots = planSlots({
      automation: config(every(7), 10),
      timezone: PARIS,
      now: new Date("2026-10-03T08:00:00Z"),
      count: 2,
      lastPublished: new Date("2026-10-02T07:00:00Z"),
    });
    expect(slots.map((s) => local(s, PARIS))).toEqual(["2026-10-09 10:00", "2026-10-16 10:00"]);
  });

  it("interval: ignores a last live post older than one period", () => {
    const slots = planSlots({
      automation: config(every(3)),
      timezone: PARIS,
      now,
      count: 1,
      lastPublished: new Date("2026-01-01T08:00:00Z"),
    });
    expect(slots.map((s) => local(s, PARIS))).toEqual(["2026-01-15 09:00"]);
  });

  it("weekly: never schedules on the local day of the last live post", () => {
    // Thu Jan 15: a post went live at 09:00, the hour moves to 18:00.
    const slots = planSlots({
      automation: config({ kind: "weekly", weekdays: [4, 5] }, 18),
      timezone: PARIS,
      now: new Date("2026-01-15T10:00:00Z"),
      count: 2,
      lastPublished: new Date("2026-01-15T08:00:00Z"),
    });
    expect(slots.map((s) => local(s, PARIS))).toEqual(["2026-01-16 18:00", "2026-01-22 18:00"]);
  });

  it("interval: starts at the next slot from now, then every N days", () => {
    const slots = planSlots({ automation: config(every(3)), timezone: PARIS, now, count: 3 });
    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-01-15T08:00:00.000Z",
      "2026-01-18T08:00:00.000Z",
      "2026-01-21T08:00:00.000Z",
    ]);
  });

  it("interval: starts tomorrow when today's slot has passed", () => {
    const late = new Date("2026-01-15T10:00:00Z");
    const slots = planSlots({ automation: config(every(2)), timezone: PARIS, now: late, count: 2 });
    expect(slots.map((s) => local(s, PARIS))).toEqual(["2026-01-16 09:00", "2026-01-18 09:00"]);
  });

  it("weekly: the first N occurrences of the grid", () => {
    const slots = planSlots({
      automation: config({ kind: "weekly", weekdays: [2, 5] }),
      timezone: PARIS,
      now,
      count: 4,
    });
    // Thu Jan 15 -> Fri 16, Tue 20, Fri 23, Tue 27
    expect(slots.map((s) => local(s, PARIS))).toEqual([
      "2026-01-16 09:00",
      "2026-01-20 09:00",
      "2026-01-23 09:00",
      "2026-01-27 09:00",
    ]);
  });

  it("monthly: consecutive months, across a year boundary, ignoring the horizon", () => {
    const slots = planSlots({
      automation: config({ kind: "monthly", dayOfMonth: 5 }, 9, 1),
      timezone: PARIS,
      now: new Date("2026-11-20T12:00:00Z"),
      count: 3,
    });
    expect(slots.map((s) => local(s, PARIS))).toEqual(["2026-12-05 09:00", "2027-01-05 09:00", "2027-02-05 09:00"]);
  });

  it("returns an empty list for count <= 0 or an unusable rule", () => {
    expect(planSlots({ automation: config(every(2)), timezone: PARIS, now, count: 0 })).toEqual([]);
    expect(planSlots({ automation: config(every(2)), timezone: PARIS, now, count: -3 })).toEqual([]);
    expect(
      planSlots({ automation: config({ kind: "weekly", weekdays: [] }), timezone: PARIS, now, count: 2 }),
    ).toEqual([]);
  });

  it("returns strictly increasing slots, all after now", () => {
    const rules: ScheduleRule[] = [every(1), every(5), { kind: "weekly", weekdays: [1, 3, 5] }, { kind: "monthly", dayOfMonth: 10 }];
    for (const rule of rules) {
      const slots = planSlots({ automation: config(rule), timezone: PARIS, now, count: 8 });
      expect(slots).toHaveLength(8);
      slots.forEach((slot, i) => {
        expect(slot.getTime()).toBeGreaterThan(i === 0 ? now.getTime() : slots[i - 1].getTime());
      });
    }
  });

  it.each([PARIS, NEW_YORK, "Asia/Kolkata", "Australia/Sydney", "UTC"])(
    "keeps the local publish hour on every day of a full year in %s",
    (timezone) => {
      const slots = planSlots({
        automation: config(every(1), 9),
        timezone,
        now: new Date("2026-01-01T00:00:00Z"),
        count: 400,
      });
      slots.forEach((slot, i) => {
        expect(local(slot, timezone).slice(11)).toBe("09:00");
        if (i > 0) {
          // Consecutive local calendar days.
          const prev = new Date(`${local(slots[i - 1], timezone).slice(0, 10)}T00:00:00Z`).getTime();
          const cur = new Date(`${local(slot, timezone).slice(0, 10)}T00:00:00Z`).getTime();
          expect(cur - prev).toBe(24 * 60 * 60 * 1000);
        }
      });
    },
  );

  it("agrees with computeNextSlot for the first slot", () => {
    const rules: ScheduleRule[] = [every(3), { kind: "weekly", weekdays: [1, 4] }];
    for (const rule of rules) {
      const [first] = planSlots({ automation: config(rule), timezone: PARIS, now, count: 1 });
      const slot = computeNextSlot({ automation: config(rule), timezone: PARIS, lastSlot: null, now });
      expect(first.toISOString()).toBe(slot!.toISOString());
    }
  });
});
