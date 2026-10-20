import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/lib/config/env";

const secret = "a".repeat(64);
const base = {
  AUTHENTIK_URL: "https://auth.example.com/",
  AUTHENTIK_TOKEN: "tok",
  MCP_API_KEYS: `claude-code:${secret}`,
};

describe("parseEnv", () => {
  it("applies defaults and normalises values", () => {
    const env = parseEnv(base);
    expect(env.AUTHENTIK_URL).toBe("https://auth.example.com");
    expect(env.MCP_API_KEYS).toEqual([{ name: "claude-code", secret }]);
    expect(env.MCP_READ_ONLY).toBe(false);
    expect(env.MCP_ENABLED_DOMAINS).not.toContain("flows_admin");
    expect(env.MCP_MAX_PAGE_ITEMS).toBe(200);
  });

  it("parses multiple keys and domains", () => {
    const env = parseEnv({
      ...base,
      MCP_API_KEYS: `a:${secret}, b:${secret}`,
      MCP_ENABLED_DOMAINS: "users, groups",
      MCP_READ_ONLY: "true",
    });
    expect(env.MCP_API_KEYS.map((key) => key.name)).toEqual(["a", "b"]);
    expect(env.MCP_ENABLED_DOMAINS).toEqual(["users", "groups"]);
    expect(env.MCP_READ_ONLY).toBe(true);
  });

  it("fails with variable names but never values", () => {
    const leaked = "short-secret-value";
    const run = () => parseEnv({ ...base, AUTHENTIK_TOKEN: "", MCP_API_KEYS: `bad:${leaked}` });
    expect(run).toThrow(EnvError);
    try {
      run();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("AUTHENTIK_TOKEN");
      expect(message).toContain("MCP_API_KEYS");
      expect(message).not.toContain(leaked);
    }
  });

  it("rejects unknown domains", () => {
    expect(() => parseEnv({ ...base, MCP_ENABLED_DOMAINS: "users,enterprise" })).toThrow(EnvError);
  });
});
