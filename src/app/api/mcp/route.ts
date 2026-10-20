import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyApiKey } from "@/lib/auth/mcp-auth";
import { getEnv } from "@/lib/config/env";
import { registerPrompts } from "@/prompts";
import { registerResources } from "@/resources";
import { registerTools } from "@/tools/registry";
import packageJson from "../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const mcpHandler = createMcpHandler(
  (server) => {
    const env = getEnv();
    registerTools(server, env);
    registerResources(server, env);
    registerPrompts(server, env);
  },
  {
    serverInfo: { name: "authentik-mcp", version: packageJson.version },
  },
);

const handler = withMcpAuth(mcpHandler, verifyApiKey, { required: true });

export { handler as GET, handler as POST, handler as DELETE };
