"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { TopicSuggestion } from "@/core/types";
import { generatePost, isApiError, suggestTopics } from "@/lib/api";
import { formatInZone, getPostState, zonedInputToIso } from "@/lib/datetime";
import { queryKeys } from "@/lib/queries";
import { useErrorMessage } from "@/lib/use-error-message";

interface GenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The blog's IANA timezone: the publication date is entered in it. */
  timeZone: string;
}

/**
 * Pick a topic (suggested or custom), optionally a publication date, then wait
 * for the article. While the request runs (1-2 minutes) the dialog cannot be
 * dismissed, so a stray click or Escape does not hide the progress.
 */
export function GenerateDialog({ open, onOpenChange, timeZone }: GenerateDialogProps) {
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => (next || !busy) && onOpenChange(next)}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
        onInteractOutside={(event) => busy && event.preventDefault()}
      >
        {/* Mounted only while the dialog is open, so every opening starts fresh. */}
        <GenerateFlow timeZone={timeZone} onBusyChange={setBusy} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

const CUSTOM = Symbol("custom-topic");

// Server limits (src/server/schemas.ts): topic <= 500 chars; exclude <= 50 titles of <= 300 chars.
const TOPIC_MAX_CHARS = 500;
const EXCLUDE_MAX_ITEMS = 50;
const EXCLUDE_MAX_CHARS = 300;

