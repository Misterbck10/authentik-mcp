import { z } from "zod";
import { listPaginated } from "@/lib/authentik/pagination";
import type { Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { secureUrl } from "@/lib/validation";
import { defineTool } from "../define-tool";

export const systemInfo = defineTool({
  name: "authentik_system_info",
  domain: "system",
  kind: "read",
  title: "System info",
  description: "authentik runtime info: base URL, server time, embedded outpost, runtime versions.",
  input: z.object({}),
  handler: async (_args, { client }) => {
    const info = await client.get<Schema<"SystemInfo">>("/admin/system/");
    // http_headers are omitted on purpose: they echo this server's request headers.
    return {
      baseUrl: info.base_url,
      httpHost: info.http_host,
      httpsSecure: info.http_is_secure,
      brand: info.brand,
      serverTime: info.server_time,
      embeddedOutpostDisabled: info.embedded_outpost_disabled,
      embeddedOutpostHost: info.embedded_outpost_host,
      runtime: info.runtime,
    };
  },
});

export const systemVersion = defineTool({
  name: "authentik_system_version",
  domain: "system",
  kind: "read",
  title: "Version",
  description: "Running and latest authentik version, and whether an upgrade is available.",
  input: z.object({}),
  handler: async (_args, { client }) => {
    const version = await client.get<Schema<"Version">>("/admin/version/");
    return {
      current: version.version_current,
      latest: version.version_latest,
      outdated: version.outdated,
      outpostOutdated: version.outpost_outdated,
      buildHash: version.build_hash,
    };
  },
});

export const systemWorkers = defineTool({
  name: "authentik_system_workers_status",
  domain: "system",
  kind: "read",
  title: "Worker status",
  description: "Connected background workers and whether their version matches the server.",
  input: z.object({}),
  handler: async (_args, { client }) => {
    const workers = await client.get<Schema<"Worker">[]>("/tasks/workers/");
    return {
      count: workers.length,
      healthy: workers.length > 0 && workers.every((w) => w.version_matching),
      workers: workers.map((w) => ({
        id: w.worker_id,
        version: w.version,
        versionMatching: w.version_matching,
      })),
    };
  },
});

export const systemTasksList = defineTool({
  name: "authentik_system_tasks_list",
  domain: "system",
  kind: "read",
  title: "List background tasks",
  description:
    "List recent background tasks (syncs, outposts, blueprints...). Filter by status, e.g. " +
    "error to find failures.",
  input: z.object({
    status: z
      .enum(["queued", "running", "done", "info", "warning", "error", "rejected"])
      .optional(),
    search: z.string().max(200).optional(),
    limit: z.number().int().positive().optional(),
  }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Schema<"Task">>(
      client,
      "/tasks/tasks/",
      { aggregated_status: args.status, search: args.search, ordering: "-mtime" },
      Math.min(args.limit ?? 50, env.MCP_MAX_PAGE_ITEMS),
    );
    return {
      total: page.total,
      tasks: page.results.map((task) => ({
        id: task.message_id,
        actor: task.actor_name,
        description: task.description,
        status: task.aggregated_status,
        modified: task.mtime,
        retries: task.retries,
        lastLog: task.logs.at(-1)?.event,
      })),
    };
  },
});

export const systemSettingsGet = defineTool({
  name: "authentik_system_settings_get",
  domain: "system",
  kind: "read",
  title: "Get system settings",
  description:
    "Global settings: base URL, avatars, whether users may change name/email/username, " +
    "event retention, footer links, impersonation, token defaults.",
  input: z.object({}),
  handler: async (_args, { client }) => client.get<Schema<"Settings">>("/admin/settings/"),
});

export const systemSettingsUpdate = defineTool({
  name: "authentik_system_settings_update",
  domain: "system",
  kind: "destructive",
  idempotent: true,
  title: "Update system settings",
  description:
    "Change global settings. Affects every user and brand; requires confirm: true (dry-run " +
    "shows a before/after diff).",
  input: z.object({
    baseUrl: secureUrl.optional().describe("Public base URL of authentik"),
    avatars: z.string().max(500).optional().describe('e.g. "gravatar,initials"'),
    allowChangeName: z.boolean().optional(),
    allowChangeEmail: z.boolean().optional(),
    allowChangeUsername: z.boolean().optional(),
    eventRetention: z.string().max(50).optional().describe('e.g. "days=365"'),
    footerLinks: z
      .array(z.object({ name: z.string().max(100), href: secureUrl }))
      .max(10)
      .optional(),
    gdprCompliance: z.boolean().optional(),
    impersonation: z.boolean().optional(),
    impersonationRequireReason: z.boolean().optional(),
    defaultTokenDuration: z.string().max(50).optional(),
    confirm: confirmField,
  }),
  handler: async (args, { client }) => {
    const changes: Schema<"PatchedSettingsRequest"> = {
      base_url: args.baseUrl,
      avatars: args.avatars,
      default_user_change_name: args.allowChangeName,
      default_user_change_email: args.allowChangeEmail,
      default_user_change_username: args.allowChangeUsername,
      event_retention: args.eventRetention,
      footer_links: args.footerLinks,
      gdpr_compliance: args.gdprCompliance,
      impersonation: args.impersonation,
      impersonation_require_reason: args.impersonationRequireReason,
      default_token_duration: args.defaultTokenDuration,
    };
    const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    if (Object.keys(defined).length === 0) return { changed: false, reason: "No settings given" };
    if (!args.confirm) {
      const current = await client.get<Record<string, unknown>>("/admin/settings/");
      const diff = Object.fromEntries(
        Object.entries(defined).map(([key, value]) => [key, { from: current[key], to: value }]),
      );
      return dryRun([`Update ${Object.keys(defined).length} global setting(s)`], diff);
    }
    return {
      changed: true,
      settings: await client.patch<Schema<"Settings">>("/admin/settings/", defined),
    };
  },
});

export const systemTools = [
  systemInfo,
  systemVersion,
  systemWorkers,
  systemTasksList,
  systemSettingsGet,
  systemSettingsUpdate,
];
