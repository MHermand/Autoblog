import { describe, expect, it } from "vitest";
import {
  formatInZone,
  getPostState,
  isoToZonedInput,
  isValidTimeZone,
  listTimeZones,
  zonedInputToIso,
} from "./datetime";

describe("isoToZonedInput", () => {
  it("reads an instant on the wall clock of the given zone", () => {
    // Paris is UTC+2 in summer, UTC+1 in winter.
    expect(isoToZonedInput("2026-07-01T10:30:00.000Z", "Europe/Paris")).toBe("2026-07-01T12:30");
    expect(isoToZonedInput("2026-01-15T10:30:00.000Z", "Europe/Paris")).toBe("2026-01-15T11:30");
  });

  it("can land on a different calendar day than UTC", () => {
    expect(isoToZonedInput("2026-06-01T22:30:00Z", "Europe/Paris")).toBe("2026-06-02T00:30");
    expect(isoToZonedInput("2026-06-01T02:30:00Z", "America/New_York")).toBe("2026-05-31T22:30");
  });

  it("handles half-hour and unusual offsets", () => {
    expect(isoToZonedInput("2026-03-10T00:00:00Z", "Asia/Kolkata")).toBe("2026-03-10T05:30");
    expect(isoToZonedInput("2026-03-10T00:00:00Z", "Asia/Kathmandu")).toBe("2026-03-10T05:45");
  });

  it("renders midnight as 00:xx, never 24:xx", () => {
    expect(isoToZonedInput("2026-06-01T22:00:00Z", "Europe/Paris")).toBe("2026-06-02T00:00");
  });

  it("returns an empty string for null, empty or invalid input", () => {
    expect(isoToZonedInput(null, "UTC")).toBe("");
    expect(isoToZonedInput("", "UTC")).toBe("");
    expect(isoToZonedInput("not a date", "UTC")).toBe("");
  });
});

