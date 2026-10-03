import { describe, expect, it } from "vitest";
import { parsePagination, parseText } from "./params";

const qs = (query: string) => new URLSearchParams(query);

describe("parsePagination", () => {
  it("defaults to page 1, 20 per page", () => {
    expect(parsePagination(qs(""))).toEqual({ page: 1, limit: 20 });
  });

  it("clamps the limit to 100 and the page to at least 1", () => {
    expect(parsePagination(qs("page=0&limit=500"))).toEqual({ page: 1, limit: 100 });
    expect(parsePagination(qs("page=3&limit=0"))).toEqual({ page: 3, limit: 1 });
  });

  it("ignores non-integer values", () => {
    expect(parsePagination(qs("page=-2&limit=abc"))).toEqual({ page: 1, limit: 20 });
    expect(parsePagination(qs("page=1.5&limit=1e3"))).toEqual({ page: 1, limit: 20 });
  });
});

describe("parseText", () => {
  it("trims, caps the length and maps blank to null", () => {
    expect(parseText(qs("q=%20hello%20"), "q", 200)).toBe("hello");
    expect(parseText(qs("q=abcdef"), "q", 3)).toBe("abc");
    expect(parseText(qs("q=%20"), "q", 10)).toBeNull();
    expect(parseText(qs(""), "q", 10)).toBeNull();
  });
});
