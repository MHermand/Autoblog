"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CodeBlockProps {
  code: string;
  /** Shown above the code, typically a file name. */
  label?: string;
}

/** A code snippet with a copy-to-clipboard button. */
export function CodeBlock({ code, label }: CodeBlockProps) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (insecure context, permissions): the text stays selectable.
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/60 py-1 pr-1 pl-3">
        <span className="truncate font-mono text-xs text-muted-foreground">{label ?? ""}</span>
        <Button type="button" variant="ghost" size="xs" onClick={copy}>
          {copied ? <Check data-icon="inline-start" aria-hidden="true" /> : <Copy data-icon="inline-start" aria-hidden="true" />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed" tabIndex={0}>
        <code>{code}</code>
      </pre>
      <span className="sr-only" role="status">
        {copied ? t("copied") : ""}
      </span>
    </div>
  );
}
