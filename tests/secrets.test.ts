import { describe, expect, it } from "vitest";
import { secretMatches, secretMatchesAny } from "@/lib/secrets";

describe("secretMatches", () => {
  it("matches identical secrets", () => {
    expect(secretMatches("s3cret-token", "s3cret-token")).toBe(true);
  });
  it("rejects a different secret, including a prefix or a longer value", () => {
    expect(secretMatches("s3cret", "s3cret-token")).toBe(false);
    expect(secretMatches("s3cret-token-extra", "s3cret-token")).toBe(false);
    expect(secretMatches("S3CRET-TOKEN", "s3cret-token")).toBe(false);
  });
  it("never matches when either side is missing or empty", () => {
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches(null, "x")).toBe(false);
    expect(secretMatches("x", undefined)).toBe(false);
  });
});

describe("secretMatchesAny", () => {
  it("accepts any configured secret and ignores unset ones", () => {
    expect(secretMatchesAny("b", [undefined, "a", "b"])).toBe(true);
    expect(secretMatchesAny("c", [undefined, "a", "b"])).toBe(false);
    expect(secretMatchesAny("", [undefined, ""])).toBe(false);
  });
});
