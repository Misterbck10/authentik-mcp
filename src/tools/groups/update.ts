import { z } from "zod";
import { resolveGroup } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { groupRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { compactGroup } from "./compact";
import { groupFields } from "./create";

export const groupsUpdate = defineTool({
  name: "authentik_groups_update",
  domain: "groups",
  kind: "write",
  idempotent: true,
  title: "Update group",
  description:
    "Rename a group, replace its parents, or merge attributes (replaceAttributes: true to " +
    "overwrite). Membership is managed with add_members/remove_members.",
  input: z.object({
    group: groupRef,
    name: groupFields.name.optional(),
    parents: groupFields.parents,
    attributes: groupFields.attributes,
    replaceAttributes: z.boolean().optional(),
  }),
  handler: async (args, { client }) => {
    const current = await resolveGroup(client, args.group);
    const parents = args.parents
      ? await Promise.all(args.parents.map(async (ref) => (await resolveGroup(client, ref)).pk))
      : undefined;
    const attributes = args.attributes
      ? args.replaceAttributes
        ? args.attributes
        : { ...current.attributes, ...args.attributes }
      : undefined;
    const body: Schema<"PatchedGroupRequest"> = { name: args.name, parents, attributes };
    const updated = await client.patch<Schema<"Group">>(`/core/groups/${current.pk}/`, body);
    return { updated: true, group: compactGroup(updated) };
  },
});
