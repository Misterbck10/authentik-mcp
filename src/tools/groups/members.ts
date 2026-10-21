import { z } from "zod";
import { resolveGroup, resolveUser } from "@/lib/authentik/resolve";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { groupRef, userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { assertNoSuperuserAncestry } from "./create";

const usersInput = z.array(userRef).min(1).max(100);

export const groupsListMembers = defineTool({
  name: "authentik_groups_list_members",
  domain: "groups",
  kind: "read",
  title: "List group members",
  description: "List the direct members of a group (username, name, email, active).",
  input: z.object({ group: groupRef }),
  handler: async (args, { client, env }) => {
    const group = await resolveGroup(client, args.group, { includeUsers: true });
    const members = (group.users_obj ?? []).slice(0, env.MCP_MAX_PAGE_ITEMS);
    return {
      group: group.name,
      total: group.users_obj?.length ?? 0,
      members: members.map((user) => ({
        pk: user.pk,
        username: user.username,
        name: user.name,
        email: user.email ?? "",
        isActive: user.is_active ?? true,
      })),
    };
  },
});

export const groupsAddMembers = defineTool({
  name: "authentik_groups_add_members",
  domain: "groups",
  kind: "write",
  idempotent: true,
  title: "Add members to group",
  description:
    "Add one or more users (pk, username or email) to a group. Groups that grant superuser " +
    "(directly or through a parent) are refused.",
  input: z.object({ group: groupRef, users: usersInput }),
  handler: async (args, { client }) => {
    const group = await resolveGroup(client, args.group);
    await assertNoSuperuserAncestry(client, [group], "a membership target");
    const users = await Promise.all(args.users.map((ref) => resolveUser(client, ref)));
    for (const user of users)
      await client.post(`/core/groups/${group.pk}/add_user/`, { pk: user.pk });
    return { group: group.name, added: users.map((user) => user.username) };
  },
});

export const groupsRemoveMembers = defineTool({
  name: "authentik_groups_remove_members",
  domain: "groups",
  kind: "destructive",
  idempotent: true,
  title: "Remove members from group",
  description:
    "Remove one or more users from a group; they may lose application access. Without " +
    "confirm: true returns a dry-run.",
  input: z.object({ group: groupRef, users: usersInput, confirm: confirmField }),
  handler: async (args, { client }) => {
    const group = await resolveGroup(client, args.group);
    const users = await Promise.all(args.users.map((ref) => resolveUser(client, ref)));
    const usernames = users.map((user) => user.username);
    if (!args.confirm) return dryRun([`Remove ${usernames.join(", ")} from ${group.name}`]);
    for (const user of users) {
      await client.post(`/core/groups/${group.pk}/remove_user/`, { pk: user.pk });
    }
    return { group: group.name, removed: usernames };
  },
});
