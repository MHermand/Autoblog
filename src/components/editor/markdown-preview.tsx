"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

type Renderer = (markdown: string) => string;

/**
 * Renders the article body as the public API would serve it. The renderer
 * (`marked` + `sanitize-html`) is loaded the first time the preview opens, so
 * it stays out of the initial editor bundle. Its output is sanitized.
 */
export function MarkdownPreview({ markdown }: { markdown: string }) {
  const t = useTranslations("editor.body");
  const [renderer, setRenderer] = useState<{ render: Renderer } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("@/core/markdown")
      .then((mod) => !cancelled && setRenderer({ render: mod.renderMarkdown }))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const deferred = useDeferredValue(markdown);
  const html = useMemo(
    () => (renderer && deferred.trim() ? renderer.render(deferred) : ""),
    [renderer, deferred],
  );

  if (failed) return <p className="text-sm text-destructive">{t("previewError")}</p>;
  if (!deferred.trim()) return <p className="text-sm text-muted-foreground">{t("previewEmpty")}</p>;

  return (
    <div
      className="prose prose-neutral max-w-none dark:prose-invert prose-img:rounded-lg"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
