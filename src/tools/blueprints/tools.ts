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

const FINAL_STATUS = new Set(["successful", "warning", "error", "orphaned"]);

/** Applying is asynchronous (worker task); poll briefly so the result reflects the outcome. */
async function waitForStatus(
  client: Parameters<typeof listPaginated>[0],
  pk: string,
  timeoutMs = 30_000,
): Promise<Blueprint> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const bp = await client.get<Blueprint>(`/managed/blueprints/${pk}/`);
    if (FINAL_STATUS.has(bp.status) || Date.now() > deadline) return bp;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

export const blueprintsAvailable = defineTool({
  name: "authentik_blueprints_available",
  domain: "blueprints",
  kind: "read",
  title: "List available blueprint files",
  description:
    "List blueprint files shipped with / mounted into authentik (e.g. the official examples " +
    'such as "example/flows-recovery-email-verification.yaml"), to use with blueprints_instantiate.',
  input: z.object({ search: z.string().max(200).optional() }),
  handler: async (args, { client }) => {
    const files = await client.get<Schema<"BlueprintFile">[]>("/managed/blueprints/available/");
    const needle = args.search?.toLowerCase();
    return files
      .filter(
        (file) => !needle || `${file.path} ${file.meta?.name ?? ""}`.toLowerCase().includes(needle),
      )
      .map((file) => ({ path: file.path, name: file.meta?.name, lastModified: file.last_m }));
  },
});

export const blueprintsInstantiate = defineTool({
  name: "authentik_blueprints_instantiate",
  domain: "blueprints",
  kind: "destructive",
  title: "Instantiate and apply a blueprint file",
  description:
    "Create a blueprint instance from an available file path and apply it — the declarative way " +
    "to add standard configuration (e.g. a recovery flow). Blueprints may overwrite objects " +
    "with the same identifiers. Without confirm: true returns a dry-run.",
  input: z.object({
    path: z.string().regex(/^[\w\-./]+\.ya?ml$/, "path from blueprints_available"),
    name: z.string().min(1).max(200).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    confirm: confirmField,
  }),
  handler: async (args, { client }) => {
    const files = await client.get<Schema<"BlueprintFile">[]>("/managed/blueprints/available/");
    const file = files.find((candidate) => candidate.path === args.path);
    if (!file) {
      return { applied: false, reason: `No available blueprint at ${args.path}` };
    }
    const name = args.name ?? file.meta?.name ?? args.path;
    if (!args.confirm) return dryRun([`Instantiate and apply blueprint ${name} (${args.path})`]);
    const instance = await client.post<Blueprint>("/managed/blueprints/", {
      name,
      path: args.path,
      context: args.context ?? {},
      enabled: true,
    } satisfies Schema<"BlueprintInstanceRequest">);
    await client.post<Blueprint>(`/managed/blueprints/${instance.pk}/apply/`);
    const result = await waitForStatus(client, instance.pk);
    return { applied: result.status === "successful", blueprint: compactBlueprint(result) };
  },
});

export const blueprintTools = [
  blueprintsList,
  blueprintsAvailable,
  blueprintsGet,
  blueprintsInstantiate,
  blueprintsApply,
];
