import type { McpServer } from "@modelcontextprotocol/server";
import type { Env } from "@/lib/config/env";
import type { AnyToolDefinition } from "./define-tool";
import { registerDefinition } from "./define-tool";
import { usersList } from "./users/list";

export const ALL_TOOLS: readonly AnyToolDefinition[] = [usersList];

/** Tools exposed for this environment: enabled domains only; read tools only in read-only mode. */
export function selectTools(
  env: Env,
  tools: readonly AnyToolDefinition[] = ALL_TOOLS,
): AnyToolDefinition[] {
  const domains = new Set(env.MCP_ENABLED_DOMAINS);
  return tools.filter(
    (tool) => domains.has(tool.domain) && (!env.MCP_READ_ONLY || tool.kind === "read"),
  );
}

export function registerTools(server: McpServer, env: Env): void {
  for (const tool of selectTools(env)) registerDefinition(server, tool);
}
