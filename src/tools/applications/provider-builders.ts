import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import { listPaginated } from "@/lib/authentik/pagination";
import { resolveCertificatePk, resolveFlowPk } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import type { Env } from "@/lib/config/env";
import { secureUrl } from "@/lib/validation";

const flows = {
  authorizationFlow: z.string().optional().describe("Authorization flow slug (has a sane default)"),
  invalidationFlow: z.string().optional().describe("Invalidation/logout flow slug"),
};

const oauth2 = z.object({
  type: z.literal("oauth2"),
  clientType: z.enum(["confidential", "public"]).default("confidential"),
  redirectUris: z
    .array(
      z.object({
        url: z.string().min(1).max(1000),
        matching: z.enum(["strict", "regex"]).default("strict"),
      }),
    )
    .min(1)
    .max(50),
  scopes: z
    .array(z.string().min(1).max(100))
    .default(["openid", "email", "profile"])
    .describe("Scope names to expose, e.g. openid, email, profile, offline_access"),
  signingKey: z
    .string()
    .optional()
    .describe(
      'Certificate name or uuid used to sign tokens (default "authentik Self-signed Certificate")',
    ),
  subMode: z
    .enum(["hashed_user_id", "user_id", "user_uuid", "user_username", "user_email", "user_upn"])
    .optional(),
  ...flows,
});

const proxy = z.object({
  type: z.literal("proxy"),
  mode: z.enum(["proxy", "forward_single", "forward_domain"]).default("forward_single"),
  externalHost: secureUrl.describe("Public URL of the application"),
  internalHost: z.url().optional().describe("Upstream URL (required for mode 'proxy')"),
  cookieDomain: z.string().max(253).optional().describe("Required for forward_domain"),
  skipPathRegex: z.string().max(2000).optional(),
  ...flows,
});

const saml = z.object({
  type: z.literal("saml"),
  acsUrl: secureUrl,
  audience: z.string().max(500).optional(),
  issuer: z.string().max(500).optional().describe("Issuer override (default: authentik URL)"),
  spBinding: z.enum(["redirect", "post"]).default("post"),
  slsUrl: secureUrl.optional(),
  signingKey: z.string().optional().describe("Certificate name or uuid used to sign assertions"),
  signAssertion: z.boolean().default(true),
  signResponse: z.boolean().default(false),
  ...flows,
});

const ldap = z.object({
  type: z.literal("ldap"),
  baseDn: z.string().min(3).max(500).default("DC=ldap,DC=goauthentik,DC=io"),
  bindFlow: z.string().default("default-authentication-flow").describe("Flow used for LDAP binds"),
  searchMode: z.enum(["direct", "cached"]).default("direct"),
  bindMode: z.enum(["direct", "cached"]).default("direct"),
  mfaSupport: z.boolean().default(true),
  certificate: z.string().optional(),
  invalidationFlow: flows.invalidationFlow,
});

const rac = z.object({
  type: z.literal("rac"),
  connectionExpiry: z.string().default("hours=8"),
  authorizationFlow: flows.authorizationFlow,
});

export const providerInput = z.discriminatedUnion("type", [oauth2, proxy, saml, ldap, rac]);
export type ProviderInput = z.infer<typeof providerInput>;

// Generated request types carry the transactional discriminator; bodies are sent without it.
type ProviderBody<
  Name extends
    | "OAuth2ProviderRequest"
    | "ProxyProviderRequest"
    | "SAMLProviderRequest"
    | "LDAPProviderRequest"
    | "RACProviderRequest",
> = Omit<Schema<Name>, "provider_model">;

const DEFAULT_SIGNING_KEY = "authentik Self-signed Certificate";

async function mappingPks(
  client: AuthentikClient,
  path: string,
  query: Record<string, string | boolean>,
): Promise<string[]> {
  const page = await listPaginated<{ pk: string }>(client, path, query, 200);
  return page.results.map((mapping) => mapping.pk);
}

async function scopeMappingPks(client: AuthentikClient, scopes: string[]): Promise<string[]> {
  const page = await listPaginated<Schema<"ScopeMapping">>(
    client,
    "/propertymappings/provider/scope/",
    { managed__isnull: false },
    200,
  );
  const byScope = new Map(page.results.map((mapping) => [mapping.scope_name, mapping.pk]));
  const missing = scopes.filter((scope) => !byScope.has(scope));
  if (missing.length > 0) {
    throw new AuthentikError({
      status: 400,
      code: "unknown_scope",
      message: `No scope mapping for: ${missing.join(", ")}. Available: ${[...byScope.keys()].join(", ")}`,
    });
  }
  return scopes.map((scope) => byScope.get(scope) as string);
}

