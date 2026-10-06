"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, CircleAlert, ExternalLink, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CoverImageField } from "@/components/editor/cover-image-field";
import { Field } from "@/components/field";
import { Input } from "@/components/ui/input";
import { MarkdownPreview } from "@/components/editor/markdown-preview";
import { DeletePostDialog } from "@/components/posts/delete-post-dialog";
import { SourceBadge, StateBadge } from "@/components/posts/post-badges";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TagsInput } from "@/components/editor/tags-input";
import { Textarea } from "@/components/ui/textarea";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import { useSlugCheck } from "@/components/editor/use-slug-check";
import type { Post } from "@/core/types";
import { getPost, isApiError, updatePost, type PostPatch } from "@/lib/api";
import { browserTimeZone, formatInZone, getPostState, isoToZonedInput, zonedInputToIso } from "@/lib/datetime";
import {
  META_DESCRIPTION_MAX,
  META_TITLE_MAX,
  buildPostPatch,
  normalizeSlugInput,
  postToForm,
  SLUG_PATTERN,
  type PostFormState,
} from "@/lib/post-form";
import { queryKeys, useSettings } from "@/lib/queries";
import { useErrorMessage } from "@/lib/use-error-message";

/** Loads the post and the blog settings (for the timezone), then shows the form. */
export function PostEditor({ id }: { id: string }) {
  const t = useTranslations("editor");
  const errorMessage = useErrorMessage();
  const settings = useSettings();
  const post = useQuery({
    queryKey: queryKeys.post(id),
    queryFn: () => getPost(id),
    // Always start from the stored version: the form keeps its own copy once mounted.
    staleTime: 0,
    gcTime: 0,
  });

  if (post.isPending || settings.isPending) return <EditorSkeleton />;

  if (post.isError) {
    const notFound = isApiError(post.error) && (post.error.status === 404 || post.error.status === 400);
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert variant={notFound ? "default" : "destructive"}>
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{notFound ? t("notFound.title") : t("loadError")}</AlertTitle>
          <AlertDescription>{notFound ? t("notFound.body") : errorMessage(post.error)}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <PostForm
      key={post.data.post.id}
      post={post.data.post}
      timeZone={settings.data?.settings.timezone ?? browserTimeZone()}
    />
  );
}

function BackLink() {
  const t = useTranslations("editor");
  return (
    <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden="true" />
      {t("back")}
    </Link>
  );
}

function EditorSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-72" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[560px] rounded-xl" />
        <Skeleton className="h-[420px] rounded-xl" />
      </div>
    </div>
  );
}

