import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, checkSlug, listPosts, updatePost } from "./api";

function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => impl(String(url), init ?? {}));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("builds the list query and returns the parsed body", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ posts: [], page: 2, limit: 20, total: 0 }));
    const result = await listPosts({ page: 2, q: "  notary ", state: "live" });
    expect(result.page).toBe(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/posts?page=2&limit=20&state=live&q=notary");
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
  });

  it("sends only the given fields on PATCH, as JSON", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ post: { id: "p1" } }));
    await updatePost("p 1", { title: "New", publishedAt: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/posts/p%201");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ title: "New", publishedAt: null });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("encodes the slug-check query", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ available: true, suggestion: "a-b" }));
    await checkSlug("a b", "id-1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/slug-check?slug=a+b&excludeId=id-1");
  });

  it("throws an ApiError carrying the status and the server code", async () => {
    mockFetch(() => jsonResponse({ error: "slug_taken" }, 409));
    await expect(updatePost("p1", { slug: "x" })).rejects.toMatchObject({ name: "ApiError", status: 409, code: "slug_taken" });
  });

  it("keeps the server's message, provider and validation issues", async () => {
    mockFetch(() =>
      jsonResponse(
        { error: "invalid_request", issues: [{ path: "settings.tone", message: "Too long" }, { nope: true }], provider: "gemini", message: "bad" },
        400,
      ),
    );
    const error = await listPosts().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).details).toEqual({
      message: "bad",
      provider: "gemini",
      issues: [{ path: "settings.tone", message: "Too long" }],
    });
  });

  it("falls back to http_<status> when the body is not JSON", async () => {
    mockFetch(() => new Response("<html>Gateway Timeout</html>", { status: 504 }));
    await expect(listPosts()).rejects.toMatchObject({ status: 504, code: "http_504" });
  });

  it("reports network failures as status 0", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(listPosts()).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("throws on 401 (the redirect to /login only happens in a browser)", async () => {
    mockFetch(() => jsonResponse({ error: "unauthorized" }, 401));
    await expect(listPosts()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
  });
});
