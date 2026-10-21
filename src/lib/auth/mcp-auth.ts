import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { getEnv } from "@/lib/config/env";
import { oauthConfig, verifyOAuthToken } from "./oauth";

export interface ApiKey {
  name: string;
  secret: string;
}

// Hashing first gives equal-length buffers, so timingSafeEqual never leaks key length.
const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/** Returns the matching key name, or undefined. Compares against every key to keep timing flat. */
export function findApiKeyName(token: string, keys: readonly ApiKey[]): string | undefined {
  const candidate = digest(token);
  let match: string | undefined;
  for (const key of keys) {
    if (timingSafeEqual(candidate, digest(key.secret)) && match === undefined) match = key.name;
  }
  return match;
}

const looksLikeJwt = (token: string) => token.split(".").length === 3;

/**
 * Bearer verifier for `withMcpAuth`: API keys first, then (when configured) authentik-issued
 * OAuth access tokens. `clientId` carries the key name or `oauth:<username>` for audit logs.
 */
export async function verifyBearer(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const env = getEnv();
  const name = findApiKeyName(bearerToken, env.MCP_API_KEYS);
  if (name) return { token: bearerToken, clientId: name, scopes: [] };

  const oauth = oauthConfig(env);
  if (!oauth || !looksLikeJwt(bearerToken)) return undefined;
  const result = await verifyOAuthToken(bearerToken, oauth);
  return result.ok ? result.authInfo : undefined;
}
