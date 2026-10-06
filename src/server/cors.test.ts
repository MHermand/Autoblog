import { describe, expect, it } from "vitest";
import { normalizeOrigin, parseAllowedOrigins, publicCorsHeaders, resolveAllowOrigin } from "./cors";

describe("parseAllowedOrigins", () => {
  it("defaults to any origin when unset, blank or containing *", () => {
    expect(parseAllowedOrigins(undefined)).toBe("*");
    expect(parseAllowedOrigins("  ")).toBe("*");
    expect(parseAllowedOrigins("https://a.com, *")).toBe("*");
  });

  it("normalizes entries and drops invalid ones", () => {
    expect(parseAllowedOrigins("https://Example.com/, http://localhost:3000, not a url, ftp://x.io")).toEqual([
      "https://example.com",
      "http://localhost:3000",
    ]);
  });

  it("never widens to * when every entry is invalid", () => {
    expect(parseAllowedOrigins("nope")).toEqual([]);
  });
});

describe("normalizeOrigin", () => {
  it("keeps scheme, host and non-default port only", () => {
    expect(normalizeOrigin("https://www.Example.com:443/blog?x=1")).toBe("https://www.example.com");
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("rejects the opaque 'null' origin and non-http schemes", () => {
    expect(normalizeOrigin("null")).toBeNull();
    expect(normalizeOrigin("chrome-extension://abc")).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
  });
});

describe("resolveAllowOrigin", () => {
  const allowed = parseAllowedOrigins("https://example.com");

  it("echoes an allowed origin", () => {
    expect(resolveAllowOrigin("https://example.com", allowed)).toBe("https://example.com");
    expect(resolveAllowOrigin("https://EXAMPLE.com", allowed)).toBe("https://example.com");
  });

  it("refuses other origins, look-alikes and a missing origin", () => {
    expect(resolveAllowOrigin("https://example.com.evil.io", allowed)).toBeNull();
    expect(resolveAllowOrigin("http://example.com", allowed)).toBeNull();
    expect(resolveAllowOrigin(null, allowed)).toBeNull();
  });

  it("returns * in wildcard mode", () => {
    expect(resolveAllowOrigin(null, "*")).toBe("*");
  });
});

describe("publicCorsHeaders", () => {
  it("adds Vary: Origin only when the origin is echoed from a list", () => {
    expect(publicCorsHeaders("https://x.io", "*")).toMatchObject({ "Access-Control-Allow-Origin": "*" });
    expect(publicCorsHeaders("https://x.io", "*").Vary).toBeUndefined();

    const listed = publicCorsHeaders("https://x.io", ["https://x.io"]);
    expect(listed["Access-Control-Allow-Origin"]).toBe("https://x.io");
    expect(listed.Vary).toBe("Origin");

    const refused = publicCorsHeaders("https://y.io", ["https://x.io"]);
    expect(refused["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(refused.Vary).toBe("Origin");
  });
});
