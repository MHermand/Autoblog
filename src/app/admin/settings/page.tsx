import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsPage } from "@/components/settings/settings-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("settings") };
}

export default function AdminSettingsPage() {
  return <SettingsPage />;
}
