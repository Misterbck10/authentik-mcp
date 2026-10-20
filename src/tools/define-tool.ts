import type {
  CallToolResult,
  McpServer,
  ServerContext,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { getAuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import type { Domain, Env } from "@/lib/config/env";
import { getEnv } from "@/lib/config/env";
import { audit } from "@/lib/safety/audit";
import { redact } from "@/lib/safety/redact";

/**
 * read        - no side effects
 * write       - creates or changes objects
 * destructive - deletes / revokes / removes; requires `confirm: true`, otherwise dry-run
 * sensitive   - returns secrets; requires `confirm: true`
 */
export type ToolKind = "read" | "write" | "destructive" | "sensitive";

export interface ToolContext {
  client: AuthentikClient;
  env: Env;
  apiKeyName: string;
}

export interface ToolDefinition<Input extends z.ZodObject> {
  name: string;
  domain: Domain;
  kind: ToolKind;
  title: string;
  description: string;
  input: Input;
  idempotent?: boolean;
  /** Result intentionally carries a freshly generated secret (e.g. client_secret on create). */
  returnsNewSecret?: boolean;
  /** Return values are JSON-serialised and redacted unless `kind` is "sensitive". */
  handler: (args: z.infer<Input>, ctx: ToolContext) => Promise<unknown>;
}

// Erased form stored in the registry; each definition keeps its own types via defineTool.
export type AnyToolDefinition = ToolDefinition<z.ZodObject>;

export function defineTool<Input extends z.ZodObject>(
  definition: ToolDefinition<Input>,
): AnyToolDefinition {
  return definition as unknown as AnyToolDefinition;
}

function annotationsFor(definition: AnyToolDefinition): ToolAnnotations {
  return {
    title: definition.title,
    readOnlyHint: definition.kind === "read",
    destructiveHint: definition.kind === "destructive",
    idempotentHint: definition.idempotent ?? definition.kind === "read",
    openWorldHint: false,
  };
}

const textResult = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

function toErrorPayload(error: unknown): { error: Record<string, unknown> } {
  if (error instanceof AuthentikError) return { error: error.toJSON() };
  // Unknown errors may contain internals; expose only a generic message.
  console.error("Unexpected tool error", error instanceof Error ? error.name : typeof error);
  return { error: { code: "internal_error", message: "Unexpected server error" } };
}

export function registerDefinition(server: McpServer, definition: AnyToolDefinition): void {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.input,
      annotations: annotationsFor(definition),
    },
    async (args: z.infer<z.ZodObject>, serverCtx: ServerContext): Promise<CallToolResult> => {
      const apiKeyName = serverCtx.http?.authInfo?.clientId ?? "unknown";
      const started = Date.now();
      try {
        const ctx: ToolContext = { client: getAuthentikClient(), env: getEnv(), apiKeyName };
        const output = await definition.handler(args, ctx);
        audit({
          apiKeyName,
          tool: definition.name,
          args,
          result: "ok",
          durationMs: Date.now() - started,
        });
        return textResult(
          definition.kind === "sensitive" || definition.returnsNewSecret ? output : redact(output),
        );
      } catch (error) {
        const payload = toErrorPayload(error);
        audit({
          apiKeyName,
          tool: definition.name,
          args,
          result: "error",
          durationMs: Date.now() - started,
          errorCode: String(payload.error.code),
        });
        return textResult(payload, true);
      }
    },
  );
}
