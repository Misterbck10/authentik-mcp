import { z } from "zod";
import { listPaginated } from "@/lib/authentik/pagination";
import type { Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { defineTool } from "../define-tool";

type Blueprint = Schema<"BlueprintInstance">;

const compactBlueprint = (bp: Blueprint) => ({
  pk: bp.pk,
  name: bp.name,
  path: bp.path || undefined,
  status: bp.status,
  enabled: bp.enabled ?? true,
  lastApplied: bp.last_applied,
  managedModels: bp.managed_models,
});

export const blueprintsList = defineTool({
  name: "authentik_blueprints_list",
  domain: "blueprints",
  kind: "read",
  title: "List blueprints",
  description: "List blueprint instances with status (successful, warning, error, orphaned).",
  input: z.object({ search: z.string().max(200).optional() }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Blueprint>(
      client,
      "/managed/blueprints/",
      { search: args.search, ordering: "name" },
      env.MCP_MAX_PAGE_ITEMS,
    );
    return { total: page.total, blueprints: page.results.map(compactBlueprint) };
  },
});

export const blueprintsGet = defineTool({
  name: "authentik_blueprints_get",
  domain: "blueprints",
  kind: "read",
  title: "Get blueprint",
  description: "Get a blueprint instance including its context and inline content (if any).",
  input: z.object({ pk: z.guid() }),
  handler: async ({ pk }, { client }) => {
    const bp = await client.get<Blueprint>(`/managed/blueprints/${pk}/`);
    return { ...compactBlueprint(bp), context: bp.context, content: bp.content || undefined };
  },
});

export const blueprintsApply = defineTool({
  name: "authentik_blueprints_apply",
  domain: "blueprints",
  kind: "destructive",
  title: "Apply blueprint",
  description:
    "Apply a blueprint instance now. Blueprints can create, overwrite or delete objects. " +
    "Without confirm: true returns a dry-run listing the models it manages.",
  input: z.object({ pk: z.guid(), confirm: confirmField }),
  handler: async ({ pk, confirm }, { client }) => {
    const bp = await client.get<Blueprint>(`/managed/blueprints/${pk}/`);
    if (!confirm) return dryRun([`Apply blueprint ${bp.name}`], compactBlueprint(bp));
    const applied = await client.post<Blueprint>(`/managed/blueprints/${pk}/apply/`);
    return { applied: true, blueprint: compactBlueprint(applied) };
  },
});

export const blueprintTools = [blueprintsList, blueprintsGet, blueprintsApply];
