# Autoblog

**Self-hosted, white-label AI blog generator.** Autoblog plans, writes,
illustrates and schedules SEO articles for your brand, then serves them through
a simple JSON API so you can plug them into any website.

*[Version française](README.fr.md)*

- ✍️ **Writes like your brand**: name, audience, tone, language, company
  context and call to action are all settings, not code.
- 🧭 **Picks fresh topics**: suggests subjects from your guidelines and
  mechanically rejects anything too close to what you published recently.
- 🖼️ **Illustrates**: a cover and up to 3 body images, in your visual style.
- 🗓️ **Runs on autopilot**: every N days, on given weekdays or monthly, at
  your local hour, with up to 30 days of articles generated in advance.
- 🔌 **Plugs into anything**: `GET /api/posts` returns HTML *and* Markdown
  with SEO fields. Works with Next.js, Astro, Nuxt, WordPress, Webflow, a
  static page… anything that can fetch JSON.
- 🤖 **Bring your own AI**: Google Gemini, OpenAI or Anthropic for text; Gemini
  or OpenAI for images. Your keys stay in your environment.
- 🌍 Admin UI in English and French. Articles in any language.

## How it works

```
 Settings ──▶ Topic suggestion ──▶ Article (LLM, strict JSON) ──▶ Images ──▶ Markdown + SEO
                 ▲   overlap check                                              │
                 └──────────── recent posts ◀───────────── Postgres ◀───────────┘
                                                              │
                         your site ◀── GET /api/posts ◀───────┘   (only posts whose date has passed)
```

One deployment = one blog. A post with no date is a draft, a future date means
scheduled, a past date means live. Nothing else to manage.

## Deploy (about 10 minutes)

You need a free [Supabase](https://supabase.com) project, a
[Vercel](https://vercel.com) account and at least one AI API key.

1. **Create the database.** In a new Supabase project, open *SQL Editor* and
   run the content of [`supabase/migrations/`](supabase/migrations) (or
   `supabase db push` with the Supabase CLI).
2. **Deploy.**

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMHermand%2FAutoblog&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,ADMIN_EMAILS,CRON_SECRET&envDescription=See%20.env.example%20for%20every%20variable&envLink=https%3A%2F%2Fgithub.com%2FMHermand%2FAutoblog%2Fblob%2Fmain%2F.env.example&project-name=autoblog&repository-name=autoblog)

   Then add at least one of `GEMINI_API_KEY`, `OPENAI_API_KEY`,
   `ANTHROPIC_API_KEY` in *Project Settings → Environment Variables* and
   redeploy. Every variable is documented in [`.env.example`](.env.example).
3. **Allow the login redirect.** In Supabase, *Authentication → URL
   Configuration*: set *Site URL* to your Vercel URL and add
   `https://<your-app>.vercel.app/auth/callback` to the redirect URLs.
   Keep `http://localhost:3000/auth/callback` there too for local development.
4. **Sign in** at `https://<your-app>.vercel.app/login` with an email listed in
   `ADMIN_EMAILS` (magic link, no password). Only allowlisted emails ever
   receive a link.

> **Production checklist (Supabase → Authentication).**
> - Supabase's built-in mailer only sends a few emails per hour: configure
>   custom SMTP (Resend, Postmark, Brevo…) for reliable magic links.
> - Keep *Confirm email* enabled (the default): admin access is granted to
>   the email of the session, so that email must be proven.
> - Once your admins have signed in once, disable new sign-ups.
> - Optional: so that a link opened in another browser still works, set the
>   *Magic Link* email template link to
>   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`.
5. **Configure** your brand in *Settings*, generate a first article, then open
   *Connect your site* for copy-paste integration snippets.

> **Automation and Vercel plans.** `vercel.json` calls the generator once a
> day, which is what the Hobby plan allows. Each call fills up to 2 empty
> slots, so a daily-or-slower rhythm keeps your stock full. Need more? Call
> `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` from any
> external scheduler (GitHub Actions, cron-job.org…).

## Plug it into your site

```js
const API = "https://<your-app>.vercel.app";

// List (newest first, live posts only)
const { posts, total } = await fetch(`${API}/api/posts?limit=10`).then((r) => r.json());

// One article: contentHtml is sanitized and ready to render
const { post } = await fetch(`${API}/api/posts/${slug}`).then((r) => r.json());
document.querySelector("#article").innerHTML = post.contentHtml;
```

| Endpoint | Returns |
|---|---|
| `GET /api/posts?page=1&limit=20&tag=…` | `{ posts, page, limit, total }`: title, slug, excerpt, cover, tags, SEO fields, date |
| `GET /api/posts/:slug` | `{ post }`: everything above plus `contentHtml`, `contentMarkdown`, `readingTimeMinutes` |

Responses are cacheable (`s-maxage=300`). Restrict which origins may call the
API from a browser with `PUBLIC_API_ALLOWED_ORIGINS`. Full contract:
[`docs/architecture.md`](docs/architecture.md).

## Develop locally

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project and an AI key
npm run dev
```

```bash
npm test        # unit tests (Vitest)
npm run lint
npm run build
```

Project layout and design decisions: [`docs/architecture.md`](docs/architecture.md).

## Costs

Autoblog itself is free. You pay your AI provider per article: with a fast
text model and 3 images, expect a few cents to a few tens of cents per article
depending on the provider and models you choose. Set the image provider to
`none` to generate text only.

## License

[MIT](LICENSE)
