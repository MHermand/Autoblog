// Typed client for the Autoblog HTTP API (see docs/architecture.md).
// Every function throws an `ApiError` on failure; a 401 also sends the browser
// to /login.

import type {
  AutomationStatus,
  BlogSettings,
  Post,
  ProviderAvailability,
  TopicSuggestion,
} from "@/core/types";

// ---- Response shapes ---------------------------------------------------------

export type { AutomationStatus, ProviderAvailability };

export interface SettingsResponse {
  settings: BlogSettings;
  automation: AutomationStatus;
  providers: ProviderAvailability;
}

export type PostStateFilter = "all" | "draft" | "scheduled" | "live";

export interface ListPostsParams {
  page?: number;
  limit?: number;
  q?: string;
  state?: PostStateFilter;
}

export interface PostsPage {
  posts: Post[];
  page: number;
  limit: number;
  total: number;
}

export type PostPatch = Partial<
  Pick<
    Post,
    | "title"
    | "slug"
    | "excerpt"
    | "contentMarkdown"
    | "coverImageUrl"
    | "coverImageAlt"
    | "tags"
    | "metaTitle"
    | "metaDescription"
    | "publishedAt"
  >
>;

export interface SlugCheck {
  available: boolean;
  suggestion: string;
}

export interface GenerateResult {
  post: Post;
  warnings: string[];
}

// ---- Errors ------------------------------------------------------------------

export interface ApiErrorDetails {
  /** Human-readable explanation sent by the server next to the code (English). */
  message?: string;
  /** Validation problems of a 400 `invalid_request`. */
  issues?: { path: string; message: string }[];
  /** Provider involved in an `llm_error` or `missing_api_key`. */
  provider?: string;
}

/** Thrown for any non-2xx response and for network failures (status 0). */
export class ApiError extends Error {
  readonly status: number;
  /**
   * The machine code from the server's `{ error }` ("slug_taken", "llm_error"...),
   * or a synthetic one: "network_error" (status 0) and "http_<status>" when the
   * response had no JSON body (e.g. a gateway timeout page).
   */
  readonly code: string;
  readonly details: ApiErrorDetails;

  constructor(status: number, code: string, details: ApiErrorDetails = {}) {
    super(details.message ?? code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

// ---- Transport ---------------------------------------------------------------

let redirectingToLogin = false;

/**
 * Sends the browser to /login with a full page load, which also drops every
 * piece of client state (query cache, forms) belonging to the old session.
 */
export function redirectToLogin(): void {
  if (typeof window === "undefined" || redirectingToLogin) return;
  if (window.location.pathname.startsWith("/login")) return;
  redirectingToLogin = true;
  window.location.replace("/login");
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null; // empty or non-JSON body (e.g. a gateway timeout page)
  }
}

/** Reads the server's `{ error, message?, issues?, provider? }` error body. */
function parseErrorBody(body: unknown): { code: string | null; details: ApiErrorDetails } {
  if (!body || typeof body !== "object") return { code: null, details: {} };
  const record = body as Record<string, unknown>;
  const details: ApiErrorDetails = {};
  if (typeof record.message === "string") details.message = record.message;
  if (typeof record.provider === "string") details.provider = record.provider;
  if (Array.isArray(record.issues)) {
    details.issues = record.issues.flatMap((issue) =>
      issue && typeof issue === "object" && typeof (issue as { message?: unknown }).message === "string"
        ? [{ path: String((issue as { path?: unknown }).path ?? ""), message: (issue as { message: string }).message }]
        : [],
    );
  }
  return { code: typeof record.error === "string" && record.error ? record.error : null, details };
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  body?: FormData;
  signal?: AbortSignal;
}

async function request<T>(path: string, { method = "GET", json, body, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : body,
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "network_error");
  }

  const data = await readJson(res);
  if (res.status === 401) {
    redirectToLogin();
    throw new ApiError(401, parseErrorBody(data).code ?? "unauthorized");
  }
  if (!res.ok) {
    const { code, details } = parseErrorBody(data);
    throw new ApiError(res.status, code ?? `http_${res.status}`, details);
  }
  return data as T;
}

// ---- Auth --------------------------------------------------------------------

export const requestMagicLink = (email: string) =>
  request<{ ok: true }>("/api/auth/magic-link", { method: "POST", json: { email } });

export const getMe = () => request<{ email: string }>("/api/auth/me");

export const signOut = () => request<{ ok: true }>("/api/auth/sign-out", { method: "POST" });

// ---- Settings ----------------------------------------------------------------

export const getSettings = () => request<SettingsResponse>("/api/admin/settings");

export const saveSettings = (settings: BlogSettings) =>
  request<SettingsResponse>("/api/admin/settings", { method: "PUT", json: { settings } });

// ---- Posts -------------------------------------------------------------------

export function listPosts({ page = 1, limit = 20, q = "", state = "all" }: ListPostsParams = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), state });
  if (q.trim()) params.set("q", q.trim());
  return request<PostsPage>(`/api/admin/posts?${params}`);
}

export const getPost = (id: string) =>
  request<{ post: Post }>(`/api/admin/posts/${encodeURIComponent(id)}`);

export const updatePost = (id: string, patch: PostPatch) =>
  request<{ post: Post }>(`/api/admin/posts/${encodeURIComponent(id)}`, { method: "PATCH", json: patch });

export const deletePost = (id: string) =>
  request<{ ok: true }>(`/api/admin/posts/${encodeURIComponent(id)}`, { method: "DELETE" });

export function checkSlug(slug: string, excludeId?: string) {
  const params = new URLSearchParams({ slug });
  if (excludeId) params.set("excludeId", excludeId);
  return request<SlugCheck>(`/api/admin/slug-check?${params}`);
}

// ---- Generation --------------------------------------------------------------

export const suggestTopics = (body: { count?: number; exclude?: string[] } = {}) =>
  request<{ topics: TopicSuggestion[] }>("/api/admin/topics", { method: "POST", json: body });

/** Long request: the server writes the article and its images (1-2 minutes). */
export const generatePost = (body: { topic: string; publishedAt?: string | null }, signal?: AbortSignal) =>
  request<GenerateResult>("/api/admin/generate", { method: "POST", json: body, signal });

export function uploadImage(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<{ url: string }>("/api/admin/upload", { method: "POST", body: form });
}
