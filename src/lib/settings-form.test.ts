import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, settingsSchema } from "../core/settings";
import type { ScheduleRule } from "../core/types";
import {
  formToSettings,
  isSettingsFormEqual,
  settingsToForm,
  validateSettingsForm,
  type SettingsFormState,
} from "./settings-form";

const base = () => settingsToForm({ ...structuredClone(DEFAULT_SETTINGS), brandName: "Acme", timezone: "Europe/Paris" });

function withForm(patch: Partial<SettingsFormState>): SettingsFormState {
  return { ...base(), ...patch };
}

describe("settingsToForm / formToSettings", () => {
  it("round-trips the defaults", () => {
    const settings = { ...structuredClone(DEFAULT_SETTINGS), brandName: "Acme", timezone: "Europe/Paris" };
    expect(formToSettings(settingsToForm(settings))).toEqual(settings);
  });

  it("round-trips every schedule rule", () => {
    const rules: ScheduleRule[] = [
      { kind: "interval", everyDays: 5 },
      { kind: "weekly", weekdays: [1, 3, 5] },
      { kind: "monthly", dayOfMonth: 15 },
    ];
    for (const rule of rules) {
      const settings = { ...structuredClone(DEFAULT_SETTINGS), automation: { ...DEFAULT_SETTINGS.automation, rule } };
      expect(formToSettings(settingsToForm(settings)).automation.rule).toEqual(rule);
    }
  });

  it("turns blank models into null and trims text", () => {
    const out = formToSettings(withForm({ textModel: "  ", imageModel: " gpt-image-1 ", brandName: "  Acme  " }));
    expect(out.textModel).toBeNull();
    expect(out.imageModel).toBe("gpt-image-1");
    expect(out.brandName).toBe("Acme");
  });

  it("produces a payload the server schema accepts", () => {
    const form = withForm({ ruleKind: "weekly", weekdays: [5, 1, 3], wordCountMin: "500", wordCountMax: "900" });
    expect(validateSettingsForm(form)).toEqual({});
    const parsed = settingsSchema.safeParse(formToSettings(form));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.automation.rule).toEqual({ kind: "weekly", weekdays: [1, 3, 5] });
  });
});

describe("validateSettingsForm", () => {
  it("accepts a valid form", () => {
    expect(validateSettingsForm(base())).toEqual({});
  });

  it("checks the site URL", () => {
    expect(validateSettingsForm(withForm({ siteUrl: "" }))).toEqual({});
    expect(validateSettingsForm(withForm({ siteUrl: "https://example.com/blog" }))).toEqual({});
    expect(validateSettingsForm(withForm({ siteUrl: "example.com" })).siteUrl?.code).toBe("invalidUrl");
    expect(validateSettingsForm(withForm({ siteUrl: "ftp://example.com" })).siteUrl?.code).toBe("invalidUrl");
  });

  it("checks the language tag and the timezone", () => {
    expect(validateSettingsForm(withForm({ language: "pt-BR" }))).toEqual({});
    expect(validateSettingsForm(withForm({ language: "" })).language?.code).toBe("invalidLanguage");
    expect(validateSettingsForm(withForm({ language: "not a tag" })).language?.code).toBe("invalidLanguage");
    expect(validateSettingsForm(withForm({ timezone: "Nowhere/Land" })).timezone?.code).toBe("invalidTimezone");
  });

  it("enforces word count bounds and order", () => {
    expect(validateSettingsForm(withForm({ wordCountMin: "299" })).wordCountMin).toMatchObject({ code: "range", min: 300, max: 3000 });
    expect(validateSettingsForm(withForm({ wordCountMax: "3001" })).wordCountMax?.code).toBe("range");
    expect(validateSettingsForm(withForm({ wordCountMin: "abc" })).wordCountMin?.code).toBe("range");
    expect(validateSettingsForm(withForm({ wordCountMin: "1500", wordCountMax: "1000" })).wordCountMin?.code).toBe("minGreaterThanMax");
    expect(validateSettingsForm(withForm({ wordCountMin: "1000", wordCountMax: "1000" }))).toEqual({});
  });

  it("enforces image, hour and horizon bounds", () => {
    expect(validateSettingsForm(withForm({ bodyImageCount: "4" })).bodyImageCount?.code).toBe("range");
    expect(validateSettingsForm(withForm({ bodyImageCount: "0" }))).toEqual({});
    expect(validateSettingsForm(withForm({ publishHour: "24" })).publishHour?.code).toBe("range");
    expect(validateSettingsForm(withForm({ publishHour: "0" }))).toEqual({});
    expect(validateSettingsForm(withForm({ horizonDays: "0" })).horizonDays?.code).toBe("range");
    expect(validateSettingsForm(withForm({ horizonDays: "30" }))).toEqual({});
    expect(validateSettingsForm(withForm({ horizonDays: "1.5" })).horizonDays?.code).toBe("range");
  });

  it("only validates the fields of the selected schedule rule", () => {
    expect(validateSettingsForm(withForm({ ruleKind: "interval", everyDays: "15" })).everyDays?.code).toBe("range");
    expect(validateSettingsForm(withForm({ ruleKind: "weekly", everyDays: "15" }))).toEqual({});
    expect(validateSettingsForm(withForm({ ruleKind: "monthly", dayOfMonth: "29" })).dayOfMonth?.code).toBe("range");
    expect(validateSettingsForm(withForm({ ruleKind: "monthly", dayOfMonth: "28" }))).toEqual({});
    expect(validateSettingsForm(withForm({ ruleKind: "weekly", weekdays: [] })).weekdays?.code).toBe("weekdays");
  });
});

describe("isSettingsFormEqual", () => {
  it("detects changes", () => {
    expect(isSettingsFormEqual(base(), base())).toBe(true);
    expect(isSettingsFormEqual(base(), withForm({ tone: "x" }))).toBe(false);
    expect(isSettingsFormEqual(base(), withForm({ weekdays: [1, 2] }))).toBe(false);
  });
});
