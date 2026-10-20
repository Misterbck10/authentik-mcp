import { z } from "zod";
import { listPaginated } from "@/lib/authentik/pagination";
import { resolveUser } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";

type Session = Schema<"AuthenticatedSession">;

const compactSession = (session: Session) => ({
  uuid: session.uuid,
  lastIp: session.last_ip,
  lastUserAgent: session.last_user_agent,
  lastUsed: session.last_used,
  expires: session.expires,
});

export const usersListSessions = defineTool({
  name: "authentik_users_list_sessions",
  domain: "users",
  kind: "read",
  title: "List user sessions",
  description: "List active authenticated sessions of a user (IP, user agent, last used, expiry).",
  input: z.object({ user: userRef }),
  handler: async ({ user }, { client, env }) => {
    const target = await resolveUser(client, user);
    const page = await listPaginated<Session>(
      client,
      "/core/authenticated_sessions/",
      { user__username: target.username },
      env.MCP_MAX_PAGE_ITEMS,
    );
    return {
      username: target.username,
      total: page.total,
      sessions: page.results.map(compactSession),
    };
  },
});

export const usersRevokeSessions = defineTool({
  name: "authentik_users_revoke_sessions",
  domain: "users",
  kind: "destructive",
  idempotent: true,
  title: "Revoke user sessions",
  description:
    "Log a user out everywhere by deleting all their sessions. Without confirm: true returns " +
    "a dry-run with the session count.",
  input: z.object({ user: userRef, confirm: confirmField }),
  handler: async ({ user, confirm }, { client }) => {
    const target = await resolveUser(client, user);
    if (!confirm) {
      const page = await listPaginated<Session>(
        client,
        "/core/authenticated_sessions/",
        { user__username: target.username },
        1,
      );
      return dryRun([`Revoke ${page.total} session(s) of ${target.username}`]);
    }
    const result = await client.delete<Schema<"BulkDeleteSessionResponse">>(
      "/core/authenticated_sessions/bulk_delete/",
      { user_pks: [target.pk] },
    );
    return { revoked: result.deleted, username: target.username };
  },
});
