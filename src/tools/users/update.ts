import { z } from "zod";
import { resolveUser } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { compactUser } from "./compact";
import { assertValidAttributes, userFields } from "./create";

export const usersUpdate = defineTool({
  name: "authentik_users_update",
  domain: "users",
  kind: "write",
  title: "Update user",
  description:
    "Update name, username, email, path, type or attributes of a user. Attributes are merged " +
    "into the existing ones unless replaceAttributes is true. Use add_to_group/remove_from_group " +
    "for memberships and activate/deactivate for the active flag.",
  input: z.object({
    user: userRef,
    username: userFields.username.optional(),
    name: userFields.name.optional(),
    email: userFields.email,
    path: userFields.path,
    type: userFields.type,
    attributes: userFields.attributes,
    replaceAttributes: z.boolean().optional(),
  }),
  idempotent: true,
  handler: async (args, { client }) => {
    const current = await resolveUser(client, args.user);
    const attributes = args.attributes
      ? args.replaceAttributes
        ? args.attributes
        : { ...current.attributes, ...args.attributes }
      : undefined;
    if (attributes) await assertValidAttributes(client, attributes, current.pk);
    const body: Schema<"PatchedUserRequest"> = {
      username: args.username,
      name: args.name,
      email: args.email,
      path: args.path,
      type: args.type,
      attributes,
    };
    const updated = await client.patch<Schema<"User">>(`/core/users/${current.pk}/`, body);
    return { updated: true, user: compactUser(updated) };
  },
});
