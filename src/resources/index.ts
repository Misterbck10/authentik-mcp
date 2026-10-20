import {
  ResourceTemplate,
  type McpServer,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import { getAuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import type { Env } from "@/lib/config/env";
import { getEnv } from "@/lib/config/env";
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
async function readVia(tool: AnyToolDefinition, args: Record<string, unknown>, uri: URL) {
  try {
    const ctx = { client: getAuthentikClient(), env: getEnv(), apiKeyName: "resource" };
    return json(uri, await tool.handler(tool.input.parse(args), ctx));
  } catch (error) {
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
      (uri, variables) => {
        const id = decodeURIComponent(single(variables.id));
        return readVia(usersGet, { user: /^\d+$/.test(id) ? Number(id) : id }, uri);
      },
    );
  }

  if (enabled.has("applications")) {
    server.registerResource(
      "application",
      new ResourceTemplate("authentik://applications/{slug}", { list: undefined }),
      { title: "authentik application", mimeType: "application/json" },
      (uri, variables) => readVia(applicationsGet, { slug: single(variables.slug) }, uri),
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
      (uri) => readVia(flowsList, {}, uri),
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
      (uri, variables) =>
        readVia(brandsGet, { brand: decodeURIComponent(single(variables.uuid)) }, uri),
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
