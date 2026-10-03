// HTTP API shapes from docs/architecture.md that are not domain types.
// Types only (no runtime code), so client components may import them too.

import type { Post } from "@/core/types";

export type { AutomationStatus, ProviderAvailability, PublicPost, PublicPostSummary } from "@/core/types";

/** Admin list filter: null published_at = draft, future = scheduled, past = live. */
export type PostState = "all" | "draft" | "scheduled" | "live";

export interface GeneratePostResult {
  post: Post;
  /** Non-fatal problems (e.g. an image that failed), human-readable. */
  warnings: string[];
}
