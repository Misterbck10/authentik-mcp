import type { AuthInfo } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { Env } from "@/lib/config/env";

/**
 * Validates access tokens issued by an authentik OAuth2/OIDC provider (JWT, signed with the
 * provider's signing key). authentik puts the client_id in `aud`; group names are available
 * in the `groups` claim when the "profile" scope mapping is selected.
 */

export interface OAuthConfig {
  issuer: string;
  clientId: string;
  allowedGroups: string[];
}

export function oauthConfig(env: Env): OAuthConfig | undefined {
  if (!env.MCP_OAUTH_ISSUER || !env.MCP_OAUTH_CLIENT_ID) return undefined;
  return {
    issuer: env.MCP_OAUTH_ISSUER,
    clientId: env.MCP_OAUTH_CLIENT_ID,
    allowedGroups: env.MCP_OAUTH_ALLOWED_GROUPS,
  };
}

const withSlash = (url: string) => (url.endsWith("/") ? url : `${url}/`);

// authentik serves the JWKS at <issuer>jwks/; cached by jose across requests.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(issuer: string) {
  const key = withSlash(issuer);
  let jwks = jwksCache.get(key);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL("jwks/", key), { timeoutDuration: 5_000 });
    jwksCache.set(key, jwks);
  }
  return jwks;
}

interface AuthentikClaims extends JWTPayload {
  preferred_username?: string;
  email?: string;
  groups?: string[];
  scope?: string;
  uid?: string;
  azp?: string;
}

export type VerifyResult = { ok: true; authInfo: AuthInfo } | { ok: false; reason: string };

export async function verifyOAuthToken(
  token: string,
  config: OAuthConfig,
  keySet: JWTVerifyGetKey = jwksFor(config.issuer),
): Promise<VerifyResult> {
  let payload: AuthentikClaims;
  try {
    // authentik's iss has a trailing slash; accept both forms.
    const issuers = [withSlash(config.issuer), withSlash(config.issuer).slice(0, -1)];
    ({ payload } = await jwtVerify<AuthentikClaims>(token, keySet, {
      issuer: issuers,
      audience: config.clientId,
    }));
  } catch {
    return { ok: false, reason: "invalid token" };
  }
  // ID tokens share iss/aud/key with access tokens. authentik builds the access token from the
  // ID token and adds `uid` and `azp` (IDToken.to_access_token), so require both.
  if (typeof payload.uid !== "string" || payload.azp !== config.clientId) {
    return { ok: false, reason: "not an access token" };
  }

  const groups = payload.groups ?? [];
  if (
    config.allowedGroups.length > 0 &&
    !groups.some((group) => config.allowedGroups.includes(group))
  ) {
    return { ok: false, reason: "user is not in an allowed group" };
  }
  const username = payload.preferred_username ?? payload.email ?? payload.sub ?? "unknown";
  return {
    ok: true,
    authInfo: {
      token,
      clientId: `oauth:${username}`,
      scopes: payload.scope ? payload.scope.split(" ") : [],
      expiresAt: payload.exp,
      extra: { sub: payload.sub, groups },
    },
  };
}
