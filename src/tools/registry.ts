import type { McpServer } from "@modelcontextprotocol/server";
import type { Env } from "@/lib/config/env";
import type { AnyToolDefinition } from "./define-tool";
import { registerDefinition } from "./define-tool";
import { applicationTools } from "./applications";
import { brandingTools } from "./branding";
import { groupTools } from "./groups";
import { outpostTools } from "./outposts";
import { providerTools } from "./providers";
import { userTools } from "./users";
import { blueprintTools } from "./blueprints/tools";
import { cryptoTools } from "./crypto/tools";
import { eventTools } from "./events/tools";
import { flowTools } from "./flows/tools";
import { policyTools } from "./policies/tools";
import { rbacTools } from "./rbac/tools";
import { sourceTools } from "./sources/tools";
import { systemTools } from "./system/tools";

export const ALL_TOOLS: readonly AnyToolDefinition[] = [
  ...userTools,
  ...groupTools,
  ...applicationTools,
  ...providerTools,
  ...outpostTools,
  ...blueprintTools,
  ...cryptoTools,
  ...eventTools,
  ...flowTools,
  ...policyTools,
  ...rbacTools,
  ...sourceTools,
  ...systemTools,
  ...brandingTools,
];

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
