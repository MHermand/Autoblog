"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import { locales, setLocaleCookie, type Locale } from "@/i18n/config";

/** EN / FR segmented control. Stores the choice in the NEXT_LOCALE cookie. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("language");
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === current) return;
    setLocaleCookie(next);
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label={t("label")}
      aria-busy={pending}
      className={cn("inline-flex rounded-md border bg-background p-0.5 text-xs font-medium", className)}
    >
      {locales.map((locale) => {
        const active = locale === current;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            title={t(locale)}
            aria-label={t(locale)}
            aria-pressed={active}
            onClick={() => choose(locale)}
            className={cn(
              "rounded-[5px] px-2 py-1 uppercase outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {locale}
          </button>
        );
      })}
    </div>
  );
}
