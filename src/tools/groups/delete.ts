import { z } from "zod";
import { resolveGroup } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { groupRef } from "@/lib/validation";
import { defineTool } from "../define-tool";

export const groupsDelete = defineTool({
  name: "authentik_groups_delete",
  domain: "groups",
  kind: "destructive",
  idempotent: true,
  title: "Delete group",
  description:
    "Delete a group. Members lose access granted through it and policy bindings referencing it " +
    "are removed. The dry-run (no confirm) lists objects that use the group.",
  input: z.object({ group: groupRef, confirm: confirmField }),
  handler: async (args, { client }) => {
    const group = await resolveGroup(client, args.group, { includeUsers: true });
    if (!args.confirm) {
      const usedBy = await client.get<Schema<"UsedBy">[]>(`/core/groups/${group.pk}/used_by/`);
      return dryRun(
        [`Delete group ${group.name} (${group.users?.length ?? 0} member(s))`],
        {
          usedBy: usedBy.map((use) => ({
            model: use.model_name,
            name: use.name,
            action: use.action,
          })),
        },
        group.is_superuser ? ["This is a superuser group."] : [],
      );
    }
    await client.delete(`/core/groups/${group.pk}/`);
    return { deleted: true, group: group.name };
  },
});