function composeTopic(topic: TopicSuggestion): string {
  return (topic.angle ? `${topic.title}. ${topic.angle}` : topic.title).slice(0, TOPIC_MAX_CHARS);
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function GenerateFlow({
  timeZone,
  onBusyChange,
  onClose,
}: {
  timeZone: string;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations("generate");
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();

  // Topic suggestions. `round` changes the query key to ask for new ones;
  // `excluded` accumulates every title already shown.
  const [round, setRound] = useState(0);
  const [excluded, setExcluded] = useState<string[]>([]);
  const topicsQuery = useQuery({
    queryKey: ["topics", round],
    queryFn: () => suggestTopics({ count: 3, exclude: excluded }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false, // each attempt is a paid LLM call
    refetchOnWindowFocus: false,
  });
  const topics = topicsQuery.data?.topics ?? [];

  const [choice, setChoice] = useState<string | typeof CUSTOM | null>(null);
  const [custom, setCustom] = useState("");
  const [publishLocal, setPublishLocal] = useState("");

  const selectedTopic = typeof choice === "string" ? topics.find((topic) => topic.title === choice) : undefined;
  const topicText = choice === CUSTOM ? custom.trim() : selectedTopic ? composeTopic(selectedTopic) : "";
  const publishedAt = publishLocal ? zonedInputToIso(publishLocal, timeZone) : null;
  const publishInvalid = publishLocal !== "" && publishedAt === null;

  const generate = useMutation({
    mutationFn: (body: { topic: string; publishedAt: string | null }) => generatePost(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.posts }),
  });

  // Elapsed time while generating.
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const generating = generate.isPending;
  useEffect(() => {
    if (!generating) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [generating]);

  // Warn before the tab is closed or reloaded mid-generation.
  useEffect(() => {
    if (!generating) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [generating]);

  function showOtherTopics() {
    setExcluded((previous) =>
      Array.from(new Set([...previous, ...topics.map((topic) => topic.title.slice(0, EXCLUDE_MAX_CHARS))])).slice(
        -EXCLUDE_MAX_ITEMS,
      ),
    );
    setRound((previous) => previous + 1);
    setChoice((current) => (current === CUSTOM ? current : null));
  }

  function startGeneration() {
    if (!topicText || publishInvalid) return;
    const startedNow = Date.now();
    setStartedAt(startedNow);
    setNow(startedNow);
    onBusyChange(true);
    generate.mutate({ topic: topicText, publishedAt }, { onSettled: () => onBusyChange(false) });
  }

  // ---- Generating ---------------------------------------------------------
  if (generate.isPending) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("generating.title")}</DialogTitle>
          <DialogDescription>{t("generating.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4" role="status" aria-live="polite">
          <p className="rounded-md bg-muted px-3 py-2 text-sm">{topicText}</p>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="absolute inset-y-0 w-2/5 rounded-full bg-primary animate-indeterminate motion-reduce:animate-pulse motion-reduce:inset-x-0 motion-reduce:w-full" />
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {t("generating.elapsed", { time: formatElapsed(Math.max(0, Math.floor((now - startedAt) / 1000))) })}
          </p>
          <p className="text-xs text-muted-foreground">{t("generating.keepOpen")}</p>
        </div>
      </>
    );
  }

  // ---- Done ---------------------------------------------------------------
  if (generate.isSuccess) {
    const { post, warnings } = generate.data;
    const state = getPostState(post.publishedAt);
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("done.title")}</DialogTitle>
          <DialogDescription>
            {t("done.description", { title: post.title })}{" "}
            {state === "draft"
              ? t("done.draft")
              : state === "scheduled"
                ? t("done.scheduled", { date: formatInZone(post.publishedAt, timeZone, locale) })
                : t("done.live")}
          </DialogDescription>
        </DialogHeader>
        {warnings.length > 0 ? (
          <Alert>
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{t("done.warnings")}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("done.close")}
          </Button>
          <Button asChild>
            <Link href={`/admin/posts/${post.id}`}>
              <FileText data-icon="inline-start" aria-hidden="true" />
              {t("done.open")}
            </Link>
          </Button>
        </DialogFooter>
      </>
    );
  }

  // ---- Choosing a topic ---------------------------------------------------
  // A dropped connection can happen after the server finished: the article may exist already.
  // (Gateway timeouts already say so in their own message.)
  const connectionLost = generate.isError && isApiError(generate.error) && generate.error.status === 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>

      {generate.isError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t("error.title")}</AlertTitle>
          <AlertDescription>
            {errorMessage(generate.error)}
            {connectionLost ? ` ${t("error.maybeSaved")}` : ""}
          </AlertDescription>
        </Alert>
      ) : null}

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("topics.heading")}</legend>

        {topicsQuery.isFetching ? (
          <div className="grid gap-2" aria-busy="true">
            <p className="text-sm text-muted-foreground" role="status">
              {t("topics.loading")}
            </p>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[66px] w-full rounded-lg" />
            ))}
          </div>
        ) : topicsQuery.isError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{t("topics.error", { message: errorMessage(topicsQuery.error) })}</span>
              <Button variant="outline" size="sm" onClick={() => topicsQuery.refetch()}>
                {t("topics.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          topics.map((topic) => (
            <TopicOption
              key={topic.title}
              checked={choice === topic.title}
              onSelect={() => setChoice(topic.title)}
              title={topic.title}
              description={topic.angle}
              warning={topic.overlap ? t("topics.overlap", { reason: topic.overlap }) : null}
            />
          ))
        )}

        <TopicOption
          checked={choice === CUSTOM}
          onSelect={() => setChoice(CUSTOM)}
          title={t("custom.option")}
        >
          {choice === CUSTOM ? (
            <Textarea
              autoFocus
              rows={2}
              maxLength={TOPIC_MAX_CHARS}
              aria-label={t("custom.label")}
              placeholder={t("custom.placeholder")}
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              className="mt-2 bg-background"
            />
          ) : null}
        </TopicOption>

        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={showOtherTopics}
            disabled={topicsQuery.isFetching}
          >
            <RefreshCw data-icon="inline-start" aria-hidden="true" className={cn(topicsQuery.isFetching && "animate-spin")} />
            {t("topics.other")}
          </Button>
        </div>
      </fieldset>

      <Field
        label={t("publish.label")}
        hint={t("publish.hint", { timezone: timeZone })}
        error={publishInvalid ? t("publish.invalid") : undefined}
      >
        <Input type="datetime-local" value={publishLocal} onChange={(event) => setPublishLocal(event.target.value)} className="w-full sm:w-64" />
      </Field>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button onClick={startGeneration} disabled={!topicText || publishInvalid}>
          {generate.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Sparkles data-icon="inline-start" aria-hidden="true" />}
          {t("submit")}
        </Button>
      </DialogFooter>
    </>
  );
}

/** A radio presented as a card. The native input stays in the tab order (visually hidden). */
function TopicOption({
  checked,
  onSelect,
  title,
  description,
  warning,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  warning?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        checked ? "border-primary bg-muted/60" : "hover:bg-muted/40",
      )}
    >
      <label className="block cursor-pointer">
        <input type="radio" name="topic" className="sr-only" checked={checked} onChange={onSelect} />
        <span className="block font-medium">{title}</span>
        {description ? <span className="mt-0.5 block text-muted-foreground">{description}</span> : null}
        {warning ? (
          <span className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {warning}
          </span>
        ) : null}
      </label>
      {children}
    </div>
  );
}
