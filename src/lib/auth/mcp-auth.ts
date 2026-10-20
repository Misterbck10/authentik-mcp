import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { getEnv } from "@/lib/config/env";

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

/** Bearer verifier for `withMcpAuth`. `clientId` carries the API key name for audit logs. */
export function verifyApiKey(_req: Request, bearerToken?: string): AuthInfo | undefined {
  if (!bearerToken) return undefined;
  const name = findApiKeyName(bearerToken, getEnv().MCP_API_KEYS);
  if (!name) return undefined;
  return { token: bearerToken, clientId: name, scopes: [] };
}
