import { z } from "zod";
import { AuthentikError } from "@/lib/authentik/errors";
import { listPaginated } from "@/lib/authentik/pagination";
import type { Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { slug } from "@/lib/validation";
import { defineTool } from "../define-tool";

type Source = Schema<"Source">;

/** "authentik_sources_ldap.ldapsource" -> "ldap" */
const sourcePath = (source: Source) =>
  `${source.meta_model_name}`.split(".")[0]?.replace(/^authentik_sources_/, "") ?? "";

const compactSource = (source: Source) => ({
  pk: source.pk,
  slug: source.slug,
  name: source.name,
  type: source.verbose_name,
  enabled: source.enabled ?? true,
  promoted: source.promoted ?? false,
  userMatchingMode: source.user_matching_mode,
  icon: source.icon_url || undefined,
});

export const sourcesList = defineTool({
  name: "authentik_sources_list",
  domain: "sources",
  kind: "read",
  title: "List sources",
  description: "List federation/directory sources (OAuth, SAML, LDAP, SCIM, Kerberos, ...).",
  input: z.object({ search: z.string().max(200).optional() }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Source>(
      client,
      "/sources/all/",
      { search: args.search, ordering: "name" },
      env.MCP_MAX_PAGE_ITEMS,
    );
    return { total: page.total, sources: page.results.map(compactSource) };
  },
});

export const sourcesGet = defineTool({
  name: "authentik_sources_get",
  domain: "sources",
  kind: "read",
  title: "Get source",
  description: "Get a source's type-specific configuration (credentials are redacted).",
  input: z.object({ slug }),
  handler: async (args, { client }) => {
    const base = await client.get<Source>(`/sources/all/${encodeURIComponent(args.slug)}/`);
    const detail = await client.get<Record<string, unknown>>(
      `/sources/${sourcePath(base)}/${encodeURIComponent(args.slug)}/`,
    );
    return { type: base.verbose_name, source: detail };
  },
});

async function ldapSource(client: Parameters<typeof listPaginated>[0], sourceSlug: string) {
  const base = await client.get<Source>(`/sources/all/${encodeURIComponent(sourceSlug)}/`);
  if (sourcePath(base) !== "ldap") {
    throw new AuthentikError({
      status: 400,
      code: "not_ldap",
      message: `${sourceSlug} is not an LDAP source`,
    });
  }
  return base;
}

export const sourcesLdapSyncStatus = defineTool({
  name: "authentik_sources_ldap_sync_status",
  domain: "sources",
  kind: "read",
  title: "LDAP sync status",
  description: "Whether an LDAP source sync is running and when it last succeeded.",
  input: z.object({ slug }),
  handler: async (args, { client }) => {
    await ldapSource(client, args.slug);
    return client.get<Schema<"SyncStatus">>(
      `/sources/ldap/${encodeURIComponent(args.slug)}/sync/status/`,
    );
  },
});

export const sourcesLdapSync = defineTool({
  name: "authentik_sources_ldap_sync",
  domain: "sources",
  kind: "destructive",
  title: "Trigger LDAP sync",
  description:
    "Run the LDAP source's sync schedules now (users, groups, memberships). May create, update " +
    "or deactivate many users. Without confirm: true returns a dry-run.",
  input: z.object({ slug, confirm: confirmField }),
  handler: async (args, { client }) => {
    const source = await ldapSource(client, args.slug);
    const schedules = await listPaginated<Schema<"Schedule">>(
      client,
      "/tasks/schedules/",
      { rel_obj_content_type__model: "ldapsource", rel_obj_id: source.pk },
      50,
    );
    const names = schedules.results.map((schedule) => schedule.description || schedule.actor_name);
    if (!args.confirm)
      return dryRun([`Run ${names.length} sync schedule(s) for ${source.name}`], names);
    for (const schedule of schedules.results) {
      await client.post(`/tasks/schedules/${schedule.id}/send/`);
    }
    return { triggered: names, hint: "Check progress with authentik_sources_ldap_sync_status." };
  },
});

export const sourceTools = [sourcesList, sourcesGet, sourcesLdapSyncStatus, sourcesLdapSync];
