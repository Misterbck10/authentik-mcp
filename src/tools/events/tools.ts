import { z } from "zod";
import type { AuthentikClient, Query } from "@/lib/authentik/client";
import { listPaginated } from "@/lib/authentik/pagination";
import { resolveUser } from "@/lib/authentik/resolve";
import type { Paginated, Schema } from "@/lib/authentik/types";
import { userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";

type Event = Schema<"Event">;

const isoDate = z.iso.datetime({ offset: true }).or(z.iso.date());

function compactEvent(event: Event) {
  const user = (event.user ?? {}) as { username?: string; pk?: number };
  return {
    pk: event.pk,
    created: event.created,
    action: event.action,
    username: user.username,
    clientIp: event.client_ip ?? null,
    app: event.app,
    context: event.context,
  };
}

const MAX_EVENT_PAGES = 50;

/** Pages through events newest-first, applying the date window client-side (API has no date filter). */
async function collectEvents(
  client: AuthentikClient,
  query: Query,
  window: { since?: string; until?: string },
  limit: number,
): Promise<{ events: Event[]; truncated: boolean }> {
  const since = window.since ? Date.parse(window.since) : -Infinity;
  const until = window.until ? Date.parse(window.until) : Infinity;
  const events: Event[] = [];
  for (let pageNumber = 1; pageNumber <= MAX_EVENT_PAGES; pageNumber++) {
    const page = await client.get<Paginated<Event>>("/events/events/", {
      ...query,
      ordering: "-created",
      page: pageNumber,
      page_size: 100,
    });
    for (const event of page.results) {
      const created = Date.parse(event.created);
      if (created < since) return { events, truncated: false };
      if (created > until) continue;
      // Truncated only when a further matching event exists beyond the limit.
      if (events.length >= limit) return { events, truncated: true };
      events.push(event);
    }
    if (!page.pagination.next) return { events, truncated: false };
  }
  // Page cap reached with more events left: the window was not fully scanned.
  return { events, truncated: true };
}

const eventFilters = {
  action: z.string().max(100).optional().describe("e.g. login, login_failed, model_updated"),
  username: z.string().max(150).optional(),
  clientIp: z.string().max(64).optional(),
  application: z.string().max(200).optional().describe("Authorized application name"),
  search: z.string().max(200).optional(),
  since: isoDate.optional().describe("ISO date/time, inclusive"),
  until: isoDate.optional().describe("ISO date/time, inclusive"),
};

export const eventsList = defineTool({
  name: "authentik_events_list",
  domain: "events",
  kind: "read",
  title: "List audit events",
  description:
    "Search the authentik audit log (logins, failures, model changes, app authorizations...) " +
    "newest first, with filters by action, user, IP, application and date range.",
  input: z.object({ ...eventFilters, limit: z.number().int().positive().optional() }),
  handler: async (args, { client, env }) => {
    const { events, truncated } = await collectEvents(
      client,
      {
        action: args.action,
        username: args.username,
        client_ip: args.clientIp,
        context_authorized_app: args.application,
        search: args.search,
      },
      args,
      Math.min(args.limit ?? 50, env.MCP_MAX_PAGE_ITEMS),
    );
    return { returned: events.length, truncated, events: events.map(compactEvent) };
  },
});

export const eventsGet = defineTool({
  name: "authentik_events_get",
  domain: "events",
  kind: "read",
  title: "Get event",
  description: "Get one audit event with its full context.",
  input: z.object({ pk: z.guid() }),
  handler: async ({ pk }, { client }) =>
    compactEvent(await client.get<Event>(`/events/events/${pk}/`)),
});

export const eventsTopPerUser = defineTool({
  name: "authentik_events_top_per_user",
  domain: "events",
  kind: "read",
  title: "Top events per user",
  description:
    "Rank applications/users by event count for an action (default authorize_application), " +
    "e.g. most used apps.",
  input: z.object({
    action: z.string().max(100).default("authorize_application"),
    topN: z.number().int().min(1).max(100).default(15),
  }),
  handler: async (args, { client }) =>
    client.get<Schema<"EventTopPerUser">[]>("/events/events/top_per_user/", {
      action: args.action,
      top_n: args.topN,
    }),
});

export const notificationsList = defineTool({
  name: "authentik_events_notifications_list",
  domain: "events",
  kind: "read",
  title: "List notifications",
  description: "List notifications addressed to the service account behind this server.",
  input: z.object({ unseenOnly: z.boolean().default(true) }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Schema<"Notification">>(
      client,
      "/events/notifications/",
      { seen: args.unseenOnly ? false : undefined, ordering: "-created" },
      env.MCP_MAX_PAGE_ITEMS,
    );
    return {
      total: page.total,
      notifications: page.results.map((n) => ({
        pk: n.pk,
        created: n.created,
        severity: n.severity,
        body: n.body,
        seen: n.seen ?? false,
        action: n.event?.action,
      })),
    };
  },
});

const SUMMARY_ACTIONS = [
  "login",
  "login_failed",
  "logout",
  "password_set",
  "authorize_application",
  "user_write",
  "suspicious_request",
];

export const auditUserActivity = defineTool({
  name: "authentik_events_audit_user_activity",
  domain: "events",
  kind: "read",
  title: "Summarise user activity",
  description:
    "Summarise a user's recent activity: logins, failed logins (with IPs), password changes, " +
    "apps used and the latest events. Good first step for security questions about a user.",
  input: z.object({ user: userRef, days: z.number().int().min(1).max(365).default(30) }),
  handler: async (args, { client }) => {
    const user = await resolveUser(client, args.user);
    const since = new Date(Date.now() - args.days * 86_400_000).toISOString();
    const { events, truncated } = await collectEvents(
      client,
      { username: user.username },
      { since },
      1000,
    );

    const counts: Record<string, number> = {};
    const failedIps = new Set<string>();
    const apps = new Set<string>();
    for (const event of events) {
      counts[event.action] = (counts[event.action] ?? 0) + 1;
      if (event.action === "login_failed" && event.client_ip) failedIps.add(event.client_ip);
      const app = (event.context as { authorized_application?: { name?: string } } | undefined)
        ?.authorized_application?.name;
      if (event.action === "authorize_application" && app) apps.add(app);
    }
    const lastOf = (action: string) =>
      events.find((event) => event.action === action)?.created ?? null;

    return {
      username: user.username,
      isActive: user.is_active ?? true,
      periodDays: args.days,
      totalEvents: events.length,
      partial: truncated,
      counts: Object.fromEntries(SUMMARY_ACTIONS.map((action) => [action, counts[action] ?? 0])),
      otherActions: Object.fromEntries(
        Object.entries(counts).filter(([action]) => !SUMMARY_ACTIONS.includes(action)),
      ),
      lastLogin: lastOf("login"),
      lastFailedLogin: lastOf("login_failed"),
      lastPasswordChange: lastOf("password_set"),
      failedLoginIps: [...failedIps],
      applicationsUsed: [...apps],
      recent: events.slice(0, 10).map(compactEvent),
    };
  },
});

export const eventTools = [
  eventsList,
  eventsGet,
  eventsTopPerUser,
  notificationsList,
  auditUserActivity,
];
