"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Globe, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/code-block";
import {
  LIST_RESPONSE_EXAMPLE,
  NEXT_ARTICLE_PAGE,
  NEXT_LIST_PAGE,
  PLAIN_JS_HTML,
  POST_RESPONSE_EXAMPLE,
} from "@/components/connect/snippets";

const noopSubscribe = () => () => {};
const PLACEHOLDER_ORIGIN = "https://your-autoblog.example.com";

/** This instance's own origin. The server render uses a placeholder, the browser the real one. */
function useOrigin(): string {
  return useSyncExternalStore(noopSubscribe, () => window.location.origin, () => PLACEHOLDER_ORIGIN);
}

export function ConnectPage() {
  const t = useTranslations("connect");
  const origin = useOrigin();
  const code = (chunks: ReactNode) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{chunks}</code>;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </div>

      {/* How it works */}
      <section aria-labelledby="how" className="space-y-3">
        <h2 id="how" className="text-lg font-semibold">
          {t("how.title")}
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {(["one", "two", "three"] as const).map((step, index) => (
            <li key={step} className="flex gap-3 rounded-xl border p-4 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                {index + 1}
              </span>
              <span>{t(`how.${step}`)}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Base URL */}
      <section aria-labelledby="base" className="space-y-3">
        <h2 id="base" className="text-lg font-semibold">
          {t("base.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("base.description")}</p>
        <CodeBlock code={origin} />
      </section>

      {/* Endpoints */}
      <section aria-labelledby="endpoints" className="space-y-4">
        <h2 id="endpoints" className="text-lg font-semibold">
          {t("endpoints.title")}
        </h2>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">GET</Badge>
              <code className="font-mono text-sm">/api/posts</code>
            </CardTitle>
            <CardDescription>{t("endpoints.list.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t("endpoints.params")}</caption>
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1.5 pr-4 font-medium">{t("endpoints.paramName")}</th>
                    <th scope="col" className="py-1.5 font-medium">{t("endpoints.paramMeaning")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(["page", "limit", "tag"] as const).map((param) => (
                    <tr key={param}>
                      <td className="py-2 pr-4 align-top"><code className="font-mono text-xs">{param}</code></td>
                      <td className="py-2 text-muted-foreground">{t(`endpoints.list.params.${param}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground">{t("endpoints.list.order")}</p>
            <CodeBlock label={t("endpoints.exampleResponse")} code={LIST_RESPONSE_EXAMPLE} />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">GET</Badge>
              <code className="font-mono text-sm">/api/posts/{"{slug}"}</code>
            </CardTitle>
            <CardDescription>{t("endpoints.single.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t.rich("endpoints.single.fields", { code })}</p>
            <CodeBlock label={t("endpoints.exampleResponse")} code={POST_RESPONSE_EXAMPLE} />
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <a href="/api/posts" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ExternalLink data-icon="inline-start" aria-hidden="true" />
            {t("endpoints.tryIt")}
          </a>
          <span className="text-xs text-muted-foreground">{t("endpoints.tryItHint")}</span>
        </div>
      </section>

      {/* Snippets */}
      <section aria-labelledby="snippets" className="space-y-3">
        <h2 id="snippets" className="text-lg font-semibold">
          {t("snippets.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("snippets.description")}</p>
        <Tabs defaultValue="js">
          <TabsList>
            <TabsTrigger value="js">{t("snippets.js.tab")}</TabsTrigger>
            <TabsTrigger value="next">{t("snippets.next.tab")}</TabsTrigger>
          </TabsList>
          <TabsContent value="js" className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("snippets.js.description")}</p>
            <CodeBlock label="blog.html" code={PLAIN_JS_HTML(origin)} />
          </TabsContent>
          <TabsContent value="next" className="space-y-3">
            <p className="text-sm text-muted-foreground">{t.rich("snippets.next.description", { code })}</p>
            <CodeBlock label="app/blog/page.tsx" code={NEXT_LIST_PAGE(origin)} />
            <CodeBlock label="app/blog/[slug]/page.tsx" code={NEXT_ARTICLE_PAGE(origin)} />
          </TabsContent>
        </Tabs>
      </section>

      {/* CORS + caching */}
      <section aria-labelledby="good-to-know" className="space-y-3">
        <h2 id="good-to-know" className="text-lg font-semibold">
          {t("notes.title")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Note icon={<Globe className="size-4" aria-hidden="true" />} title={t("notes.cors.title")}>
            {t.rich("notes.cors.body", { code })}
          </Note>
          <Note icon={<Timer className="size-4" aria-hidden="true" />} title={t("notes.cache.title")}>
            {t.rich("notes.cache.body", { code })}
          </Note>
        </div>
        <p className="text-sm text-muted-foreground">{t.rich("notes.seo", { code })}</p>
      </section>
    </div>
  );
}

function Note({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{children}</p>
      </CardContent>
    </Card>
  );
}
