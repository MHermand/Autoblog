import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Autoblog", template: "%s · Autoblog" },
  description: "Self-hosted AI blog generator.",
  // The app is an admin tool: keep it out of search engines.
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        {/* Offset keeps toasts above the sticky save bar of the editor and settings pages. */}
        <Toaster position="bottom-center" offset={84} mobileOffset={84} />
      </body>
    </html>
  );
}
