// Database types for supabase-js, matching supabase/migrations/*_init.sql.
// Hand-written (the schema is tiny); keep in sync with the migrations.

export type PostRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content_markdown: string;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  tags: string[];
  meta_title: string;
  meta_description: string;
  lang: string;
  /** "manual" | "auto" (enforced by a check constraint). */
  source: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PostInsertRow = {
  id?: string;
  slug: string;
  title: string;
  excerpt?: string;
  content_markdown?: string;
  cover_image_url?: string | null;
  cover_image_alt?: string | null;
  tags?: string[];
  meta_title?: string;
  meta_description?: string;
  lang?: string;
  source?: string;
  published_at?: string | null;
};

/** Columns an update may touch. id, source, lang and timestamps are never updated from the API. */
export type PostUpdateRow = {
  slug?: string;
  title?: string;
  excerpt?: string;
  content_markdown?: string;
  cover_image_url?: string | null;
  cover_image_alt?: string | null;
  tags?: string[];
  meta_title?: string;
  meta_description?: string;
  published_at?: string | null;
};

export type SettingsRow = {
  id: number;
  data: unknown;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      posts: {
        Row: PostRow;
        Insert: PostInsertRow;
        Update: PostUpdateRow;
        Relationships: [];
      };
      settings: {
        Row: SettingsRow;
        Insert: { id?: number; data?: unknown };
        Update: { data?: unknown };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
