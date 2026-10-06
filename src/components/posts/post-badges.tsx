import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import type { PostSource } from "@/core/types";
import type { PostState } from "@/lib/datetime";

const STATE_STYLES: Record<PostState, string> = {
  draft: "",
  scheduled: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-300",
  live: "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-300",
};

export function StateBadge({ state, className }: { state: PostState; className?: string }) {
  const t = useTranslations("posts.state");
  return (
    <Badge variant="secondary" className={cn(STATE_STYLES[state], className)}>
      {t(state)}
    </Badge>
  );
}

export function SourceBadge({ source, className }: { source: PostSource; className?: string }) {
  const t = useTranslations("posts.source");
  return (
    <Badge variant="outline" className={className}>
      {t(source)}
    </Badge>
  );
}
