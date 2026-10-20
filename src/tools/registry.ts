import type { McpServer } from "@modelcontextprotocol/server";
import type { Env } from "@/lib/config/env";

/**
 * Registers tools for the enabled domains. Domains are added phase by phase;
 * read-only mode and domain filtering are applied here.
 */
export function registerTools(_server: McpServer, _env: Env): void {
  // Phase 2+: users, groups, applications, ...
}
