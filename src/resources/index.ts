import {
  ResourceTemplate,
  type McpServer,
  type ServerContext,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import { getAuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import type { Env } from "@/lib/config/env";
import { getEnv } from "@/lib/config/env";
import { audit } from "@/lib/safety/audit";
import { redact } from "@/lib/safety/redact";
import { applicationsGet } from "@/tools/applications/crud";
import { brandsGet } from "@/tools/branding/brands";
import type { AnyToolDefinition } from "@/tools/define-tool";
import { flowsList } from "@/tools/flows/tools";
import { usersGet } from "@/tools/users/get";
import { CSS_GUIDE } from "./css-guide";

const json = (uri: URL, value: unknown): ReadResourceResult => ({
  contents: [
    { uri: uri.href, mimeType: "application/json", text: JSON.stringify(redact(value), null, 2) },
  ],
});

/** Reuses a read tool's handler so resources and tools stay consistent. */
async function readVia(
  tool: AnyToolDefinition,
  args: Record<string, unknown>,
  uri: URL,
  serverCtx: ServerContext,
) {
  // Same audit trail as tool calls, so resource reads are never invisible.
  const apiKeyName = serverCtx.http?.authInfo?.clientId ?? "unknown";
  const started = Date.now();
  const log = (result: "ok" | "error", errorCode?: string) =>
    audit({
      apiKeyName,
      tool: `resource:${uri.href}`,
      args,
      result,
      durationMs: Date.now() - started,
      errorCode,
    });
  try {
    const ctx = { client: getAuthentikClient(), env: getEnv(), apiKeyName };
    const value = await tool.handler(tool.input.parse(args), ctx);
    log("ok");
    return json(uri, value);
  } catch (error) {
    log("error", error instanceof AuthentikError ? error.code : "internal_error");
    if (error instanceof AuthentikError) return json(uri, { error: error.toJSON() });
    throw error;
  }
}

const single = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export function registerResources(server: McpServer, env: Env): void {
  const enabled = new Set(env.MCP_ENABLED_DOMAINS);

  if (enabled.has("users")) {
    server.registerResource(
      "user",
      new ResourceTemplate("authentik://users/{id}", { list: undefined }),
      {
        title: "authentik user",
        description: "User by pk, username or email",
        mimeType: "application/json",
      },
      (uri, variables, ctx) => {
        const id = decodeURIComponent(single(variables.id));
        return readVia(usersGet, { user: /^\d+$/.test(id) ? Number(id) : id }, uri, ctx);
      },
    );
  }

  if (enabled.has("applications")) {
    server.registerResource(
      "application",
      new ResourceTemplate("authentik://applications/{slug}", { list: undefined }),
      { title: "authentik application", mimeType: "application/json" },
      (uri, variables, ctx) => readVia(applicationsGet, { slug: single(variables.slug) }, uri, ctx),
    );
  }

  if (enabled.has("flows")) {
    server.registerResource(
      "flows",
      "authentik://flows",
      {
        title: "authentik flows",
        description: "All flows with designation",
        mimeType: "application/json",
      },
      (uri, ctx) => readVia(flowsList, {}, uri, ctx),
    );
  }

  if (enabled.has("branding")) {
    server.registerResource(
      "brand",
      new ResourceTemplate("authentik://brands/{uuid}", { list: undefined }),
      {
        title: "authentik brand",
        description: "Visual configuration (no secrets)",
        mimeType: "application/json",
      },
      (uri, variables, ctx) =>
        readVia(brandsGet, { brand: decodeURIComponent(single(variables.uuid)) }, uri, ctx),
    );
    server.registerResource(
      "css-guide",
      "authentik://branding/css-guide",
      {
        title: "authentik CSS guide",
        description: "Variables and ::part() hooks to use before generating CSS",
        mimeType: "text/markdown",
      },
      (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: CSS_GUIDE }] }),
    );
  }
}
