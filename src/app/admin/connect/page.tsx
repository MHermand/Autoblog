import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ConnectPage } from "@/components/connect/connect-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("connect") };
}

export default function AdminConnectPage() {
  return <ConnectPage />;
}
