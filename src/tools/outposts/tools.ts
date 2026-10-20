import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import { listPaginated } from "@/lib/authentik/pagination";
import { isUuid } from "@/lib/authentik/resolve";
import type { Paginated, Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { defineTool } from "../define-tool";

type Outpost = Schema<"Outpost">;

const outpostRef = z
  .string()
  .min(1)
  .max(200)
  .describe('Outpost uuid or exact name; "embedded" selects the embedded outpost');

async function resolveOutpost(client: AuthentikClient, ref: string): Promise<Outpost> {
  if (isUuid(ref)) return client.get<Outpost>(`/outposts/instances/${ref}/`);
  const query =
    ref === "embedded"
      ? { managed__iexact: "goauthentik.io/outposts/embedded" }
      : { name__iexact: ref };
  const page = await client.get<Paginated<Outpost>>("/outposts/instances/", {
    ...query,
    page_size: 2,
  });
  const outpost = page.results[0];
  if (!outpost) {
    throw new AuthentikError({
      status: 404,
      code: "not_found",
      message: `Outpost not found: ${ref}`,
    });
  }
  return outpost;
}

const compactOutpost = (outpost: Outpost) => ({
  pk: outpost.pk,
  name: outpost.name,
  type: outpost.type,
  embedded: outpost.managed === "goauthentik.io/outposts/embedded",
  serviceConnection: outpost.service_connection_obj?.name ?? null,
  providers: outpost.providers_obj.map((provider) => ({ pk: provider.pk, name: provider.name })),
});

export const outpostsList = defineTool({
  name: "authentik_outposts_list",
  domain: "outposts",
  kind: "read",
  title: "List outposts",
  description: "List outposts (proxy, LDAP, RADIUS, RAC) and the providers they serve.",
  input: z.object({ search: z.string().max(200).optional() }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Outpost>(
      client,
      "/outposts/instances/",
      { search: args.search, ordering: "name" },
      env.MCP_MAX_PAGE_ITEMS,
    );
    return { total: page.total, outposts: page.results.map(compactOutpost) };
  },
});

export const outpostsGet = defineTool({
  name: "authentik_outposts_get",
  domain: "outposts",
  kind: "read",
  title: "Get outpost",
  description: "Get an outpost with its configuration (no tokens).",
  input: z.object({ outpost: outpostRef }),
  handler: async (args, { client }) => {
    const outpost = await resolveOutpost(client, args.outpost);
    return { ...compactOutpost(outpost), config: outpost.config };
  },
});

export const outpostsHealth = defineTool({
  name: "authentik_outposts_health",
  domain: "outposts",
  kind: "read",
  title: "Outpost health",
  description:
    "Health of each running outpost instance: last seen, version and whether it is outdated. " +
    "An empty list means no instance has connected.",
  input: z.object({ outpost: outpostRef }),
  handler: async (args, { client }) => {
    const outpost = await resolveOutpost(client, args.outpost);
    const health = await client.get<Schema<"OutpostHealth">[]>(
      `/outposts/instances/${outpost.pk}/health/`,
    );
    return {
      outpost: outpost.name,
      instances: health.map((instance) => ({
        hostname: instance.hostname,
        lastSeen: instance.last_seen,
        version: instance.version,
        expectedVersion: instance.version_should,
        outdated: instance.version_outdated,
      })),
    };
  },
});

const providerPk = z.number().int().positive();

export const outpostsAddProvider = defineTool({
  name: "authentik_outposts_add_provider",
  domain: "outposts",
  kind: "write",
  idempotent: true,
  title: "Add provider to outpost",
  description:
    "Serve a provider from an outpost — required for proxy (forward auth), LDAP, RADIUS and RAC " +
    'providers. Use outpost "embedded" for the built-in proxy outpost.',
  input: z.object({ outpost: outpostRef, provider: providerPk }),
  handler: async (args, { client }) => {
    const outpost = await resolveOutpost(client, args.outpost);
    if (outpost.providers.includes(args.provider)) {
      return { changed: false, outpost: compactOutpost(outpost) };
    }
    const updated = await client.patch<Outpost>(`/outposts/instances/${outpost.pk}/`, {
      providers: [...outpost.providers, args.provider],
    });
    return { changed: true, outpost: compactOutpost(updated) };
  },
});

export const outpostsRemoveProvider = defineTool({
  name: "authentik_outposts_remove_provider",
  domain: "outposts",
  kind: "destructive",
  idempotent: true,
  title: "Remove provider from outpost",
  description:
    "Stop serving a provider from an outpost; the application behind it becomes unreachable " +
    "through that outpost. Without confirm: true returns a dry-run.",
  input: z.object({ outpost: outpostRef, provider: providerPk, confirm: confirmField }),
  handler: async (args, { client }) => {
    const outpost = await resolveOutpost(client, args.outpost);
    if (!outpost.providers.includes(args.provider)) {
      return { changed: false, outpost: compactOutpost(outpost) };
    }
    if (!args.confirm)
      return dryRun([`Remove provider ${args.provider} from outpost ${outpost.name}`]);
    const updated = await client.patch<Outpost>(`/outposts/instances/${outpost.pk}/`, {
      providers: outpost.providers.filter((pk) => pk !== args.provider),
    });
    return { changed: true, outpost: compactOutpost(updated) };
  },
});
