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

async function buildPlan(
  client: AuthentikClient,
  ref: string | number,
  tokenPreview: number,
): Promise<OffboardPlan> {
  const user = await resolveUser(client, ref);
  const [tokens, sessions] = await Promise.all([
    listPaginated<Schema<"Token">>(
      client,
      "/core/tokens/",
      { user__username: user.username },
      tokenPreview,
    ),
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

const TOKEN_CONCURRENCY = 5;
// Leaves headroom under the route's 60 s maxDuration for the steps after token deletion.
const TOKEN_BUDGET_MS = 30_000;

/**
 * Deletes every token of the user, re-listing until none remain, so users with more tokens
 * than one listing returns are still fully revoked. Tokens that vanish meanwhile (404) count
 * as gone. Stops at the time budget and reports how many remain instead of being killed.
 */
async function deleteAllTokens(
  client: AuthentikClient,
  username: string,
): Promise<{ deleted: number; remaining: number }> {
  const deadline = Date.now() + TOKEN_BUDGET_MS;
  let deleted = 0;
  for (;;) {
    const page = await listPaginated<Schema<"Token">>(
      client,
      "/core/tokens/",
      { user__username: username },
      100,
    );
    if (page.results.length === 0) return { deleted, remaining: 0 };
    if (Date.now() > deadline) return { deleted, remaining: page.total };
    const queue = [...page.results];
    const worker = async () => {
      for (let token = queue.shift(); token; token = queue.shift()) {
        try {
          await client.deleteObject(`/core/tokens/${encodeURIComponent(token.identifier)}/`);
          deleted++;
        } catch (error) {
          if (!(error instanceof AuthentikError && error.status === 404)) throw error;
        }
      }
    };
    await Promise.all(Array.from({ length: TOKEN_CONCURRENCY }, worker));
  }
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
    // The token list is only shown in the dry run; confirmed runs re-list while deleting.
    const plan = await buildPlan(client, args.user, args.confirm ? 1 : 50);
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
    // Sessions before tokens: logging the user out is quick and matters most if time runs out.
    const revokedSessions =
      args.revokeSessions && plan.sessionCount
        ? (
            await client.delete<Schema<"BulkDeleteSessionResponse">>(
              "/core/authenticated_sessions/bulk_delete/",
              { user_pks: [user.pk] },
            )
          ).deleted
        : 0;
    const tokens = args.revokeTokens
      ? await deleteAllTokens(client, user.username)
      : { deleted: 0, remaining: 0 };
    // Deleting the user also removes its remaining tokens.
    if (args.deleteUser) await client.deleteObject(`/core/users/${user.pk}/`);
    const complete = tokens.remaining === 0 || args.deleteUser;

    return {
      offboarded: complete,
      username: user.username,
      deactivated: true,
      removedGroups: args.removeGroups ? plan.groups.map((group) => group.name) : [],
      deletedTokens: tokens.deleted,
      ...(complete
        ? {}
        : {
            remainingTokens: tokens.remaining,
            note: "Time budget reached; run offboard_employee again to delete the rest.",
          }),
      revokedSessions,
      deleted: args.deleteUser,
    };
  },
});
