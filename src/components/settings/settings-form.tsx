"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleAlert, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import type { ImageProvider, ScheduleRule, TextProvider } from "@/core/types";
import { saveSettings, type SettingsResponse } from "@/lib/api";
import { formatInZone, listTimeZones } from "@/lib/datetime";
import {
  LIMITS,
  formToSettings,
  isSettingsFormEqual,
  settingsToForm,
  validateSettingsForm,
  type FieldError,
  type SettingsFormState,
} from "@/lib/settings-form";
import { queryKeys } from "@/lib/queries";
import { useErrorMessage } from "@/lib/use-error-message";

const TEXT_PROVIDERS: TextProvider[] = ["gemini", "openai", "anthropic"];
const IMAGE_PROVIDERS: ImageProvider[] = ["none", "gemini", "openai"];
const RULE_KINDS: ScheduleRule["kind"][] = ["interval", "weekly", "monthly"];
const API_KEY_VARS = { gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" } as const;

const COMMON_LANGUAGES = [
  "en", "en-GB", "en-US", "fr", "fr-CA", "es", "es-MX", "de", "it", "pt", "pt-BR", "nl", "pl", "sv", "da", "nb", "fi",
  "cs", "ro", "hu", "el", "tr", "ru", "uk", "ar", "he", "hi", "ja", "ko", "zh", "zh-TW", "id", "vi", "th",
];

function languageLabel(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

function weekdayLabel(isoDay: number, locale: string, style: "short" | "long"): string {
  // 2024-01-01 was a Monday, so day N of January 2024 is ISO weekday N for N = 1..7.
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(Date.UTC(2024, 0, isoDay));
}

/** Moves focus to the first field flagged invalid once the error state has rendered. */
function focusFirstInvalidField() {
  requestAnimationFrame(() => {
    const field = document.querySelector<HTMLElement>('form [aria-invalid="true"], form fieldset [role="alert"]');
    field?.scrollIntoView({ block: "center", behavior: "smooth" });
    field?.focus({ preventScroll: true });
  });
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="gap-5">{children}</CardContent>
    </Card>
  );
}

function Counter({ length, max }: { length: number; max: number }) {
  return (
    <span className="text-xs text-muted-foreground">
      {length}/{max}
    </span>
  );
}

export function SettingsForm({ initial }: { initial: SettingsResponse }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();

  const [baseline, setBaseline] = useState(() => settingsToForm(initial.settings));
  const [form, setForm] = useState(baseline);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // The last saved state as reported by the server (providers and automation status).
  const { providers, automation } = initial;
  const savedTimeZone = initial.settings.timezone;
  const savedAutomationEnabled = initial.settings.automation.enabled;

  const errors = validateSettingsForm(form);
  const visible = submitted ? errors : {};
  const dirty = !isSettingsFormEqual(form, baseline);

  const timeZones = useMemo(() => listTimeZones([initial.settings.timezone]), [initial.settings.timezone]);
  const zoneGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const zone of timeZones) {
      const region = zone.includes("/") ? zone.split("/")[0] : "UTC";
      groups.set(region, [...(groups.get(region) ?? []), zone]);
    }
    return Array.from(groups);
  }, [timeZones]);

  const set = <K extends keyof SettingsFormState>(key: K, value: SettingsFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: (settings: ReturnType<typeof formToSettings>) => saveSettings(settings),
    onSuccess: (response) => {
      const next = settingsToForm(response.settings);
      queryClient.setQueryData(queryKeys.settings, response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts }); // re-spaced posts
      setBaseline(next);
      setForm(next);
      setSubmitted(false);
      setServerError(null);
      toast.success(t("saved"));
    },
    onError: (error) => {
      const message = errorMessage(error);
      setServerError(message);
      toast.error(message);
    },
  });

  function handleSubmit() {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) {
      focusFirstInvalidField();
      return;
    }
    save.mutate(formToSettings(form));
  }

  const fieldError = (error?: FieldError): string | undefined => {
    if (!error) return undefined;
    switch (error.code) {
      case "invalidUrl":
        return t("errors.invalidUrl");
      case "invalidLanguage":
        return t("errors.invalidLanguage");
      case "invalidTimezone":
        return t("errors.invalidTimezone");
      case "range":
        return t("errors.range", { min: error.min ?? 0, max: error.max ?? 0 });
      case "minGreaterThanMax":
        return t("errors.minGreaterThanMax");
      case "weekdays":
        return t("errors.weekdays");
    }
  };

  const imagesOff = form.imageProvider === "none";

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      className="space-y-6"
    >
      <UnsavedChangesGuard when={dirty} />

      {serverError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      {/* ---- Brand ---- */}
      <Section id="brand" title={t("brand.title")} description={t("brand.description")}>
        <Field label={t("brand.name")} hint={t("brand.nameHint")}>
          <Input value={form.brandName} onChange={(e) => set("brandName", e.target.value)} maxLength={LIMITS.brandName} autoComplete="organization" />
        </Field>
        <Field label={t("brand.siteUrl")} hint={t("brand.siteUrlHint")} error={fieldError(visible.siteUrl)}>
          <Input type="url" inputMode="url" placeholder="https://www.example.com" value={form.siteUrl} onChange={(e) => set("siteUrl", e.target.value)} maxLength={LIMITS.siteUrl} />
        </Field>
        <Field
          label={t("brand.context")}
          hint={t("brand.contextHint")}
          aside={<Counter length={form.companyContext.length} max={LIMITS.companyContext} />}
        >
          <Textarea rows={7} value={form.companyContext} onChange={(e) => set("companyContext", e.target.value)} maxLength={LIMITS.companyContext} />
        </Field>
      </Section>

      {/* ---- Writing ---- */}
      <Section id="writing" title={t("writing.title")} description={t("writing.description")}>
        <Field label={t("writing.language")} hint={t("writing.languageHint")} error={fieldError(visible.language)}>
          <Input
            list="autoblog-languages"
            value={form.language}
            onChange={(e) => set("language", e.target.value)}
            maxLength={LIMITS.language}
            spellCheck={false}
            autoCapitalize="none"
            className="sm:max-w-xs"
          />
        </Field>
        <datalist id="autoblog-languages">
          {COMMON_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {languageLabel(code, locale)}
            </option>
          ))}
        </datalist>
        <Field label={t("writing.audience")} hint={t("writing.audienceHint")}>
          <Input value={form.audience} onChange={(e) => set("audience", e.target.value)} maxLength={LIMITS.audience} />
        </Field>
        <Field label={t("writing.tone")} hint={t("writing.toneHint")}>
          <Input value={form.tone} onChange={(e) => set("tone", e.target.value)} maxLength={LIMITS.tone} />
        </Field>
        <Field
          label={t("writing.topics")}
          hint={t("writing.topicsHint")}
          aside={<Counter length={form.topicGuidelines.length} max={LIMITS.topicGuidelines} />}
        >
          <Textarea rows={5} value={form.topicGuidelines} onChange={(e) => set("topicGuidelines", e.target.value)} maxLength={LIMITS.topicGuidelines} />
        </Field>
        <Field label={t("writing.cta")} hint={t("writing.ctaHint")}>
          <Textarea rows={2} value={form.callToAction} onChange={(e) => set("callToAction", e.target.value)} maxLength={LIMITS.callToAction} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("writing.wordCountMin")} error={fieldError(visible.wordCountMin)}>
            <Input type="number" inputMode="numeric" min={LIMITS.wordCount.min} max={LIMITS.wordCount.max} step={50} value={form.wordCountMin} onChange={(e) => set("wordCountMin", e.target.value)} />
          </Field>
          <Field label={t("writing.wordCountMax")} error={fieldError(visible.wordCountMax)}>
            <Input type="number" inputMode="numeric" min={LIMITS.wordCount.min} max={LIMITS.wordCount.max} step={50} value={form.wordCountMax} onChange={(e) => set("wordCountMax", e.target.value)} />
          </Field>
        </div>
      </Section>

      {/* ---- Images ---- */}
      <Section id="images" title={t("images.title")} description={t("images.description")}>
        <Field label={t("images.provider")} hint={imagesOff ? t("images.providerNoneHint") : undefined}>
          <NativeSelect value={form.imageProvider} onChange={(e) => set("imageProvider", e.target.value as ImageProvider)} className="sm:w-72">
            {IMAGE_PROVIDERS.map((provider) => (
              <NativeSelectOption key={provider} value={provider}>
                {provider === "none"
                  ? t("images.none")
                  : `${t(`providers.${provider}`)}${providers.image[provider] ? "" : ` — ${t("providers.noKey")}`}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {!imagesOff && !providers.image[form.imageProvider as "gemini" | "openai"] ? (
          <MissingKeyNotice variable={API_KEY_VARS[form.imageProvider as "gemini" | "openai"]} />
        ) : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("images.model")} hint={t("images.modelHint")}>
            <Input
              value={form.imageModel}
              onChange={(e) => set("imageModel", e.target.value)}
              placeholder={t("providerDefault")}
              maxLength={LIMITS.model}
              disabled={imagesOff}
              spellCheck={false}
            />
          </Field>
          <Field label={t("images.bodyCount")} hint={t("images.bodyCountHint")} error={fieldError(visible.bodyImageCount)}>
            <Input
              type="number"
              inputMode="numeric"
              min={LIMITS.bodyImageCount.min}
              max={LIMITS.bodyImageCount.max}
              value={form.bodyImageCount}
              onChange={(e) => set("bodyImageCount", e.target.value)}
              disabled={imagesOff}
            />
          </Field>
        </div>
        <Field label={t("images.style")} hint={t("images.styleHint")}>
          <Textarea rows={2} value={form.imageStyle} onChange={(e) => set("imageStyle", e.target.value)} maxLength={LIMITS.imageStyle} disabled={imagesOff} />
        </Field>
      </Section>

      {/* ---- AI text ---- */}
      <Section id="ai" title={t("ai.title")} description={t("ai.description")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("ai.provider")}>
            <NativeSelect value={form.textProvider} onChange={(e) => set("textProvider", e.target.value as TextProvider)} className="w-full">
              {TEXT_PROVIDERS.map((provider) => (
                <NativeSelectOption key={provider} value={provider}>
                  {t(`providers.${provider}`)}
                  {providers.text[provider] ? "" : ` — ${t("providers.noKey")}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("ai.model")} hint={t("ai.modelHint")}>
            <Input value={form.textModel} onChange={(e) => set("textModel", e.target.value)} placeholder={t("providerDefault")} maxLength={LIMITS.model} spellCheck={false} />
          </Field>
        </div>
        <ul className="grid gap-2 text-sm" aria-label={t("ai.keysLabel")}>
          {TEXT_PROVIDERS.map((provider) => (
            <li key={provider} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <span>
                {t(`providers.${provider}`)} <code className="ml-1 text-xs text-muted-foreground">{API_KEY_VARS[provider]}</code>
              </span>
              {providers.text[provider] ? (
                <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-300">
                  <Check aria-hidden="true" />
                  {t("providers.keyFound")}
                </Badge>
              ) : (
                <Badge variant="secondary">{t("providers.noKey")}</Badge>
              )}
            </li>
          ))}
        </ul>
        {!providers.text[form.textProvider] ? <MissingKeyNotice variable={API_KEY_VARS[form.textProvider]} /> : null}
      </Section>

      {/* ---- Automation ---- */}
      <Section id="automation" title={t("automation.title")} description={t("automation.description")}>
        <div className="flex items-start gap-3">
          <Switch
            id="automation-enabled"
            checked={form.automationEnabled}
            onCheckedChange={(checked) => set("automationEnabled", checked)}
            className="mt-0.5"
          />
          <div className="grid gap-1">
            <Label htmlFor="automation-enabled">{t("automation.enabled")}</Label>
            <p className="text-xs text-muted-foreground">{t("automation.enabledHint")}</p>
          </div>
        </div>

        {savedAutomationEnabled ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm" aria-live="polite">
            {automation.nextSlot
              ? t("automation.nextSlot", { date: formatInZone(automation.nextSlot, savedTimeZone, locale) })
              : t("automation.stockFull")}
            {" · "}
            {t("automation.upcoming", { count: automation.upcomingAutoCount })}
          </p>
        ) : null}

        <div className={cn("grid gap-5", !form.automationEnabled && "opacity-60")}>
          <Field label={t("automation.mode")}>
            <NativeSelect
              value={form.ruleKind}
              onChange={(e) => set("ruleKind", e.target.value as ScheduleRule["kind"])}
              className="sm:w-72"
            >
              {RULE_KINDS.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {t(`automation.modes.${kind}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          {form.ruleKind === "interval" ? (
            <Field label={t("automation.everyDays")} error={fieldError(visible.everyDays)}>
              <Input type="number" inputMode="numeric" min={LIMITS.everyDays.min} max={LIMITS.everyDays.max} value={form.everyDays} onChange={(e) => set("everyDays", e.target.value)} className="sm:w-32" />
            </Field>
          ) : null}

          {form.ruleKind === "weekly" ? (
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">{t("automation.weekdays")}</legend>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                  const active = form.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      aria-label={weekdayLabel(day, locale, "long")}
                      onClick={() =>
                        set("weekdays", active ? form.weekdays.filter((d) => d !== day) : [...form.weekdays, day].sort((a, b) => a - b))
                      }
                      className={cn(
                        "h-9 min-w-12 rounded-md border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                        active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                      )}
                    >
                      {weekdayLabel(day, locale, "short")}
                    </button>
                  );
                })}
              </div>
              {visible.weekdays ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {fieldError(visible.weekdays)}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          {form.ruleKind === "monthly" ? (
            <Field label={t("automation.dayOfMonth")} hint={t("automation.dayOfMonthHint")} error={fieldError(visible.dayOfMonth)}>
              <Input type="number" inputMode="numeric" min={LIMITS.dayOfMonth.min} max={LIMITS.dayOfMonth.max} value={form.dayOfMonth} onChange={(e) => set("dayOfMonth", e.target.value)} className="sm:w-32" />
            </Field>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t("automation.publishHour")} hint={t("automation.publishHourHint", { timezone: form.timezone })} error={fieldError(visible.publishHour)}>
              <Input type="number" inputMode="numeric" min={LIMITS.publishHour.min} max={LIMITS.publishHour.max} value={form.publishHour} onChange={(e) => set("publishHour", e.target.value)} />
            </Field>
            <Field label={t("automation.horizon")} hint={t("automation.horizonHint")} error={fieldError(visible.horizonDays)}>
              <Input type="number" inputMode="numeric" min={LIMITS.horizonDays.min} max={LIMITS.horizonDays.max} value={form.horizonDays} onChange={(e) => set("horizonDays", e.target.value)} />
            </Field>
          </div>

          <Field label={t("automation.timezone")} hint={t("automation.timezoneHint")} error={fieldError(visible.timezone)}>
            <NativeSelect value={form.timezone} onChange={(e) => set("timezone", e.target.value)} className="w-full sm:w-96">
              {zoneGroups.map(([region, zones]) => (
                <NativeSelectOptGroup key={region} label={region}>
                  {zones.map((zone) => (
                    <NativeSelectOption key={zone} value={zone}>
                      {zone}
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <p className="text-xs text-muted-foreground">{t("automation.respaceNote")}</p>
      </Section>

      {/* ---- Save bar ---- */}
      <div className="sticky bottom-0 z-30 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
            {submitted && Object.keys(errors).length > 0 ? (
              <>
                <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
                <span className="text-destructive">{t("errors.fixFields")}</span>
              </>
            ) : dirty ? (
              t("unsaved")
            ) : (
              <>
                <Check className="size-4" aria-hidden="true" />
                {t("allSaved")}
              </>
            )}
          </p>
          <div className="flex gap-2">
            {dirty ? (
              <Button
                type="button"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setForm(baseline);
                  setSubmitted(false);
                  setServerError(null);
                }}
              >
                {t("discard")}
              </Button>
            ) : null}
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Save data-icon="inline-start" aria-hidden="true" />}
              {save.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

function MissingKeyNotice({ variable }: { variable: string }) {
  const t = useTranslations("settings.providers");
  return (
    <Alert role="status">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>
        {t.rich("missingKey", { variable, code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}
      </AlertDescription>
    </Alert>
  );
}
