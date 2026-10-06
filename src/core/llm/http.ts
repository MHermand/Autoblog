// Shared HTTP plumbing for the provider adapters: a JSON POST with a timeout,
// ONE retry on transient failures, and error messages that never leak secrets.
// Plain `fetch` only (injected for tests), no Next/Supabase imports.

export const DEFAULT_TEXT_TIMEOUT_MS = 120_000;
export const DEFAULT_IMAGE_TIMEOUT_MS = 90_000;

const DEFAULT_RETRY_DELAY_MS = 1_000;
/** A provider asking us to wait longer than this is not worth blocking a request for. */
const MAX_RETRY_DELAY_MS = 5_000;
const MAX_ATTEMPTS = 2;
const MAX_ERROR_CHARS = 300;

/** Thrown when a provider is selected but its API key is not configured. */
export class MissingApiKeyError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`Missing API key for "${provider}" (set ${provider.toUpperCase()}_API_KEY)`);
    this.name = "MissingApiKeyError";
    this.provider = provider;
  }
}

/**
 * Any failure while talking to a provider: HTTP errors, timeouts, blocked or
 * truncated generations. `retryable` tells the caller whether trying again
 * later could plausibly succeed (the adapters already retry once on their own).
 */
export class LlmError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    provider: string,
    message: string,
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(`${provider}: ${message}`);
    this.name = "LlmError";
    this.provider = provider;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

/** Per-instance knobs; production code leaves everything undefined. */
export interface HttpOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Delay before the single retry. Tests set 0. */
  retryDelayMs?: number;
}

export interface PostJsonRequest extends HttpOptions {
  provider: string;
  url: string;
  /** Auth and version headers. `content-type: application/json` is added here. */
  headers: Record<string, string>;
  body: unknown;
  /** Only used to scrub error messages; it is never sent anywhere by this module. */
  apiKey: string;
}

/**
 * POSTs `body` as JSON and returns the parsed JSON response.
 * Retries once on 429, 5xx and connection errors. A timeout is NOT retried:
 * a model that did not answer within the budget would only burn it twice.
 */
export async function postJson(req: PostJsonRequest): Promise<unknown> {
  const fetchImpl = req.fetchImpl ?? fetch;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS;
  const baseDelayMs = req.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const payload = JSON.stringify(req.body);

  for (let attempt = 1; ; attempt++) {
    const canRetry = attempt < MAX_ATTEMPTS;
    let status = 0;
    let text = "";
    let retryAfterMs: number | undefined;

    try {
      const response = await fetchImpl(req.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...req.headers },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      text = await response.text();
    } catch (err) {
      if (isTimeout(err)) {
        throw new LlmError(req.provider, `request timed out after ${timeoutMs} ms`, {
          retryable: true,
        });
      }
      if (!canRetry) {
        throw new LlmError(
          req.provider,
          `network error: ${redact(describeError(err), req.apiKey)}`,
          { retryable: true },
        );
      }
      await sleep(baseDelayMs);
      continue;
    }

    if (status >= 200 && status < 300) {
      try {
        return JSON.parse(text);
      } catch {
        throw new LlmError(req.provider, "response body was not valid JSON", { status });
      }
    }

    const retryable = status === 429 || status >= 500;
    if (retryable && canRetry) {
      await sleep(Math.min(retryAfterMs ?? baseDelayMs, MAX_RETRY_DELAY_MS));
      continue;
    }
    throw new LlmError(
      req.provider,
      `HTTP ${status}: ${truncate(redact(errorDetail(text), req.apiKey))}`,
      { status, retryable },
    );
  }
}

export function truncate(text: string, max = MAX_ERROR_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function base64ToBytes(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}

/** Provider error bodies are JSON with `error.message`; fall back to the raw text. */
function errorDetail(text: string): string {
  try {
    const message = (JSON.parse(text) as { error?: { message?: unknown } })?.error?.message;
    if (typeof message === "string") return message;
  } catch {
    // not JSON
  }
  return text;
}

/**
 * Removes the exact key, plus anything shaped like a provider key, in case an
 * upstream error echoes (part of) the credential back.
 */
function redact(text: string, apiKey: string): string {
  const withoutKey = apiKey ? text.split(apiKey).join("[redacted]") : text;
  return withoutKey.replace(/\b(?:sk-[\w-]{8,}|AIza[\w-]{16,})/g, "[redacted]");
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? `${err.message} (${code})` : err.message;
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