async function optionalCert(client: AuthentikClient, ref: string | undefined, fallback?: string) {
  if (ref) return resolveCertificatePk(client, ref);
  if (!fallback) return undefined;
  return resolveCertificatePk(client, fallback).catch(() => undefined);
}

function validateProxy(input: z.infer<typeof proxy>): void {
  if (input.mode === "proxy" && !input.internalHost) {
    throw new AuthentikError({
      status: 400,
      code: "validation_error",
      message: "internalHost is required for proxy mode",
      fieldErrors: { internalHost: ["required for mode 'proxy'"] },
    });
  }
  if (input.mode === "forward_domain" && !input.cookieDomain) {
    throw new AuthentikError({
      status: 400,
      code: "validation_error",
      message: "cookieDomain is required for forward_domain mode",
      fieldErrors: { cookieDomain: ["required for mode 'forward_domain'"] },
    });
  }
}

/** Builds the provider body for the transactional endpoint, resolving slugs/names to pks. */
export async function buildProvider(
  client: AuthentikClient,
  env: Env,
  name: string,
  input: ProviderInput,
): Promise<{ model: Schema<"ProviderModelEnum">; body: Record<string, unknown> }> {
  const invalidation = () =>
    resolveFlowPk(
      client,
      ("invalidationFlow" in input && input.invalidationFlow) ||
        env.AUTHENTIK_DEFAULT_INVALIDATION_FLOW,
    );
  const authorization = () =>
    resolveFlowPk(
      client,
      ("authorizationFlow" in input && input.authorizationFlow) || env.AUTHENTIK_DEFAULT_AUTH_FLOW,
    );

  switch (input.type) {
    case "oauth2":
      return {
        model: "authentik_providers_oauth2.oauth2provider",
        body: {
          name,
          authorization_flow: await authorization(),
          invalidation_flow: await invalidation(),
          client_type: input.clientType,
          redirect_uris: input.redirectUris.map((uri) => {
            if (uri.matching === "strict") secureUrl.parse(uri.url);
            return {
              url: uri.url,
              matching_mode: uri.matching,
              redirect_uri_type: "authorization" as const,
            };
          }),
          property_mappings: await scopeMappingPks(client, input.scopes),
          signing_key: await optionalCert(client, input.signingKey, DEFAULT_SIGNING_KEY),
          sub_mode: input.subMode,
        } satisfies ProviderBody<"OAuth2ProviderRequest">,
      };
    case "proxy":
      validateProxy(input);
      return {
        model: "authentik_providers_proxy.proxyprovider",
        body: {
          name,
          authorization_flow: await authorization(),
          invalidation_flow: await invalidation(),
          mode: input.mode,
          external_host: input.externalHost,
          internal_host: input.internalHost,
          cookie_domain: input.cookieDomain,
          skip_path_regex: input.skipPathRegex,
        } satisfies ProviderBody<"ProxyProviderRequest">,
      };
    case "saml":
      return {
        model: "authentik_providers_saml.samlprovider",
        body: {
          name,
          authorization_flow: await authorization(),
          invalidation_flow: await invalidation(),
          acs_url: input.acsUrl,
          sls_url: input.slsUrl,
          audience: input.audience,
          issuer_override: input.issuer,
          sp_binding: input.spBinding,
          signing_kp: await optionalCert(client, input.signingKey, DEFAULT_SIGNING_KEY),
          sign_assertion: input.signAssertion,
          sign_response: input.signResponse,
          property_mappings: await mappingPks(client, "/propertymappings/provider/saml/", {
            managed__isnull: false,
          }),
        } satisfies ProviderBody<"SAMLProviderRequest">,
      };
    case "ldap":
      return {
        model: "authentik_providers_ldap.ldapprovider",
        body: {
          name,
          authorization_flow: await resolveFlowPk(client, input.bindFlow),
          invalidation_flow: await invalidation(),
          base_dn: input.baseDn,
          search_mode: input.searchMode,
          bind_mode: input.bindMode,
          mfa_support: input.mfaSupport,
          certificate: await optionalCert(client, input.certificate),
        } satisfies ProviderBody<"LDAPProviderRequest">,
      };
    case "rac":
      return {
        model: "authentik_providers_rac.racprovider",
        body: {
          name,
          authorization_flow: await authorization(),
          connection_expiry: input.connectionExpiry,
        } satisfies ProviderBody<"RACProviderRequest">,
      };
  }
}
