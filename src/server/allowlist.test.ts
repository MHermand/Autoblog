import { describe, expect, it } from "vitest";
import { isAllowedEmail, parseEmailList } from "./allowlist";

describe("parseEmailList", () => {
  it("splits, trims, lowercases and deduplicates", () => {
    expect(parseEmailList(" Alice@Example.com, bob@example.com ,alice@example.com")).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
  });

  it("accepts whitespace and semicolons as separators and drops blanks", () => {
    expect(parseEmailList("a@x.io;b@x.io\nc@x.io , ,")).toEqual(["a@x.io", "b@x.io", "c@x.io"]);
  });

  it("returns an empty list for missing or blank input", () => {
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList(null)).toEqual([]);
    expect(parseEmailList("  , ")).toEqual([]);
  });
});

describe("isAllowedEmail", () => {
  const list = parseEmailList("Admin@Example.com");

  it("matches case-insensitively and ignores surrounding spaces", () => {
    expect(isAllowedEmail("admin@example.com", list)).toBe(true);
    expect(isAllowedEmail("  ADMIN@EXAMPLE.COM ", list)).toBe(true);
  });

  it("rejects other, empty or missing emails", () => {
    expect(isAllowedEmail("other@example.com", list)).toBe(false);
    expect(isAllowedEmail("admin@example.com.evil.io", list)).toBe(false);
    expect(isAllowedEmail("", list)).toBe(false);
    expect(isAllowedEmail(null, list)).toBe(false);
  });

  it("allows nobody when the list is empty", () => {
    expect(isAllowedEmail("admin@example.com", [])).toBe(false);
  });
});
