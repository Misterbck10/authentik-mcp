import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyOAuthToken, type OAuthConfig } from "@/lib/auth/oauth";
import { parseEnv } from "@/lib/config/env";

const ISSUER = "https://auth.test/application/o/authentik-mcp/";
const config: OAuthConfig = { issuer: ISSUER, clientId: "mcp-client", allowedGroups: [] };

let privateKey: CryptoKey;
let keySet: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  keySet = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }],
  });
});

function sign(
  claims: JWTPayload & { groups?: string[] },
  overrides: { exp?: string; iss?: string; aud?: string } = {},
) {
  return new SignJWT({ uid: "u-1", azp: "mcp-client", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? "mcp-client")
    .setSubject("sub-1")
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? "5m")
    .sign(privateKey);
}

describe("verifyOAuthToken", () => {
  it("accepts a valid authentik token and names the user for audit", async () => {
    const result = await verifyOAuthToken(
      await sign({ preferred_username: "ana", scope: "openid profile", groups: ["it"] }),
      config,
      keySet,
    );
    expect(result).toMatchObject({
      ok: true,
      authInfo: { clientId: "oauth:ana", scopes: ["openid", "profile"] },
    });
  });

  it("rejects wrong audience, wrong issuer and expired tokens", async () => {
    for (const token of [
      await sign({}, { aud: "other-client" }),
      await sign({}, { iss: "https://evil.test/" }),
      await sign({}, { exp: "-1m" }),
    ]) {
      expect(await verifyOAuthToken(token, config, keySet)).toMatchObject({ ok: false });
    }
  });

  it("rejects ID tokens (no uid/azp) even though iss, aud and key match", async () => {
    const idToken = await sign({ uid: undefined, azp: undefined, preferred_username: "ana" });
    expect(await verifyOAuthToken(idToken, config, keySet)).toMatchObject({
      ok: false,
      reason: "not an access token",
    });
  });

  it("rejects tokens signed by another key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(ISSUER)
      .setAudience("mcp-client")
      .setExpirationTime("5m")
      .sign(other.privateKey);
    expect(await verifyOAuthToken(forged, config, keySet)).toMatchObject({ ok: false });
  });

  it("enforces allowed groups when configured", async () => {
    const restricted = { ...config, allowedGroups: ["mcp-admins"] };
    expect(
      await verifyOAuthToken(await sign({ groups: ["staff"] }), restricted, keySet),
    ).toMatchObject({
      ok: false,
      reason: "user is not in an allowed group",
    });
    expect(
      await verifyOAuthToken(await sign({ groups: ["mcp-admins"] }), restricted, keySet),
    ).toMatchObject({
      ok: true,
    });
  });
});

describe("OAuth env", () => {
  const base = {
    AUTHENTIK_URL: "https://auth.test",
    AUTHENTIK_TOKEN: "t",
    MCP_API_KEYS: `k:${"k".repeat(32)}`,
  };

  it("requires a client id when an issuer is set, and https issuers", () => {
    expect(() => parseEnv({ ...base, MCP_OAUTH_ISSUER: ISSUER })).toThrow(/MCP_OAUTH_CLIENT_ID/);
    expect(() =>
      parseEnv({ ...base, MCP_OAUTH_ISSUER: "http://auth.test/x/", MCP_OAUTH_CLIENT_ID: "c" }),
    ).toThrow(/MCP_OAUTH_ISSUER/);
    expect(
      parseEnv({
        ...base,
        MCP_OAUTH_ISSUER: ISSUER,
        MCP_OAUTH_CLIENT_ID: "c",
        MCP_OAUTH_ALLOWED_GROUPS: "a, b",
      }).MCP_OAUTH_ALLOWED_GROUPS,
    ).toEqual(["a", "b"]);
  });
});
