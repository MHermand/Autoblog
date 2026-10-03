import { describe, expect, it } from "vitest";
import { bearerToken, isAuthorizedBearer, safeEqual } from "./secrets";

describe("safeEqual", () => {
  it("compares strings of any length", () => {
    expect(safeEqual("secret-value", "secret-value")).toBe(true);
    expect(safeEqual("secret-value", "secret-valuE")).toBe(false);
    expect(safeEqual("short", "a much longer string")).toBe(false);
  });
});

describe("bearerToken", () => {
  it("extracts the token, case-insensitive scheme", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer   abc123 ")).toBe("abc123");
  });

  it("returns null for other schemes or malformed headers", () => {
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("isAuthorizedBearer", () => {
  const secret = "0123456789abcdef0123";

  it("accepts only the exact secret", () => {
    expect(isAuthorizedBearer(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedBearer(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedBearer(null, secret)).toBe(false);
  });

  it("never authorizes against an empty secret", () => {
    expect(isAuthorizedBearer("Bearer ", "")).toBe(false);
  });
});
