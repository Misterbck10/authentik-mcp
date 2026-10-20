import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AuthentikError } from "@/lib/authentik/errors";
import { defineTool, registerDefinition } from "@/tools/define-tool";

vi.mock("@/lib/config/env", async (original) => {
  const actual = await original<typeof import("@/lib/config/env")>();
  return {
    ...actual,
    getEnv: () =>
      actual.parseEnv({
        AUTHENTIK_URL: "https://auth.test",
        AUTHENTIK_TOKEN: "t",
        MCP_API_KEYS: `test:${"k".repeat(32)}`,
      }),
  };
});

type Callback = (
  args: unknown,
  ctx: unknown,
) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function capture(definition: ReturnType<typeof defineTool>) {
  let registered: { config: Record<string, unknown>; callback: Callback } | undefined;
  const server = {
    registerTool: (_name: string, config: Record<string, unknown>, callback: Callback) => {
      registered = { config, callback };
    },
  } as unknown as McpServer;
  registerDefinition(server, definition);
  if (!registered) throw new Error("not registered");
  return registered;
}

const ctx = { http: { authInfo: { clientId: "claude-code", token: "x", scopes: [] } } };

describe("registerDefinition", () => {
  it("sets MCP annotations from the tool kind", () => {
    const tool = defineTool({
      name: "t_delete",
      domain: "users",
      kind: "destructive",
      title: "T",
      description: "d",
      input: z.object({}),
      handler: async () => ({}),
    });
    expect(capture(tool).config.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it("redacts secrets in results and audit log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const tool = defineTool({
      name: "t_read",
      domain: "users",
      kind: "read",
      title: "T",
      description: "d",
      input: z.object({ password: z.string() }),
      handler: async () => ({ client_secret: "abc", name: "x" }),
    });
    const result = await capture(tool).callback({ password: "pw" }, ctx);
    expect(result.content[0]?.text).not.toContain("abc");
    const entry = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      type: "audit",
      apiKeyName: "claude-code",
      tool: "t_read",
      result: "ok",
      argsRedacted: { password: "[REDACTED]" },
    });
    log.mockRestore();
  });

  it("returns normalised authentik errors and hides unexpected ones", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = (error: Error) =>
      defineTool({
        name: "t_fail",
        domain: "users",
        kind: "read",
        title: "T",
        description: "d",
        input: z.object({}),
        handler: async () => {
          throw error;
        },
      });
    const known = await capture(
      failing(new AuthentikError({ status: 404, code: "not_found", message: "User not found" })),
    ).callback({}, ctx);
    expect(known.isError).toBe(true);
    expect(known.content[0]?.text).toContain("User not found");

    const unknown = await capture(failing(new Error("db password=hunter2"))).callback({}, ctx);
    expect(unknown.content[0]?.text).not.toContain("hunter2");
    log.mockRestore();
    err.mockRestore();
  });
});
