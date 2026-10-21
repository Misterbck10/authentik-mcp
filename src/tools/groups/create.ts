import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
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

const MAX_ANCESTORS = 100;

/**
 * Throws if any of `groups` or their ancestors is a superuser group: authentik inherits
 * is_superuser from ancestors, so membership (direct or via a child group) grants admin.
 */
export async function assertNoSuperuserAncestry(
  client: AuthentikClient,
  groups: Schema<"Group">[],
  role: string,
): Promise<void> {
  const seen = new Set<string>();
  const queue = [...groups];
  while (queue.length > 0) {
    const group = queue.shift()!;
    if (seen.has(group.pk)) continue;
    seen.add(group.pk);
    if (group.is_superuser) {
      throw new AuthentikError({
        status: 403,
        code: "forbidden",
        message: `Group "${group.name}" grants superuser and cannot be used as ${role}.`,
      });
    }
    if (seen.size > MAX_ANCESTORS) {
      throw new AuthentikError({
        status: 400,
        code: "validation_error",
        message: "Parent hierarchy is too deep to verify.",
      });
    }
    for (const pk of group.parents ?? []) {
      if (!seen.has(pk)) queue.push(await resolveGroup(client, pk));
    }
  }
}

/** Resolves parent refs to pks, refusing parents that grant superuser. */
export async function resolveParents(client: AuthentikClient, refs: string[]): Promise<string[]> {
  const groups = await Promise.all(refs.map((ref) => resolveGroup(client, ref)));
  await assertNoSuperuserAncestry(client, groups, "a parent");
  return groups.map((group) => group.pk);
}

export const groupsCreate = defineTool({
  name: "authentik_groups_create",
  domain: "groups",
  kind: "write",
  title: "Create group",
  description:
    "Create a group, optionally with parent groups and attributes. Superuser groups cannot be " +
    "created through this tool, and parents that inherit superuser are refused.",
  input: z.object(groupFields),
  handler: async (args, { client }) => {
    const parents = await resolveParents(client, args.parents ?? []);
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
