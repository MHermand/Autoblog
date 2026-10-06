// Test helpers shared by the adapter tests. Not imported by production code.

import type { LlmError } from "./http";

export type MockReply =
  | { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }
  | Error;

export interface RecordedCall {
  url: string;
  method: string | undefined;
  headers: Headers;
  // Loosely typed on purpose: tests poke at nested request fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>;
}

/**
 * A fetch stub that answers with `replies` in order (the last one repeats) and
 * records every request. An `Error` reply makes fetch reject.
 */
export function mockFetch(...replies: MockReply[]) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return new Response(reply.text ?? JSON.stringify(reply.json ?? {}), {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** 1x1 transparent PNG. */
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

/** Instant retries and short timeouts so failure paths run fast. */
export const FAST = { retryDelayMs: 0, timeoutMs: 2_000 };

/** Awaits a promise that must reject and returns the error as an LlmError. */
export async function rejection(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (error) {
    return error as LlmError;
  }
  throw new Error("expected the promise to reject");
}
