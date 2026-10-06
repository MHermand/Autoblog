"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { redirectToLogin, signOut } from "@/lib/api";
import { useMe } from "@/lib/queries";

const NAV = [
  { href: "/admin", key: "posts", match: (p: string) => p === "/admin" || p.startsWith("/admin/posts") },
  { href: "/admin/settings", key: "settings", match: (p: string) => p.startsWith("/admin/settings") },
  { href: "/admin/connect", key: "connect", match: (p: string) => p.startsWith("/admin/connect") },
] as const;

export function AdminHeader() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // Even if the call fails, leave: the proxy sends signed-out users to /login.
    }
    redirectToLogin();
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 sm:px-6">
        <Link href="/admin" className="order-1 text-base font-semibold tracking-tight">
          Autoblog
        </Link>

        <nav aria-label={t("primary")} className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-2 sm:mx-0 sm:w-auto">
          {NAV.map(({ href, key, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {t(key)}
              </Link>
            );
          })}
        </nav>

        <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
          {me.data?.email ? (
            <span className="hidden max-w-64 truncate text-sm text-muted-foreground md:inline" title={me.data.email}>
              <span className="sr-only">{t("signedInAs")} </span>
              {me.data.email}
            </span>
          ) : null}
          <LanguageSwitcher />
          <Button variant="outline" size="sm" onClick={handleSignOut} disabled={signingOut}>
            <LogOut data-icon="inline-start" aria-hidden="true" />
            <span className="max-sm:sr-only">{signingOut ? t("signingOut") : t("signOut")}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
