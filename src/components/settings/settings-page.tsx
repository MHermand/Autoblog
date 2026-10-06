"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsForm } from "@/components/settings/settings-form";
import { useSettings } from "@/lib/queries";
import { useErrorMessage } from "@/lib/use-error-message";

export function SettingsPage() {
  const t = useTranslations("settings");
  const errorMessage = useErrorMessage();
  const settings = useSettings();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {settings.isPending ? (
        <div className="space-y-6" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : settings.isError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t("loadError")}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{errorMessage(settings.error)}</span>
            <Button variant="outline" size="sm" onClick={() => settings.refetch()}>
              {t("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <SettingsForm initial={settings.data} />
      )}
    </div>
  );
}
