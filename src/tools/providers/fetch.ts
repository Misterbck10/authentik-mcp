import type { AuthentikClient } from "@/lib/authentik/client";
import type { Schema } from "@/lib/authentik/types";
import type { ProviderType } from "./types";
import { providerTypeOf } from "./types";

export type ProviderDetail = Schema<"Provider"> & Record<string, unknown>;

export async function getProviderDetail(
  client: AuthentikClient,
  pk: number,
): Promise<{ type: ProviderType; provider: ProviderDetail }> {
  const base = await client.get<Schema<"Provider">>(`/providers/all/${pk}/`);
  const type = providerTypeOf(base);
  const provider = await client.get<ProviderDetail>(`/providers/${type}/${pk}/`);
  return { type, provider };
}

/** Connection info an integrator needs; OAuth2 includes OIDC endpoints. */
export async function providerEndpoints(
  client: AuthentikClient,
  type: ProviderType,
  provider: ProviderDetail,
): Promise<Record<string, unknown>> {
  if (type === "oauth2") {
    const urls = await client.get<Schema<"OAuth2ProviderSetupURLs">>(
      `/providers/oauth2/${provider.pk}/setup_urls/`,
    );
    const issuer = urls.issuer.endsWith("/") ? urls.issuer : `${urls.issuer}/`;
    return {
      clientId: provider.client_id,
      clientType: provider.client_type,
      issuer: urls.issuer,
      discoveryUrl: `${issuer}.well-known/openid-configuration`,
      authorizeUrl: urls.authorize,
      tokenUrl: urls.token,
      userInfoUrl: urls.user_info,
      jwksUrl: urls.jwks,
      logoutUrl: urls.logout,
      redirectUris: provider.redirect_uris,
    };
  }
  if (type === "saml") {
    return {
      acsUrl: provider.acs_url,
      audience: provider.audience,
      metadataDownloadUrl: provider.url_download_metadata,
      ssoPostUrl: provider.url_sso_post,
      ssoRedirectUrl: provider.url_sso_redirect,
      issuer: provider.url_issuer,
    };
  }
  if (type === "proxy") {
    return {
      mode: provider.mode,
      externalHost: provider.external_host,
      internalHost: provider.internal_host,
      outpostNote:
        "Proxy providers only work once added to an outpost (e.g. the embedded outpost). " +
        "Use authentik_outposts_add_provider.",
    };
  }
  if (type === "ldap") {
    return {
      baseDn: provider.base_dn,
      outpostNote: "LDAP providers need an LDAP outpost (authentik_outposts_add_provider).",
    };
  }
  return {};
}
