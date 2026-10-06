import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminHeader } from "@/components/admin/admin-header";
import { Providers } from "@/components/providers";
import { getAdminSession } from "@/server/auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // proxy.ts already redirects signed-out visitors; this is the authoritative check.
  if (!(await getAdminSession())) redirect("/login");
  const t = await getTranslations("common");

  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          {t("skipToContent")}
        </a>
        <AdminHeader />
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </Providers>
  );
}
