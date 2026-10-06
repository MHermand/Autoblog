"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatInZone } from "@/lib/datetime";
import { useSettings } from "@/lib/queries";

export function AutomationCard() {
  const t = useTranslations("posts.automation");
  const locale = useLocale();
  const settings = useSettings();

  if (settings.isPending) return <Skeleton className="h-[74px] w-full rounded-xl" />;
  if (!settings.data) return null; // the settings error is surfaced by the posts list and the settings page

  const { settings: blog, automation } = settings.data;
  const enabled = blog.automation.enabled;

  return (
    <Card size="sm">
      <CardContent className="flex-row flex-wrap items-center gap-x-6 gap-y-3 sm:flex-nowrap">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          <CalendarClock className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="font-medium">{t("title")}</h2>
              <Badge variant={enabled ? "default" : "secondary"}>{enabled ? t("on") : t("off")}</Badge>
            </div>
            {enabled ? (
              <p className="text-sm text-muted-foreground">
                {automation.nextSlot
                  ? t("nextSlot", { date: formatInZone(automation.nextSlot, blog.timezone, locale) })
                  : t("stockFull")}
                {" · "}
                {t("upcoming", { count: automation.upcomingAutoCount })}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("disabledHint")}</p>
            )}
          </div>
        </div>
        <Link href="/admin/settings#automation" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Settings2 data-icon="inline-start" aria-hidden="true" />
          {t("manage")}
        </Link>
      </CardContent>
    </Card>
  );
}