describe("zonedInputToIso", () => {
  it("interprets the value in the given zone", () => {
    expect(zonedInputToIso("2026-07-01T12:30", "Europe/Paris")).toBe("2026-07-01T10:30:00.000Z");
    expect(zonedInputToIso("2026-01-15T11:30", "Europe/Paris")).toBe("2026-01-15T10:30:00.000Z");
    expect(zonedInputToIso("2026-07-01T09:00", "America/New_York")).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedInputToIso("2026-03-10T05:30", "Asia/Kolkata")).toBe("2026-03-10T00:00:00.000Z");
  });

  it("is the identity in UTC", () => {
    expect(zonedInputToIso("2026-02-03T04:05", "UTC")).toBe("2026-02-03T04:05:00.000Z");
  });

  it("accepts seconds", () => {
    expect(zonedInputToIso("2026-02-03T04:05:06", "UTC")).toBe("2026-02-03T04:05:06.000Z");
  });

  it("picks the first occurrence of a repeated wall time (clocks go back)", () => {
    // Europe/Paris: 2026-10-25 03:00 CEST -> 02:00 CET, so 02:30 happens twice.
    // First occurrence is CEST (UTC+2) = 00:30Z.
    expect(zonedInputToIso("2026-10-25T02:30", "Europe/Paris")).toBe("2026-10-25T00:30:00.000Z");
    // US: 2026-11-01 02:00 EDT -> 01:00 EST, so 01:30 happens twice.
    expect(zonedInputToIso("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });

  it("moves a skipped wall time forward by the gap (clocks go forward)", () => {
    // Europe/Paris: 2026-03-29 02:00 CET -> 03:00 CEST, so 02:30 never exists.
    // It resolves to 03:30 CEST = 01:30Z.
    expect(zonedInputToIso("2026-03-29T02:30", "Europe/Paris")).toBe("2026-03-29T01:30:00.000Z");
    // US: 2026-03-08 02:00 EST -> 03:00 EDT.
    expect(zonedInputToIso("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
  });

  it("is unambiguous right around a transition", () => {
    expect(zonedInputToIso("2026-03-29T01:59", "Europe/Paris")).toBe("2026-03-29T00:59:00.000Z");
    expect(zonedInputToIso("2026-03-29T03:00", "Europe/Paris")).toBe("2026-03-29T01:00:00.000Z");
    expect(zonedInputToIso("2026-10-25T03:00", "Europe/Paris")).toBe("2026-10-25T02:00:00.000Z");
  });

  it("handles southern-hemisphere DST", () => {
    // Pacific/Auckland is UTC+13 in January, UTC+12 in July.
    expect(zonedInputToIso("2026-01-15T12:00", "Pacific/Auckland")).toBe("2026-01-14T23:00:00.000Z");
    expect(zonedInputToIso("2026-07-15T12:00", "Pacific/Auckland")).toBe("2026-07-15T00:00:00.000Z");
  });

  it("rejects empty, malformed and impossible values", () => {
    expect(zonedInputToIso("", "UTC")).toBeNull();
    expect(zonedInputToIso("2026-07-01", "UTC")).toBeNull();
    expect(zonedInputToIso("2026-13-01T10:00", "UTC")).toBeNull();
    expect(zonedInputToIso("2026-02-30T10:00", "UTC")).toBeNull();
    expect(zonedInputToIso("2026-02-03T25:00", "UTC")).toBeNull();
  });
});

describe("round trip", () => {
  const zones = ["UTC", "Europe/Paris", "America/New_York", "Asia/Kolkata", "Pacific/Auckland", "America/Sao_Paulo"];
  const inputs = ["2026-01-15T08:00", "2026-03-28T23:59", "2026-06-30T00:00", "2026-10-24T12:15", "2026-12-31T23:30"];

  it("input -> ISO -> input is stable for times that exist", () => {
    for (const zone of zones) {
      for (const input of inputs) {
        const iso = zonedInputToIso(input, zone);
        expect(iso, `${zone} ${input}`).not.toBeNull();
        expect(isoToZonedInput(iso, zone), `${zone} ${input}`).toBe(input);
      }
    }
  });

  it("ISO -> input -> ISO keeps the minute (seconds are dropped)", () => {
    const iso = "2026-05-05T08:07:00.000Z";
    for (const zone of zones) {
      expect(zonedInputToIso(isoToZonedInput(iso, zone), zone)).toBe(iso);
    }
  });
});

describe("formatInZone", () => {
  it("formats in the requested zone, not the runtime's", () => {
    const iso = "2026-06-01T22:30:00Z";
    const opts = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
    expect(formatInZone(iso, "Europe/Paris", "en-GB", opts)).toBe("02/06/2026, 00:30");
    expect(formatInZone(iso, "America/New_York", "en-GB", opts)).toBe("01/06/2026, 18:30");
  });

  it("returns an empty string for missing or invalid dates", () => {
    expect(formatInZone(null, "UTC", "en")).toBe("");
    expect(formatInZone("nope", "UTC", "en")).toBe("");
  });
});

describe("isValidTimeZone / listTimeZones", () => {
  it("validates IANA names", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("lists zones, including UTC and valid extras, without duplicates", () => {
    const zones = listTimeZones(["Europe/Paris", "Not/AZone"]);
    expect(zones).toContain("UTC");
    expect(zones).toContain("Europe/Paris");
    expect(zones).not.toContain("Not/AZone");
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe("getPostState", () => {
  const now = Date.parse("2026-06-01T12:00:00Z");

  it("is draft without a date", () => {
    expect(getPostState(null, now)).toBe("draft");
    expect(getPostState(undefined, now)).toBe("draft");
  });

  it("is scheduled in the future and live in the past", () => {
    expect(getPostState("2026-06-01T12:00:01Z", now)).toBe("scheduled");
    expect(getPostState("2026-06-01T12:00:00Z", now)).toBe("live");
    expect(getPostState("2026-05-01T00:00:00Z", now)).toBe("live");
  });

  it("treats an unparseable date as draft", () => {
    expect(getPostState("garbage", now)).toBe("draft");
  });
});
