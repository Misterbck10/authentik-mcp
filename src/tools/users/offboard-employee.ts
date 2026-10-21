import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
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
  tokenCount: number;
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
    tokenCount: tokens.total,
    sessionCount: sessions.total,
  };
}

const MAX_TOKEN_ROUNDS = 50;

/**
 * Deletes every token of the user, re-listing until none remain, so users with more tokens
 * than one listing returns are still fully revoked. Throws if tokens are left over.
 */
async function deleteAllTokens(client: AuthentikClient, username: string): Promise<number> {
  let deleted = 0;
  for (let round = 0; round < MAX_TOKEN_ROUNDS; round++) {
    const page = await listPaginated<Schema<"Token">>(
      client,
      "/core/tokens/",
      { user__username: username },
      100,
    );
    if (page.results.length === 0) return deleted;
    for (const token of page.results) {
      await client.delete(`/core/tokens/${encodeURIComponent(token.identifier)}/`);
      deleted++;
    }
  }
  throw new AuthentikError({
    status: 500,
    code: "tokens_remaining",
    message: `Deleted ${deleted} token(s) but some remain; run offboarding again.`,
  });
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
      ...(args.revokeTokens && plan.tokenCount
        ? [
            `Delete ${plan.tokenCount} token(s): ${plan.tokens.map((t) => t.identifier).join(", ")}` +
              (plan.tokenCount > plan.tokens.length ? ", …" : ""),
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
    const deletedTokens = args.revokeTokens ? await deleteAllTokens(client, user.username) : 0;
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
      deletedTokens,
      revokedSessions,
      deleted: args.deleteUser,
    };
  },
});
