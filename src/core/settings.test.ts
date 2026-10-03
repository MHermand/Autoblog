import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, languageName, parseSettings, settingsSchema } from "./settings";
import type { BlogSettings } from "./types";

/** A fully valid settings object, distinct from the defaults so merges are visible. */
function valid(overrides: Partial<BlogSettings> = {}): BlogSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    brandName: "Acme Gardening",
    siteUrl: "https://acme.example",
    language: "fr",
    timezone: "Europe/Paris",
    audience: "Home gardeners",
    tone: "friendly",
    topicGuidelines: "Seasonal advice",
    companyContext: "We sell seeds.",
    callToAction: "Order your seeds",
    imageStyle: "watercolor",
    ...overrides,
  };
}

describe("DEFAULT_SETTINGS", () => {
  it("matches the documented generic defaults", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      language: "en",
      timezone: "UTC",
      textProvider: "gemini",
      imageProvider: "gemini",
      textModel: null,
      imageModel: null,
      bodyImageCount: 2,
      wordCountMin: 800,
      wordCountMax: 1200,
      brandName: "",
      siteUrl: "",
      audience: "",
      tone: "",
      topicGuidelines: "",
      companyContext: "",
      callToAction: "",
      imageStyle: "",
      automation: { enabled: false, publishHour: 9, rule: { kind: "interval", everyDays: 3 }, horizonDays: 14 },
    });
  });

  it("is valid under the strict schema", () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe("settingsSchema", () => {
  it("accepts a fully valid object and returns it unchanged", () => {
    const settings = valid();
    expect(settingsSchema.parse(settings)).toEqual(settings);
  });

  it("strips unknown keys", () => {
    const parsed = settingsSchema.parse({ ...valid(), surprise: true }) as unknown as Record<string, unknown>;
    expect(parsed.surprise).toBeUndefined();
  });

  it("rejects missing fields", () => {
    const { brandName, ...rest } = valid();
    void brandName;
    expect(settingsSchema.safeParse(rest).success).toBe(false);
    expect(settingsSchema.safeParse(undefined).success).toBe(false);
    expect(settingsSchema.safeParse({}).success).toBe(false);
  });

  it("trims strings and turns an empty model name into null", () => {
    const parsed = settingsSchema.parse(valid({ brandName: "  Acme  ", textModel: "", imageModel: "  gpt-image-1 " }));
    expect(parsed.brandName).toBe("Acme");
    expect(parsed.textModel).toBeNull();
    expect(parsed.imageModel).toBe("gpt-image-1");
  });

  describe("bounds", () => {
    const accepted: [string, Partial<BlogSettings>][] = [
      ["wordCountMin at its lower bound", { wordCountMin: 300 }],
      ["wordCountMax at its upper bound", { wordCountMax: 3000 }],
      ["wordCountMin equal to wordCountMax", { wordCountMin: 1000, wordCountMax: 1000 }],
      ["bodyImageCount 0", { bodyImageCount: 0 }],
      ["bodyImageCount 3", { bodyImageCount: 3 }],
      ["imageProvider none", { imageProvider: "none" }],
      ["anthropic text provider", { textProvider: "anthropic" }],
      ["empty siteUrl", { siteUrl: "" }],
      ["http siteUrl", { siteUrl: "http://localhost:3000" }],
      ["regional language tag", { language: "es-MX" }],
      ["companyContext at its cap", { companyContext: "x".repeat(8000) }],
      ["UTC timezone", { timezone: "UTC" }],
      ["deep IANA timezone", { timezone: "America/Argentina/Buenos_Aires" }],
    ];
    it.each(accepted)("accepts %s", (_, overrides) => {
      expect(settingsSchema.safeParse(valid(overrides)).success).toBe(true);
    });

    const rejected: [string, Partial<BlogSettings>][] = [
      ["wordCountMin below 300", { wordCountMin: 299 }],
      ["wordCountMax above 3000", { wordCountMax: 3001 }],
      ["wordCountMin above wordCountMax", { wordCountMin: 1500, wordCountMax: 1000 }],
      ["non-integer word count", { wordCountMin: 800.5 }],
      ["bodyImageCount -1", { bodyImageCount: -1 }],
      ["bodyImageCount 4", { bodyImageCount: 4 }],
      ["unknown text provider", { textProvider: "mistral" as never }],
      ["'none' as a text provider", { textProvider: "none" as never }],
      ["unknown image provider", { imageProvider: "anthropic" as never }],
      ["companyContext over its cap", { companyContext: "x".repeat(8001) }],
      ["brandName over its cap", { brandName: "x".repeat(101) }],
      ["a siteUrl that is not a URL", { siteUrl: "not a url" }],
      ["a javascript: siteUrl", { siteUrl: "javascript:alert(1)" }],
      ["an unknown timezone", { timezone: "Mars/Olympus_Mons" }],
      ["a UTC offset instead of an IANA zone", { timezone: "+01:00" }],
      ["an empty timezone", { timezone: "" }],
      ["an invalid language tag", { language: "not a language" }],
      ["an empty language", { language: "" }],
    ];
    it.each(rejected)("rejects %s", (_, overrides) => {
      expect(settingsSchema.safeParse(valid(overrides)).success).toBe(false);
    });
  });

  describe("automation", () => {
    const withAutomation = (patch: Record<string, unknown>) =>
      valid({ automation: { ...DEFAULT_SETTINGS.automation, ...patch } as BlogSettings["automation"] });

    it.each([
      ["publishHour 0", { publishHour: 0 }],
      ["publishHour 23", { publishHour: 23 }],
      ["horizonDays 1", { horizonDays: 1 }],
      ["horizonDays 30", { horizonDays: 30 }],
      ["interval 1", { rule: { kind: "interval", everyDays: 1 } }],
      ["interval 14", { rule: { kind: "interval", everyDays: 14 } }],
      ["weekly with several days", { rule: { kind: "weekly", weekdays: [1, 3, 7] } }],
      ["weekly with all days", { rule: { kind: "weekly", weekdays: [1, 2, 3, 4, 5, 6, 7] } }],
      ["monthly 1", { rule: { kind: "monthly", dayOfMonth: 1 } }],
      ["monthly 28", { rule: { kind: "monthly", dayOfMonth: 28 } }],
      ["enabled", { enabled: true }],
    ])("accepts %s", (_, patch) => {
      expect(settingsSchema.safeParse(withAutomation(patch)).success).toBe(true);
    });

    it.each([
      ["publishHour -1", { publishHour: -1 }],
      ["publishHour 24", { publishHour: 24 }],
      ["fractional publishHour", { publishHour: 9.5 }],
      ["horizonDays 0", { horizonDays: 0 }],
      ["horizonDays 31", { horizonDays: 31 }],
      ["interval 0", { rule: { kind: "interval", everyDays: 0 } }],
      ["interval 15", { rule: { kind: "interval", everyDays: 15 } }],
      ["weekly without days", { rule: { kind: "weekly", weekdays: [] } }],
      ["weekly with a day 0", { rule: { kind: "weekly", weekdays: [0, 1] } }],
      ["weekly with a day 8", { rule: { kind: "weekly", weekdays: [1, 8] } }],
      ["weekly with duplicates", { rule: { kind: "weekly", weekdays: [1, 1] } }],
      ["monthly 0", { rule: { kind: "monthly", dayOfMonth: 0 } }],
      ["monthly 29", { rule: { kind: "monthly", dayOfMonth: 29 } }],
      ["an unknown rule kind", { rule: { kind: "yearly" } }],
      ["a non-boolean enabled", { enabled: "yes" }],
    ])("rejects %s", (_, patch) => {
      expect(settingsSchema.safeParse(withAutomation(patch)).success).toBe(false);
    });
  });
});

describe("parseSettings", () => {
  it("returns the defaults for anything that is not an object", () => {
    for (const input of [undefined, null, 42, "text", true, [], [1, 2], () => 1]) {
      expect(parseSettings(input)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("returns a fresh object every time (no shared mutable state)", () => {
    const a = parseSettings(null);
    a.automation.rule = { kind: "monthly", dayOfMonth: 3 };
    a.brandName = "mutated";
    const b = parseSettings(null);
    expect(b).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.automation.rule).toEqual({ kind: "interval", everyDays: 3 });
    expect(DEFAULT_SETTINGS.brandName).toBe("");
  });

  it("round-trips a valid object", () => {
    const settings = valid({ automation: { enabled: true, publishHour: 7, rule: { kind: "weekly", weekdays: [2, 4] }, horizonDays: 10 } });
    expect(parseSettings(settings)).toEqual(settings);
  });

  it("deep-merges a partial object onto the defaults", () => {
    const parsed = parseSettings({ brandName: "Acme", automation: { enabled: true } });
    expect(parsed).toEqual({
      ...DEFAULT_SETTINGS,
      brandName: "Acme",
      automation: { ...DEFAULT_SETTINGS.automation, enabled: true },
    });
  });

  it("drops invalid fields and keeps the valid ones", () => {
    const parsed = parseSettings({
      brandName: "Acme",
      language: "not a language",
      timezone: "Nowhere/Land",
      wordCountMin: 10,
      bodyImageCount: 9,
      textProvider: "mistral",
      companyContext: 42,
      automation: { publishHour: 99, horizonDays: 7, rule: { kind: "interval", everyDays: 50 } },
    });
    expect(parsed.brandName).toBe("Acme");
    expect(parsed.language).toBe(DEFAULT_SETTINGS.language);
    expect(parsed.timezone).toBe(DEFAULT_SETTINGS.timezone);
    expect(parsed.wordCountMin).toBe(DEFAULT_SETTINGS.wordCountMin);
    expect(parsed.bodyImageCount).toBe(DEFAULT_SETTINGS.bodyImageCount);
    expect(parsed.textProvider).toBe(DEFAULT_SETTINGS.textProvider);
    expect(parsed.companyContext).toBe("");
    expect(parsed.automation.publishHour).toBe(DEFAULT_SETTINGS.automation.publishHour);
    expect(parsed.automation.horizonDays).toBe(7);
    expect(parsed.automation.rule).toEqual(DEFAULT_SETTINGS.automation.rule);
  });

  it("ignores unknown keys and prototype pollution attempts", () => {
    const parsed = parseSettings(JSON.parse('{"__proto__": {"polluted": true}, "extra": 1, "brandName": "Acme"}'));
    expect(parsed.brandName).toBe("Acme");
    expect((parsed as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("resets both word counts when they contradict each other", () => {
    const parsed = parseSettings({ wordCountMin: 2000, wordCountMax: 500 });
    // each bound is valid on its own, but min > max: both go back to the defaults
    expect(parsed.wordCountMin).toBe(DEFAULT_SETTINGS.wordCountMin);
    expect(parsed.wordCountMax).toBe(DEFAULT_SETTINGS.wordCountMax);
    // min is valid alone, but exceeds the default max: same fallback
    const half = parseSettings({ wordCountMin: 2000 });
    expect(half.wordCountMin).toBe(DEFAULT_SETTINGS.wordCountMin);
    expect(half.wordCountMax).toBe(DEFAULT_SETTINGS.wordCountMax);
  });

  it("repairs a weekly rule: dedupes, sorts and drops junk days", () => {
    const parsed = parseSettings({ automation: { rule: { kind: "weekly", weekdays: [5, 1, 1, 9, "x", 3] } } });
    expect(parsed.automation.rule).toEqual({ kind: "weekly", weekdays: [1, 3, 5] });
  });

  it("falls back to the default rule when a weekly rule has no valid day", () => {
    const parsed = parseSettings({ automation: { rule: { kind: "weekly", weekdays: [] } } });
    expect(parsed.automation.rule).toEqual(DEFAULT_SETTINGS.automation.rule);
  });

  it("treats an empty model name as the provider default", () => {
    const parsed = parseSettings({ textModel: "", imageModel: "custom-image-model" });
    expect(parsed.textModel).toBeNull();
    expect(parsed.imageModel).toBe("custom-image-model");
  });

  it("ignores a non-object automation section", () => {
    for (const automation of [null, 3, "on", [1]]) {
      expect(parseSettings({ automation }).automation).toEqual(DEFAULT_SETTINGS.automation);
    }
  });

  it("never throws, even on hostile input", () => {
    const hostile = {
      get brandName(): string {
        throw new Error("boom");
      },
      automation: new Proxy(
        {},
        {
          get() {
            throw new Error("boom");
          },
          ownKeys() {
            throw new Error("boom");
          },
        },
      ),
    };
    expect(() => parseSettings(hostile)).not.toThrow();
    expect(parseSettings(hostile).language).toBe("en");
  });

  it("produces output that passes the strict schema whatever the input", () => {
    const inputs: unknown[] = [
      null,
      {},
      { automation: { rule: { kind: "monthly", dayOfMonth: 99 } } },
      { wordCountMin: 5000, wordCountMax: 10 },
      { language: "", timezone: "", siteUrl: "ftp://x" },
      valid(),
    ];
    for (const input of inputs) {
      expect(settingsSchema.safeParse(parseSettings(input)).success).toBe(true);
    }
  });
});

describe("languageName", () => {
  it("returns the English name of a language tag", () => {
    expect(languageName("en")).toBe("English");
    expect(languageName("fr")).toBe("French");
    expect(languageName("es-MX")).toMatch(/Spanish/);
  });

  it("falls back to the tag, or English when empty", () => {
    expect(languageName("")).toBe("English");
    expect(languageName("not a tag")).toBe("not a tag");
  });
});
