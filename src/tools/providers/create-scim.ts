import { z } from "zod";
import { listPaginated } from "@/lib/authentik/pagination";
import { resolveApplication } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { secureUrl, slug } from "@/lib/validation";
import { defineTool } from "../define-tool";

export const providersCreateScim = defineTool({
  name: "authentik_providers_create_scim",
  domain: "providers",
  kind: "write",
  title: "Create SCIM provisioning",
  description:
    "Create a SCIM provider (pushes users/groups to the target app) and attach it as a " +
    "backchannel provider to an existing application. The bearer token is stored in authentik " +
    "and never returned. Starts in dryRun mode by default so you can check the sync before it " +
    "writes to the target.",
  input: z.object({
    application: slug.describe("Application slug to attach to"),
    url: secureUrl.describe("SCIM base URL of the target app"),
    token: z.string().min(8).max(4000).describe("Bearer token for the target SCIM API"),
    compatibilityMode: z
      .enum(["default", "aws", "slack", "sfdc", "gitlab", "webex", "vcenter"])
      .default("default"),
    excludeServiceAccounts: z.boolean().default(true),
    dryRun: z
      .boolean()
      .default(true)
      .describe("authentik-side dry run: sync is simulated, nothing is written to the target"),
  }),
  handler: async (args, { client }) => {
    const app = await resolveApplication(client, args.application);
    const [userMappings, groupMappings] = await Promise.all(
      ["user", "group"].map(async (kind) =>
        (
          await listPaginated<{ pk: string; managed?: string | null }>(
            client,
            "/propertymappings/provider/scim/",
            { managed: `goauthentik.io/providers/scim/${kind}` },
            10,
          )
        ).results.map((mapping) => mapping.pk),
      ),
    );
    const provider = await client.post<Schema<"SCIMProvider">>("/providers/scim/", {
      name: `SCIM for ${app.name}`,
      url: args.url,
      token: args.token,
      auth_mode: "token",
      compatibility_mode: args.compatibilityMode,
      exclude_users_service_account: args.excludeServiceAccounts,
      property_mappings: userMappings,
      property_mappings_group: groupMappings,
      dry_run: args.dryRun,
    } satisfies Omit<Schema<"SCIMProviderRequest">, "provider_model">);
    await client.patch(`/core/applications/${encodeURIComponent(app.slug)}/`, {
      backchannel_providers: [...(app.backchannel_providers ?? []), provider.pk],
    });
    return {
      created: true,
      provider: { pk: provider.pk, name: provider.name, dryRun: args.dryRun },
      application: app.slug,
      next: args.dryRun
        ? 'Check the sync in authentik, then set dry_run=false with authentik_providers_update { "dry_run": false }.'
        : "Sync will start automatically.",
    };
  },
});
