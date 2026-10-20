import { AuthentikError } from "@/lib/authentik/errors";
import type { Schema } from "@/lib/authentik/types";

/**
 * Open-source provider types supported by this server, keyed by API path segment.
 * Google Workspace, Microsoft Entra, WS-Federation and SSF are Enterprise and intentionally absent.
 */
export const PROVIDER_TYPES = {
  oauth2: "authentik_providers_oauth2.oauth2provider",
  proxy: "authentik_providers_proxy.proxyprovider",
  saml: "authentik_providers_saml.samlprovider",
  ldap: "authentik_providers_ldap.ldapprovider",
  scim: "authentik_providers_scim.scimprovider",
  rac: "authentik_providers_rac.racprovider",
  radius: "authentik_providers_radius.radiusprovider",
} as const satisfies Record<string, Schema<"ProviderModelEnum">>;

export type ProviderType = keyof typeof PROVIDER_TYPES;

export const PROVIDER_TYPE_NAMES = Object.keys(PROVIDER_TYPES) as [ProviderType, ...ProviderType[]];

export function providerTypeOf(provider: Schema<"Provider">): ProviderType {
  const model = `${provider.meta_model_name}`;
  const entry = Object.entries(PROVIDER_TYPES).find(([, value]) => value === model);
  if (!entry) {
    throw new AuthentikError({
      status: 400,
      code: "unsupported_provider",
      message: `Provider type ${model} is not supported by this server (Enterprise or out of scope).`,
    });
  }
  return entry[0] as ProviderType;
}

/** Fields that hold credentials; never returned by list/get and never accepted by update. */
export const PROVIDER_SECRET_FIELDS = ["client_secret", "token", "auth_oauth_params"] as const;

export function stripSecrets<T extends Record<string, unknown>>(
  provider: T,
): Omit<T, "client_secret" | "token"> {
  const copy: Record<string, unknown> = { ...provider };
  for (const field of PROVIDER_SECRET_FIELDS) delete copy[field];
  return copy as Omit<T, "client_secret" | "token">;
}
