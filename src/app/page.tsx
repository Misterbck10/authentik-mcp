import { pingAuthentik } from "@/lib/authentik/health";
import { getEnv } from "@/lib/config/env";

export const dynamic = "force-dynamic";

async function serverStatus(): Promise<string> {
  try {
    getEnv();
  } catch {
    return "Configuration invalid. Check the server logs.";
  }
  const health = await pingAuthentik();
  return health.ok ? `Connected to authentik (${health.latencyMs} ms).` : health.reason;
}

const connectCommand = `claude mcp add --transport http authentik https://<host>/api/mcp \\
  --header "Authorization: Bearer <api-key>"`;

export default async function Home() {
  const status = await serverStatus();
  return (
    <main>
      <h1>authentik MCP server</h1>
      <p>
        <strong>Status:</strong> {status}
      </p>
      <h2>Connect</h2>
      <p>
        MCP endpoint (Streamable HTTP): <code>/api/mcp</code>
      </p>
      <pre>{connectCommand}</pre>
      <p>See the README for Claude connectors and stdio clients (mcp-remote).</p>
    </main>
  );
}
