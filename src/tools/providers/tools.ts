import { z } from "zod";
import { AuthentikError } from "@/lib/authentik/errors";
import { listPaginated } from "@/lib/authentik/pagination";
import type { Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { defineTool } from "../define-tool";
import { getProviderDetail, providerEndpoints } from "./fetch";
import { PROVIDER_SECRET_FIELDS, stripSecrets } from "./types";

const providerPk = z.number().int().positive().describe("Provider pk (see providers_list)");

const compactProvider = (provider: Schema<"Provider">) => ({
  pk: provider.pk,
  name: provider.name,
  type: provider.verbose_name,
  application:
    provider.assigned_application_slug || provider.assigned_backchannel_application_slug || null,
  backchannel: !!provider.assigned_backchannel_application_slug,
});

export const providersList = defineTool({
  name: "authentik_providers_list",
  domain: "providers",
  kind: "read",
  title: "List providers",
  description: "List providers of all types with the application they are assigned to.",
  input: z.object({
    search: z.string().max(200).optional(),
    unassigned: z.boolean().optional().describe("Only providers without an application"),
    limit: z.number().int().positive().optional(),
  }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Schema<"Provider">>(
      client,
      "/providers/all/",
      { search: args.search, application__isnull: args.unassigned, ordering: "name" },
      Math.min(args.limit ?? 100, env.MCP_MAX_PAGE_ITEMS),
    );
    return {
      total: page.total,
      truncated: page.truncated,
      providers: page.results.map(compactProvider),
    };
  },
});

export const providersGet = defineTool({
  name: "authentik_providers_get",
  domain: "providers",
  kind: "read",
  title: "Get provider",
  description:
    "Get a provider's full configuration and connection endpoints (OIDC discovery, SAML " +
    "metadata, ...). Secrets are never included; use providers_get_secret.",
  input: z.object({ pk: providerPk }),
  handler: async ({ pk }, { client }) => {
    const { type, provider } = await getProviderDetail(client, pk);
    return {
      type,
      provider: stripSecrets(provider),
      connection: await providerEndpoints(client, type, provider),
    };
  },
});

export const providersUpdate = defineTool({
  name: "authentik_providers_update",
  domain: "providers",
  kind: "write",
  idempotent: true,
  title: "Update provider",
  description:
    "Patch provider fields using authentik API field names (snake_case), e.g. " +
    '{ "redirect_uris": [{"url": "https://app/cb", "matching_mode": "strict"}] } for OAuth2 or ' +
    '{ "external_host": "https://..." } for proxy. Call providers_get first to see current ' +
    "values. Secret fields cannot be changed here.",
  input: z.object({
    pk: providerPk,
    changes: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
      message: "changes must not be empty",
    }),
  }),
  handler: async ({ pk, changes }, { client }) => {
    const blocked = Object.keys(changes).filter((key) =>
      (PROVIDER_SECRET_FIELDS as readonly string[]).includes(key),
    );
    if (blocked.length > 0) {
      throw new AuthentikError({
        status: 400,
        code: "secret_field",
        message: `Secret fields cannot be changed through this tool: ${blocked.join(", ")}`,
      });
    }
    const { type } = await getProviderDetail(client, pk);
    const updated = await client.patch<Record<string, unknown>>(
      `/providers/${type}/${pk}/`,
      changes,
    );
    return { updated: true, type, provider: stripSecrets(updated) };
  },
});

export const providersDelete = defineTool({
  name: "authentik_providers_delete",
  domain: "providers",
  kind: "destructive",
  idempotent: true,
  title: "Delete provider",
  description:
    "Delete a provider. Its application stays but SSO stops working. Without confirm: true " +
    "returns a dry-run listing what uses it.",
  input: z.object({ pk: providerPk, confirm: confirmField }),
  handler: async ({ pk, confirm }, { client }) => {
    const provider = await client.get<Schema<"Provider">>(`/providers/all/${pk}/`);
    if (!confirm) {
      const usedBy = await client.get<Schema<"UsedBy">[]>(`/providers/all/${pk}/used_by/`);
      return dryRun(
        [`Delete provider ${provider.name} (${provider.verbose_name})`],
        {
          usedBy: usedBy.map((use) => ({
            model: use.model_name,
            name: use.name,
            action: use.action,
          })),
        },
        provider.assigned_application_slug
          ? [`Application ${provider.assigned_application_slug} will lose SSO.`]
          : [],
      );
    }
    await client.delete(`/providers/all/${pk}/`);
    return { deleted: true, name: provider.name };
  },
});

export const providersGetSecret = defineTool({
  name: "authentik_providers_get_secret",
  domain: "providers",
  kind: "sensitive",
  title: "Reveal provider secret",
  description:
    "SENSITIVE: reveal the OAuth2 client_secret of a confidential provider. Only use when the " +
    "user explicitly needs it to configure the client. Requires confirm: true.",
  input: z.object({ pk: providerPk, confirm: confirmField }),
  handler: async ({ pk, confirm }, { client }) => {
    const { type, provider } = await getProviderDetail(client, pk);
    if (type !== "oauth2") {
      throw new AuthentikError({
        status: 400,
        code: "no_secret",
        message: `Provider type ${type} has no client secret.`,
      });
    }
    if (!confirm) return dryRun([`Reveal the client_secret of ${provider.name}`]);
    return {
      name: provider.name,
      clientId: provider.client_id,
      clientSecret: provider.client_secret,
    };
  },
});
