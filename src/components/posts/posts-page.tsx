"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, ImageIcon, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { AutomationCard } from "@/components/posts/automation-card";
import { DeletePostDialog } from "@/components/posts/delete-post-dialog";
import { GenerateDialog } from "@/components/posts/generate-dialog";
import { SourceBadge, StateBadge } from "@/components/posts/post-badges";
import { RemoteImage } from "@/components/remote-image";
import type { Post } from "@/core/types";
import { listPosts, type PostStateFilter } from "@/lib/api";
import { formatInZone, getPostState } from "@/lib/datetime";
import { queryKeys, useBlogTimeZone, useSettings } from "@/lib/queries";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useErrorMessage } from "@/lib/use-error-message";

const PAGE_SIZE = 20;
const STATE_FILTERS: PostStateFilter[] = ["all", "draft", "scheduled", "live"];
const TEXT_PROVIDER_ENV_VARS = "GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY";

export function PostsPage() {
  const t = useTranslations("posts");
  const errorMessage = useErrorMessage();
  const timeZone = useBlogTimeZone();
  const settings = useSettings();

  const [search, setSearch] = useState("");
  const [state, setState] = useState<PostStateFilter>("all");
  const [page, setPage] = useState(1);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Post | null>(null);

  const q = useDebouncedValue(search.trim(), 300);
  const posts = useQuery({
    queryKey: [...queryKeys.posts, { page, q, state }],
    queryFn: () => listPosts({ page, limit: PAGE_SIZE, q, state }),
    placeholderData: keepPreviousData,
  });

  const noTextProvider = settings.data ? !Object.values(settings.data.providers.text).some(Boolean) : false;
  const total = posts.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isFiltering = q !== "" || state !== "all";
  const isEmpty = posts.isSuccess && total === 0 && !isFiltering;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setGenerateOpen(true)} disabled={noTextProvider}>
          <Sparkles data-icon="inline-start" aria-hidden="true" />
          {t("generate")}
        </Button>
      </div>

      {noTextProvider ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t("noProvider.title")}</AlertTitle>
          <AlertDescription>{t("noProvider.body", { vars: TEXT_PROVIDER_ENV_VARS })}</AlertDescription>
        </Alert>
      ) : null}

      <AutomationCard />

      {isEmpty ? (
        <EmptyState onGenerate={() => setGenerateOpen(true)} canGenerate={!noTextProvider} />
      ) : (
        <section className="space-y-4" aria-label={t("listLabel")}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-52 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={t("search")}
                aria-label={t("search")}
                className="pl-8"
              />
            </div>
            <NativeSelect
              aria-label={t("filter")}
              value={state}
              onChange={(event) => {
                setState(event.target.value as PostStateFilter);
                setPage(1);
              }}
            >
              {STATE_FILTERS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {t(`filters.${value}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {posts.isSuccess ? (
              <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
                {t("count", { count: total })}
              </p>
            ) : null}
          </div>

          {posts.isError && !posts.data ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>{t("loadError")}</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{errorMessage(posts.error)}</span>
                <Button variant="outline" size="sm" onClick={() => posts.refetch()}>
                  {t("retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : posts.isPending ? (
            <Card className="gap-0 py-0">
              <ul className="divide-y">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="flex items-center gap-4 p-4">
                    <Skeleton className="h-14 w-20 shrink-0 rounded-md" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : posts.data && posts.data.posts.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noResults")}</p>
          ) : (
            <Card className="gap-0 py-0" aria-busy={posts.isPlaceholderData}>
              <ul className="divide-y">
                {posts.data?.posts.map((post) => (
                  <PostRow key={post.id} post={post} timeZone={timeZone} onDelete={() => setToDelete(post)} />
                ))}
              </ul>
            </Card>
          )}

          {pageCount > 1 ? (
            <nav className="flex items-center justify-between gap-3" aria-label={t("pagination.label")}>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft data-icon="inline-start" aria-hidden="true" />
                {t("pagination.previous")}
              </Button>
              <p className="text-sm text-muted-foreground">{t("pagination.status", { page, pages: pageCount })}</p>
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                {t("pagination.next")}
                <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            </nav>
          ) : null}
        </section>
      )}

      <GenerateDialog open={generateOpen} onOpenChange={setGenerateOpen} timeZone={timeZone} />
      <DeletePostDialog
        post={toDelete}
        onClose={() => setToDelete(null)}
        // Deleting the last article of a page would leave an empty page behind.
        onDeleted={() => posts.data?.posts.length === 1 && page > 1 && setPage(page - 1)}
      />
    </div>
  );
}

function PostRow({ post, timeZone, onDelete }: { post: Post; timeZone: string; onDelete: () => void }) {
  const t = useTranslations("posts");
  const locale = useLocale();
  const state = getPostState(post.publishedAt);
  const date = formatInZone(post.publishedAt, timeZone, locale);

  return (
    <li className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
      <Link href={`/admin/posts/${post.id}`} tabIndex={-1} aria-hidden="true" className="shrink-0">
        <div className="flex h-14 w-20 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
          {post.coverImageUrl ? (
            <RemoteImage src={post.coverImageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="size-5" />
          )}
        </div>
      </Link>

      <div className="min-w-0 flex-1 space-y-1.5">
        <Link
          href={`/admin/posts/${post.id}`}
          className="line-clamp-2 rounded-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {post.title || t("untitled")}
        </Link>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <StateBadge state={state} />
          <SourceBadge source={post.source} />
          <span>
            {state === "draft"
              ? t("dates.draft")
              : state === "scheduled"
                ? t("dates.scheduled", { date })
                : t("dates.live", { date })}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Link
          href={`/admin/posts/${post.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          aria-label={t("editAria", { title: post.title })}
        >
          <Pencil data-icon="inline-start" aria-hidden="true" />
          <span className="max-sm:sr-only">{t("edit")}</span>
        </Link>
        <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={t("deleteAria", { title: post.title })}>
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

function EmptyState({ onGenerate, canGenerate }: { onGenerate: () => void; canGenerate: boolean }) {
  const t = useTranslations("posts.empty");

  return (
    <Card className="items-center py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Plus className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2 px-6">
        <h2 className="text-lg font-medium">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("body")}</p>
      </div>
      <ol className="max-w-md space-y-2 px-6 text-left text-sm">
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">1</span>
          <span>{t("step1")}</span>
        </li>
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">2</span>
          <span>{t("step2")}</span>
        </li>
      </ol>
      <div className="flex flex-wrap justify-center gap-2 px-6">
        <Link href="/admin/settings" className={buttonVariants({ variant: "outline" })}>
          {t("openSettings")}
        </Link>
        <Button onClick={onGenerate} disabled={!canGenerate}>
          <Sparkles data-icon="inline-start" aria-hidden="true" />
          {t("generate")}
        </Button>
      </div>
    </Card>
  );
}