function Counter({ length, max }: { length: number; max: number }) {
  return (
    <span className={length > max ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
      {length}/{max}
    </span>
  );
}

function PostForm({ post, timeZone }: { post: Post; timeZone: string }) {
  const t = useTranslations("editor");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();

  const [saved, setSaved] = useState(post);
  const [form, setForm] = useState<PostFormState>(() => postToForm(post, timeZone));
  const [submitted, setSubmitted] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const patch = buildPostPatch(saved, form, timeZone);
  const dirty = Object.keys(patch).length > 0;
  const slugStatus = useSlugCheck(form.slug, saved.id, saved.slug);

  const savedState = getPostState(saved.publishedAt);
  const formIso = form.publishedAtLocal ? zonedInputToIso(form.publishedAtLocal, timeZone) : null;
  const dateInvalid = form.publishedAtLocal !== "" && formIso === null;
  const formState = getPostState(formIso);

  const set = <K extends keyof PostFormState>(key: K, value: PostFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const titleError = form.title.trim() === "" ? t("errors.titleRequired") : undefined;
  const slugError =
    slugStatus.kind === "empty"
      ? t("slug.empty")
      : slugStatus.kind === "invalid"
        ? t("slug.invalid")
        : slugStatus.kind === "taken"
          ? t("slug.taken")
          : undefined;
  const dateError = dateInvalid ? t("publication.invalid") : undefined;
  // Problems that are shown as you type block saving right away; a missing title only after a first attempt.
  const blocked = Boolean(slugError || dateError || (submitted && titleError));

  const save = useMutation({
    mutationFn: (changes: PostPatch) => updatePost(saved.id, changes),
    onSuccess: ({ post: updated }) => {
      setSaved(updated);
      setForm(postToForm(updated, timeZone));
      setSubmitted(false);
      queryClient.setQueryData(queryKeys.post(updated.id), { post: updated });
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings }); // upcoming count
      toast.success(t("saved"));
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ["slug-check"] });
        toast.error(t("slug.taken"));
      } else {
        toast.error(errorMessage(error));
      }
    },
  });

  /** Saves everything that changed, optionally overriding some fields first. */
  function submit(overrides: Partial<PostFormState> = {}) {
    setSubmitted(true);
    const candidate = { ...form, ...overrides };
    const changes = buildPostPatch(saved, candidate, timeZone);
    if (candidate.title.trim() === "" || !SLUG_PATTERN.test(candidate.slug) || slugStatus.kind === "taken" || dateInvalid) {
      requestAnimationFrame(() => {
        const field = document.querySelector<HTMLElement>('form [aria-invalid="true"]');
        field?.scrollIntoView({ block: "center", behavior: "smooth" });
        field?.focus({ preventScroll: true });
      });
      return;
    }
    if (Object.keys(changes).length === 0) return;
    save.mutate(changes);
  }

  function publishNow() {
    // Backdate by a minute so a slightly fast browser clock never leaves the
    // article "scheduled" on the server.
    const iso = new Date(Date.now() - 60_000).toISOString();
    submit({ publishedAtLocal: isoToZonedInput(iso, timeZone) });
  }

  return (
    <div className="space-y-6 pb-4">
      <UnsavedChangesGuard when={dirty} />
      <BackLink />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StateBadge state={savedState} />
            <SourceBadge source={saved.source} />
            <span>{t("updatedAt", { date: formatInZone(saved.updatedAt, timeZone, locale) })}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {savedState === "live" ? (
            <a
              href={`/api/posts/${encodeURIComponent(saved.slug)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ExternalLink data-icon="inline-start" aria-hidden="true" />
              {t("viewJson")}
            </a>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            {t("delete")}
          </Button>
        </div>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="space-y-6"
      >
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ---- Content ---- */}
          <Card>
            <CardContent className="gap-5">
              <Field label={t("fields.title")} error={submitted ? titleError : undefined}>
                <Input value={form.title} onChange={(event) => set("title", event.target.value)} maxLength={200} className="text-base font-medium" />
              </Field>

              <div className="grid gap-1.5">
                <Field
                  label={t("slug.label")}
                  hint={t("slug.hint")}
                  error={slugError}
                >
                  <Input
                    value={form.slug}
                    onChange={(event) => set("slug", normalizeSlugInput(event.target.value))}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="font-mono text-sm"
                  />
                </Field>
                <SlugStatusLine status={slugStatus} onUseSuggestion={(slug) => set("slug", slug)} />
              </div>

              <div className="grid gap-1.5">
                <span className="text-sm font-medium">{t("body.label")}</span>
                <Tabs defaultValue="write">
                  <TabsList>
                    <TabsTrigger value="write">{t("body.write")}</TabsTrigger>
                    <TabsTrigger value="preview">{t("body.preview")}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="write">
                    <Textarea
                      aria-label={t("body.label")}
                      value={form.contentMarkdown}
                      onChange={(event) => set("contentMarkdown", event.target.value)}
                      spellCheck
                      className="min-h-[480px] font-mono text-[13px] leading-relaxed"
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">{t("body.hint")}</p>
                  </TabsContent>
                  <TabsContent value="preview">
                    <div className="min-h-[480px] rounded-md border p-4 sm:p-6">
                      <MarkdownPreview markdown={form.contentMarkdown} />
                    </div>
                  </TabsContent>
                </Tabs>
              </div>

              <Field label={t("fields.excerpt")} hint={t("fields.excerptHint")}>
                <Textarea rows={3} value={form.excerpt} onChange={(event) => set("excerpt", event.target.value)} />
              </Field>
            </CardContent>
          </Card>

          {/* ---- Sidebar ---- */}
          <div className="space-y-6">
            <Card size="sm">
              <CardHeader>
                <CardTitle>{t("publication.title")}</CardTitle>
                <CardDescription>{t("publication.description", { timezone: timeZone })}</CardDescription>
              </CardHeader>
              <CardContent>
                <Field label={t("publication.label")} error={dateError}>
                  <Input
                    type="datetime-local"
                    value={form.publishedAtLocal}
                    onChange={(event) => set("publishedAtLocal", event.target.value)}
                  />
                </Field>
                <p className="flex items-center gap-2 text-sm" aria-live="polite">
                  <StateBadge state={formState} />
                  <span className="text-muted-foreground">{t(`publication.status.${formState}`)}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {formState !== "live" ? (
                    <Button type="button" size="sm" variant="secondary" onClick={publishNow} disabled={save.isPending}>
                      {t("publication.publishNow")}
                    </Button>
                  ) : null}
                  {form.publishedAtLocal !== "" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => submit({ publishedAtLocal: "" })}
                      disabled={save.isPending}
                    >
                      {formState === "scheduled" ? t("publication.unschedule") : t("publication.unpublish")}
                    </Button>
                  ) : null}
                </div>
                {formState !== "live" ? <p className="text-xs text-muted-foreground">{t("publication.publishNowHint")}</p> : null}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>{t("cover.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <CoverImageField
                  url={form.coverImageUrl}
                  alt={form.coverImageAlt}
                  onUrlChange={(value) => set("coverImageUrl", value)}
                  onAltChange={(value) => set("coverImageAlt", value)}
                />
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>{t("tags.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Field label={t("tags.label")} hint={t("tags.hint")}>
                  <TagsInput
                    value={form.tags}
                    onChange={(tags) => set("tags", tags)}
                    placeholder={t("tags.placeholder")}
                    removeLabel={(tag) => t("tags.remove", { tag })}
                  />
                </Field>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>{t("seo.title")}</CardTitle>
                <CardDescription>{t("seo.description")}</CardDescription>
              </CardHeader>
              <CardContent className="gap-4">
                <Field label={t("seo.metaTitle")} aside={<Counter length={form.metaTitle.length} max={META_TITLE_MAX} />}>
                  <Input value={form.metaTitle} onChange={(event) => set("metaTitle", event.target.value)} />
                </Field>
                <Field label={t("seo.metaDescription")} aside={<Counter length={form.metaDescription.length} max={META_DESCRIPTION_MAX} />}>
                  <Textarea rows={3} value={form.metaDescription} onChange={(event) => set("metaDescription", event.target.value)} />
                </Field>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ---- Save bar ---- */}
        <div className="sticky bottom-0 z-30 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
              {blocked ? (
                <>
                  <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
                  <span className="text-destructive">{t("errors.fixFields")}</span>
                </>
              ) : dirty ? (
                t("unsaved")
              ) : (
                <>
                  <Check className="size-4" aria-hidden="true" />
                  {t("allSaved")}
                </>
              )}
            </p>
            <div className="flex gap-2">
              {dirty ? (
                <Button type="button" variant="ghost" onClick={() => {
                    setForm(postToForm(saved, timeZone));
                    setSubmitted(false);
                  }}
                  disabled={save.isPending}
                >
                  {t("discard")}
                </Button>
              ) : null}
              <Button type="submit" disabled={!dirty || save.isPending || blocked}>
                {save.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Save data-icon="inline-start" aria-hidden="true" />}
                {save.isPending ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        </div>
      </form>

      <DeletePostDialog
        post={deleting ? { id: saved.id, title: saved.title } : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => router.push("/admin")}
      />
    </div>
  );
}

function SlugStatusLine({ status, onUseSuggestion }: { status: ReturnType<typeof useSlugCheck>; onUseSuggestion: (slug: string) => void }) {
  const t = useTranslations("editor.slug");

  return (
    <div className="text-xs empty:hidden" aria-live="polite">
      {status.kind === "checking" ? (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          {t("checking")}
        </span>
      ) : status.kind === "available" ? (
        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
          <Check className="size-3" aria-hidden="true" />
          {t("available")}
        </span>
      ) : status.kind === "taken" ? (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-muted-foreground">
          {t("suggestion")}
          <button
            type="button"
            onClick={() => onUseSuggestion(status.suggestion)}
            className="rounded-sm font-mono font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {status.suggestion}
          </button>
        </span>
      ) : null}
    </div>
  );
}
