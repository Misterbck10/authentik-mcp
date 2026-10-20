import { z } from "zod";
import { resolveGroup } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { attributes, groupRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { compactGroup } from "./compact";

export const groupFields = {
  name: z.string().min(1).max(80),
  parents: z.array(groupRef).max(20).optional().describe("Parent groups (name or uuid)"),
  attributes: attributes.optional(),
};

export const groupsCreate = defineTool({
  name: "authentik_groups_create",
  domain: "groups",
  kind: "write",
  title: "Create group",
  description:
    "Create a group, optionally with parent groups and attributes. Superuser groups cannot be " +
    "created through this tool.",
  input: z.object(groupFields),
  handler: async (args, { client }) => {
    const parents = await Promise.all(
      (args.parents ?? []).map(async (ref) => (await resolveGroup(client, ref)).pk),
    );
    const body: Schema<"GroupRequest"> = {
      name: args.name,
      parents,
      attributes: args.attributes ?? {},
      is_superuser: false,
    };
    return {
      created: true,
      group: compactGroup(await client.post<Schema<"Group">>("/core/groups/", body)),
    };
  },
});
