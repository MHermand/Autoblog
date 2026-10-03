# Architecture

Autoblog is a single-tenant Next.js app: one deployment = one blog. Supabase
provides Postgres, Auth (magic link) and Storage. All database access happens
on the server with the service-role key; the browser never talks to the
database directly.

```
src/
  core/            Pure TypeScript, no I/O. Unit-tested.
    types.ts       Shared domain types (source of truth)
    settings.ts    zod schema + defaults for BlogSettings
    slug.ts        slugify, nextAvailableSlug
    schedule.ts    next publication slot, re-spacing (timezone-aware)
    topics.ts      topic prompt, parsing, overlap detection
    prompts.ts     system / article / title-fix prompts
    article.ts     LLM JSON parsing, sections -> Markdown, image placement
    seo.ts         title normalization, meta clamping
    markdown.ts    Markdown -> sanitized HTML
    llm/           Provider adapters (Gemini, OpenAI, Anthropic), fetch only
  server/          Server-only: Supabase access, auth, generation pipeline
  app/             Routes (UI + API)
  components/      UI
  i18n/, messages/ next-intl (en, fr) for the admin UI
supabase/migrations/
```

## Data model

`posts`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| slug | text unique | |
| title | text | |
| excerpt | text | |
| content_markdown | text | source of truth for the body |
| cover_image_url, cover_image_alt | text null | |
| tags | text[] | |
| meta_title, meta_description | text | |
| lang | text | |
| source | text | `manual` or `auto` |
| published_at | timestamptz null | null = draft, future = scheduled, past = live |
| created_at, updated_at | timestamptz | |

`settings`: a single row (`id = 1`) holding `data jsonb` (a `BlogSettings`,
validated and defaulted by `src/core/settings.ts`).

RLS is enabled on both tables with no policy: only the service role can read or
write. Public visibility is decided in code: a post is public when
`published_at <= now()`.

Storage: public bucket `autoblog-images`, objects under `posts/<uuid>/<name>.<ext>`.

## Environment

| variable | required | purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Auth session only |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server-side DB + storage |
| `ADMIN_EMAILS` | yes | comma-separated allowlist |
| `CRON_SECRET` | yes | protects `/api/cron/tick` |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | at least one | |
| `PUBLIC_API_ALLOWED_ORIGINS` | no | comma-separated, default `*` |

API keys are never stored in the database.

## HTTP API

All JSON. Errors: `{ "error": string }` with a 4xx/5xx status.

### Public (CORS per `PUBLIC_API_ALLOWED_ORIGINS`, cacheable)

- `GET /api/posts?page=1&limit=20&tag=foo` →
  `{ posts: PublicPostSummary[], page, limit, total }`
  (limit max 100, newest first, live posts only)
- `GET /api/posts/:slug` → `{ post: PublicPost }` or 404

```ts
type PublicPostSummary = {
  slug: string; title: string; excerpt: string;
  coverImageUrl: string | null; coverImageAlt: string | null;
  tags: string[]; lang: string; publishedAt: string;
  metaTitle: string; metaDescription: string;
};
type PublicPost = PublicPostSummary & {
  contentMarkdown: string;
  contentHtml: string;   // sanitized
  readingTimeMinutes: number;
  updatedAt: string;
};
```

Responses send `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`.

### Auth

- `POST /api/auth/magic-link` `{ email }` → `{ ok: true }` (always `ok` to avoid
  leaking the allowlist; a link is only sent to allowlisted emails)
- `GET /auth/callback?code=…` → exchanges the code, redirects to `/admin`
- `POST /api/auth/sign-out` → `{ ok: true }`
- `GET /api/auth/me` → `{ email: string }` (401 when signed out)

`/admin/**` and `/api/admin/**` require a session whose email is in
`ADMIN_EMAILS` (pages redirect to `/login`, API returns 401/403).

### Admin

- `GET /api/admin/settings` → `{ settings: BlogSettings, automation: AutomationStatus, providers: ProviderAvailability }`
- `PUT /api/admin/settings` `{ settings: BlogSettings }` → same shape as GET.
  When `automation.publishHour`, `automation.rule` or `timezone` changes,
  upcoming auto posts are re-spaced.
- `GET /api/admin/posts?page=1&limit=20&q=&state=all|draft|scheduled|live` →
  `{ posts: Post[], page, limit, total }`
- `GET /api/admin/posts/:id` → `{ post: Post }`
- `PATCH /api/admin/posts/:id` with any of
  `title, slug, excerpt, contentMarkdown, coverImageUrl, coverImageAlt, tags, metaTitle, metaDescription, publishedAt`
  → `{ post: Post }` (409 `{ error: "slug_taken" }` on slug conflict)
- `DELETE /api/admin/posts/:id` → `{ ok: true }`
- `GET /api/admin/slug-check?slug=…&excludeId=…` → `{ available: boolean, suggestion: string }`
- `POST /api/admin/topics` `{ count?: number (1-5, default 3), exclude?: string[] }` →
  `{ topics: TopicSuggestion[] }`
- `POST /api/admin/generate` `{ topic: string, publishedAt?: string | null }` →
  `{ post: Post, warnings: string[] }` (long request: up to ~2 min)
- `POST /api/admin/upload` multipart `file` (jpeg/png/webp/gif, ≤ 4 MB) → `{ url: string }`

```ts
type AutomationStatus = {
  nextSlot: string | null;      // ISO, null when disabled or stock full
  upcomingAutoCount: number;    // scheduled auto posts in the future
  lastAutoPublishedAt: string | null;
};
type ProviderAvailability = {
  text: Record<"gemini" | "openai" | "anthropic", boolean>; // API key present
  image: Record<"gemini" | "openai", boolean>;
};
```

### Cron

- `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` →
  `{ ok: true, generated: number, reason?: string }`.
  Generates at most 2 articles per call (the next empty slots within the
  horizon). Scheduled daily by `vercel.json`; any external cron can call it
  more often.

## Generation pipeline

1. Load settings and recent posts (last 60 days, including scheduled ones).
2. Topic: suggested by the LLM (`topics.ts`), mechanically filtered for overlap.
3. Article: one LLM call returning strict JSON (`GeneratedArticle`).
4. Title: normalized; if issues remain, one cheap LLM call to fix it.
5. Images (if an image provider is set): cover + `bodyImageCount` body images,
   in parallel, uploaded to Storage. A failed image is skipped, never fatal.
6. Markdown assembled from sections with body images spread between sections.
7. Insert with a unique slug.

## Known limitations

- Deleting a post does not delete its images from Storage, and a generation
  interrupted after the image upload can leave orphan files. They are small
  and harmless; clean `autoblog-images` from the Supabase dashboard if needed.
- Two overlapping automation ticks can, in a window of a few milliseconds,
  create two auto posts for the same slot (see `src/server/generation.ts`).
- Request bodies are read before their size is checked when no
  `Content-Length` is sent. Vercel caps bodies at 4.5 MB; behind another host,
  put a body-size limit in your reverse proxy.
