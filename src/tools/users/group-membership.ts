import { z } from "zod";
import { resolveGroup, resolveUser } from "@/lib/authentik/resolve";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { groupRef, userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";

export const usersAddToGroup = defineTool({
  name: "authentik_users_add_to_group",
  domain: "users",
  kind: "write",
  idempotent: true,
  title: "Add user to group",
  description: "Add a user to a group (by group name or uuid). No-op if already a member.",
  input: z.object({ user: userRef, group: groupRef }),
  handler: async (args, { client }) => {
    const [user, group] = await Promise.all([
      resolveUser(client, args.user),
      resolveGroup(client, args.group),
    ]);
    await client.post(`/core/groups/${group.pk}/add_user/`, { pk: user.pk });
    return { added: true, username: user.username, group: group.name };
  },
});

export const usersRemoveFromGroup = defineTool({
  name: "authentik_users_remove_from_group",
  domain: "users",
  kind: "destructive",
  idempotent: true,
  title: "Remove user from group",
  description:
    "Remove a user from a group. May revoke access to applications bound to that group. " +
    "Without confirm: true returns a dry-run.",
  input: z.object({ user: userRef, group: groupRef, confirm: confirmField }),
  handler: async (args, { client }) => {
    const [user, group] = await Promise.all([
      resolveUser(client, args.user),
      resolveGroup(client, args.group),
    ]);
    if (!args.confirm) return dryRun([`Remove ${user.username} from group ${group.name}`]);
    await client.post(`/core/groups/${group.pk}/remove_user/`, { pk: user.pk });
    return { removed: true, username: user.username, group: group.name };
  },
});
