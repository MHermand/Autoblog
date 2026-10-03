import { describe, expect, it } from "vitest";
import { parseAcceptLanguage, resolveLocale } from "./config";

describe("parseAcceptLanguage", () => {
  it("orders by quality, then by position", () => {
    expect(parseAcceptLanguage("de;q=0.5, fr-CA, en;q=0.8")).toEqual(["fr-CA", "en", "de"]);
  });

  it("drops q=0 and the wildcard, and tolerates empty input", () => {
    expect(parseAcceptLanguage("*;q=0.5, en;q=0")).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("")).toEqual([]);
  });
});

describe("resolveLocale", () => {
  it("prefers a valid cookie over the header", () => {
    expect(resolveLocale("fr", "en-US,en;q=0.9")).toBe("fr");
    expect(resolveLocale("en", "fr-FR")).toBe("en");
  });

  it("ignores an unknown cookie and falls back to Accept-Language", () => {
    expect(resolveLocale("de", "fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(resolveLocale(undefined, "fr-CA")).toBe("fr");
  });

  it("skips unsupported languages until one matches", () => {
    expect(resolveLocale(undefined, "de-DE,de;q=0.9,fr;q=0.8")).toBe("fr");
  });

  it("defaults to English", () => {
    expect(resolveLocale(undefined, undefined)).toBe("en");
    expect(resolveLocale(undefined, "ja,zh;q=0.9")).toBe("en");
  });
});
