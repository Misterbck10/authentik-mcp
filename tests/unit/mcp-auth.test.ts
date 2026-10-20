import { describe, expect, it } from "vitest";
import { findApiKeyName } from "@/lib/auth/mcp-auth";

const keys = [
  { name: "claude-code", secret: "s".repeat(64) },
  { name: "ci", secret: "c".repeat(64) },
];

describe("findApiKeyName", () => {
  it("returns the matching key name", () => {
    expect(findApiKeyName("c".repeat(64), keys)).toBe("ci");
  });

  it("rejects unknown, empty and prefix tokens", () => {
    expect(findApiKeyName("x".repeat(64), keys)).toBeUndefined();
    expect(findApiKeyName("", keys)).toBeUndefined();
    expect(findApiKeyName("s".repeat(63), keys)).toBeUndefined();
  });
});
