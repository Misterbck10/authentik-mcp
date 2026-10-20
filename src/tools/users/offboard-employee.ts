import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { listPaginated } from "@/lib/authentik/pagination";
import { resolveUser } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";

interface OffboardPlan {
  user: Schema<"User">;
  groups: { pk: string; name: string }[];
  tokens: Schema<"Token">[];
  sessionCount: number;
}

async function buildPlan(client: AuthentikClient, ref: string | number): Promise<OffboardPlan> {
  const user = await resolveUser(client, ref);
  const [tokens, sessions] = await Promise.all([
    listPaginated<Schema<"Token">>(client, "/core/tokens/", { user__username: user.username }, 500),
    listPaginated<Schema<"AuthenticatedSession">>(
      client,
      "/core/authenticated_sessions/",
      { user__username: user.username },
      1,
    ),
  ]);
  return {
    user,
    groups: (user.groups_obj ?? []).map((group) => ({ pk: group.pk, name: group.name })),
    tokens: tokens.results,
    sessionCount: sessions.total,
  };
}

export const usersOffboardEmployee = defineTool({
  name: "authentik_users_offboard_employee",
  domain: "users",
  kind: "destructive",
  idempotent: true,
  title: "Offboard employee",
  description:
    "Immediately offboard an employee: deactivate the account, remove all group memberships, " +
    "revoke all API/app tokens and log out all sessions. Deletion is opt-in (deleteUser: true). " +
    "Without confirm: true returns a dry-run listing exactly what would change.",
  input: z.object({
    user: userRef,
    removeGroups: z.boolean().default(true),
    revokeTokens: z.boolean().default(true),
    revokeSessions: z.boolean().default(true),
    deleteUser: z.boolean().default(false),
    confirm: confirmField,
  }),
  handler: async (args, { client }) => {
    const plan = await buildPlan(client, args.user);
    const { user } = plan;
    const steps = [
      `Deactivate ${user.username}`,
      ...(args.removeGroups && plan.groups.length
        ? [`Remove from groups: ${plan.groups.map((group) => group.name).join(", ")}`]
        : []),
      ...(args.revokeTokens && plan.tokens.length
        ? [
            `Delete ${plan.tokens.length} token(s): ${plan.tokens.map((t) => t.identifier).join(", ")}`,
          ]
        : []),
      ...(args.revokeSessions && plan.sessionCount
        ? [`Revoke ${plan.sessionCount} session(s)`]
        : []),
      ...(args.deleteUser ? [`Permanently delete ${user.username}`] : []),
    ];
    if (!args.confirm) {
      return dryRun(steps, undefined, user.is_superuser ? ["This user is a superuser."] : []);
    }

    // Deactivate first so the account is locked even if a later step fails.
    await client.patch(`/core/users/${user.pk}/`, { is_active: false });
    if (args.removeGroups && plan.groups.length) {
      await client.patch(`/core/users/${user.pk}/`, { groups: [] });
    }
    if (args.revokeTokens) {
      for (const token of plan.tokens) {
        await client.delete(`/core/tokens/${encodeURIComponent(token.identifier)}/`);
      }
    }
    const revokedSessions =
      args.revokeSessions && plan.sessionCount
        ? (
            await client.delete<Schema<"BulkDeleteSessionResponse">>(
              "/core/authenticated_sessions/bulk_delete/",
              { user_pks: [user.pk] },
            )
          ).deleted
        : 0;
    if (args.deleteUser) await client.delete(`/core/users/${user.pk}/`);

    return {
      offboarded: true,
      username: user.username,
      deactivated: true,
      removedGroups: args.removeGroups ? plan.groups.map((group) => group.name) : [],
      deletedTokens: args.revokeTokens ? plan.tokens.length : 0,
      revokedSessions,
      deleted: args.deleteUser,
    };
  },
});
