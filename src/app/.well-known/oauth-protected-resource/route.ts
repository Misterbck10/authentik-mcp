import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 9728 metadata pointing MCP clients at authentik as the Authorization Server. */
export function GET(req: Request): Response {
  const env = getEnv();
  if (!env.MCP_OAUTH_ISSUER) {
    return NextResponse.json({ error: "OAuth is not enabled on this server" }, { status: 404 });
  }
  return protectedResourceHandler({
    authServerUrls: [env.MCP_OAUTH_ISSUER],
    resourceUrl: env.MCP_PUBLIC_URL ? `${env.MCP_PUBLIC_URL}/api/mcp` : undefined,
  })(req);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
