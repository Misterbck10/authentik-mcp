import { z } from "zod";
import { listPaginated } from "@/lib/authentik/pagination";
import { resolveApplication, resolveUser } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { slug, userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { compactApplication } from "./compact";

export const applicationsList = defineTool({
  name: "authentik_applications_list",
  domain: "applications",
  kind: "read",
  title: "List applications",
  description: "List applications with their provider, launch URL and library section.",
  input: z.object({
    search: z.string().max(200).optional(),
    group: z.string().max(200).optional().describe("Library section name"),
    limit: z.number().int().positive().optional(),
  }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Schema<"Application">>(
      client,
      "/core/applications/",
      { search: args.search, group: args.group, superuser_full_list: true, ordering: "name" },
      Math.min(args.limit ?? 100, env.MCP_MAX_PAGE_ITEMS),
    );
    return {
      total: page.total,
      truncated: page.truncated,
      applications: page.results.map(compactApplication),
    };
  },
});

export const applicationsGet = defineTool({
  name: "authentik_applications_get",
  domain: "applications",
  kind: "read",
  title: "Get application",
  description: "Get one application by slug.",
  input: z.object({ slug }),
  handler: async (args, { client }) =>
    compactApplication(await resolveApplication(client, args.slug)),
});

export const applicationsUpdate = defineTool({
  name: "authentik_applications_update",
  domain: "applications",
  kind: "write",
  idempotent: true,
  title: "Update application",
  description:
    "Update an application's name, launch URL, description, publisher, library section, " +
    "visibility or policy engine mode. Use providers_update for provider settings.",
  input: z.object({
    slug,
    name: z.string().min(1).max(200).optional(),
    launchUrl: z.url().optional(),
    description: z.string().max(500).optional(),
    publisher: z.string().max(200).optional(),
    group: z.string().max(200).optional(),
    hidden: z.boolean().optional(),
    openInNewTab: z.boolean().optional(),
    policyEngineMode: z.enum(["all", "any"]).optional(),
  }),
  handler: async (args, { client }) => {
    const body: Schema<"PatchedApplicationRequest"> = {
      name: args.name,
      meta_launch_url: args.launchUrl,
      meta_description: args.description,
      meta_publisher: args.publisher,
      group: args.group,
      meta_hide: args.hidden,
      open_in_new_tab: args.openInNewTab,
      policy_engine_mode: args.policyEngineMode,
    };
    const app = await client.patch<Schema<"Application">>(
      `/core/applications/${encodeURIComponent(args.slug)}/`,
      body,
    );
    return { updated: true, application: compactApplication(app) };
  },
});

export const applicationsDelete = defineTool({
  name: "authentik_applications_delete",
  domain: "applications",
  kind: "destructive",
  idempotent: true,
  title: "Delete application",
  description:
    "Delete an application (users lose SSO access). Its provider is kept unless " +
    "deleteProvider is true. Without confirm: true returns a dry-run.",
  input: z.object({ slug, deleteProvider: z.boolean().default(false), confirm: confirmField }),
  handler: async (args, { client }) => {
    const app = await resolveApplication(client, args.slug);
    const steps = [
      `Delete application ${app.name} (${app.slug})`,
      ...(args.deleteProvider && app.provider_obj
        ? [`Delete provider ${app.provider_obj.name}`]
        : []),
    ];
    if (!args.confirm) return dryRun(steps, compactApplication(app));
    await client.delete(`/core/applications/${encodeURIComponent(app.slug)}/`);
    if (args.deleteProvider && app.provider) await client.delete(`/providers/all/${app.provider}/`);
    return {
      deleted: true,
      slug: app.slug,
      providerDeleted: args.deleteProvider && !!app.provider,
    };
  },
});

export const applicationsCheckAccess = defineTool({
  name: "authentik_applications_check_access",
  domain: "applications",
  kind: "read",
  title: "Check application access",
  description:
    "Check whether a user may access an application, with the policy messages explaining why.",
  input: z.object({ slug, user: userRef }),
  handler: async (args, { client }) => {
    const user = await resolveUser(client, args.user);
    const result = await client.get<Schema<"PolicyTestResult">>(
      `/core/applications/${encodeURIComponent(args.slug)}/check_access/`,
      { for_user: user.pk },
    );
    return {
      slug: args.slug,
      username: user.username,
      passing: result.passing,
      messages: result.messages,
    };
  },
});
