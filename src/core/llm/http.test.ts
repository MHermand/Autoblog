import { describe, expect, it } from "vitest";
import { LlmError, MissingApiKeyError, postJson } from "./http";
import { FAST, mockFetch, rejection } from "./test-utils";

const KEY = "sk-test-SECRET-1234567890";

function post(fetchImpl: typeof fetch, extra: Partial<Parameters<typeof postJson>[0]> = {}) {
  return postJson({
    provider: "test",
    url: "https://api.example.com/v1/x",
    headers: { authorization: `Bearer ${KEY}` },
    body: { hello: "world" },
    apiKey: KEY,
    fetchImpl,
    ...FAST,
    ...extra,
  });
}

describe("postJson", () => {
  it("POSTs JSON with a content-type header and parses the response", async () => {
    const { fetchImpl, calls } = mockFetch({ json: { ok: true } });
    await expect(post(fetchImpl)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(calls[0].body).toEqual({ hello: "world" });
  });

  it("retries once on 503 and succeeds", async () => {
    const { fetchImpl, calls } = mockFetch({ status: 503, text: "unavailable" }, { json: { ok: 1 } });
    await expect(post(fetchImpl)).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it("retries once on 429, then gives up with a retryable LlmError carrying the status", async () => {
    const { fetchImpl, calls } = mockFetch({ status: 429, text: "slow down" });
    const error = await rejection(post(fetchImpl));
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ provider: "test", status: 429, retryable: true });
    expect(calls).toHaveLength(2);
  });

  it("does not retry on 400", async () => {
    const { fetchImpl, calls } = mockFetch({ status: 400, json: { error: { message: "bad input" } } });
    const error = await rejection(post(fetchImpl));
    expect(error).toMatchObject({ status: 400, retryable: false });
    expect(error.message).toContain("bad input");
    expect(calls).toHaveLength(1);
  });

  it("retries once on a network error", async () => {
    const { fetchImpl, calls } = mockFetch(new TypeError("fetch failed"), { json: { ok: 1 } });
    await expect(post(fetchImpl)).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it("reports a persistent network error as retryable", async () => {
    const { fetchImpl, calls } = mockFetch(new TypeError("fetch failed"));
    const error = await rejection(post(fetchImpl));
    expect(error).toMatchObject({ retryable: true });
    expect(error.message).toContain("network error");
    expect(calls).toHaveLength(2);
  });

  it("times out without retrying", async () => {
    let calls = 0;
    const hanging = ((_url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }) as typeof fetch;
    const error = await rejection(post(hanging, { timeoutMs: 20 }));
    expect(error).toBeInstanceOf(LlmError);
    expect(error.message).toContain("timed out");
    expect(error.retryable).toBe(true);
    expect(calls).toBe(1);
  });

  it("truncates long error bodies", async () => {
    const { fetchImpl } = mockFetch({ status: 400, text: "x".repeat(5_000) });
    const error = await rejection(post(fetchImpl));
    expect(error.message.length).toBeLessThan(400);
  });

  it("never leaks the API key, even when the provider echoes it back", async () => {
    const echoing = mockFetch({
      status: 401,
      json: { error: { message: `Incorrect API key provided: ${KEY}. See docs.` } },
    });
    const httpError = await rejection(post(echoing.fetchImpl));
    expect(httpError.message).not.toContain(KEY);
    expect(httpError.message).not.toContain("SECRET");

    const leakyNetwork = mockFetch(new TypeError(`connect failed using ${KEY}`));
    const networkError = await rejection(post(leakyNetwork.fetchImpl));
    expect(networkError.message).not.toContain(KEY);
  });

  it("rejects a 200 response that is not JSON", async () => {
    const { fetchImpl } = mockFetch({ text: "<html>proxy error</html>" });
    const error = await rejection(post(fetchImpl));
    expect(error).toBeInstanceOf(LlmError);
    expect(error.message).toContain("not valid JSON");
  });
});

describe("MissingApiKeyError", () => {
  it("names the provider and the environment variable", () => {
    const error = new MissingApiKeyError("anthropic");
    expect(error.provider).toBe("anthropic");
    expect(error.message).toContain("ANTHROPIC_API_KEY");
  });
});
