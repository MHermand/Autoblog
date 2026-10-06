-- Autoblog initial schema. See docs/architecture.md ("Data model").
--
-- Security model: RLS is enabled on every table with NO policy, and the
-- anon/authenticated roles have no privileges. Only the service role (used
-- server-side by the Next.js app) can read or write. Public visibility of a
-- post (published_at <= now()) is decided in application code.
--
-- Written to be re-runnable: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- updated_at trigger function (plain plpgsql, no extension needed)
-- ---------------------------------------------------------------------------

create or replace function public.autoblog_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.autoblog_set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  excerpt text not null default '',
  -- Source of truth for the article body.
  content_markdown text not null default '',
  cover_image_url text,
  cover_image_alt text,
  tags text[] not null default '{}',
  meta_title text not null default '',
  meta_description text not null default '',
  lang text not null default 'en',
  source text not null default 'manual',
  -- null = draft, future = scheduled, past = live.
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_slug_key unique (slug),
  constraint posts_slug_length check (char_length(slug) between 1 and 200),
  constraint posts_source_check check (source in ('manual', 'auto'))
);

create index if not exists posts_published_at_idx on public.posts (published_at desc);
create index if not exists posts_tags_idx on public.posts using gin (tags);

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.autoblog_set_updated_at();

-- ---------------------------------------------------------------------------
-- settings: a single row (id = 1) holding a BlogSettings JSON document,
-- validated and defaulted by src/core/settings.ts.
-- ---------------------------------------------------------------------------

create table if not exists public.settings (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint settings_single_row check (id = 1)
);

insert into public.settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.autoblog_set_updated_at();

-- ---------------------------------------------------------------------------
-- Access control: service role only
-- ---------------------------------------------------------------------------

alter table public.posts enable row level security;
alter table public.settings enable row level security;

revoke all on table public.posts from anon, authenticated;
revoke all on table public.settings from anon, authenticated;
grant all on table public.posts to service_role;
grant all on table public.settings to service_role;

-- ---------------------------------------------------------------------------
-- Storage: public bucket for article images (objects: posts/<uuid>/<name>.<ext>)
-- Reads go through the public URL; writes only via the service role (no
-- storage.objects policy is created on purpose).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'autoblog-images',
  'autoblog-images',
  true,
  10485760, -- 10 MB (generated images can be large PNGs; manual uploads are capped at 4 MB by the API)
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
