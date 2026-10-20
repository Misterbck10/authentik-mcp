import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import { resolveGroup } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { attributes, email, groupRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { validateUserAttributes } from "./attributes";
import { compactUser } from "./compact";

export const userFields = {
  username: z
    .string()
    .min(1)
    .max(150)
    .regex(/^[\w.@+-]+$/, "invalid username characters"),
  name: z.string().min(1).max(255),
  email: email.optional(),
  isActive: z.boolean().optional(),
  path: z.string().max(200).optional().describe('User path, e.g. "users/staff"'),
  type: z.enum(["internal", "external"]).optional(),
  attributes: attributes.optional().describe("Custom attributes, e.g. { department, jobTitle }"),
};

export async function groupPks(client: AuthentikClient, refs: string[] = []): Promise<string[]> {
  return Promise.all(refs.map(async (ref) => (await resolveGroup(client, ref)).pk));
}

export async function assertValidAttributes(
  client: AuthentikClient,
  attrs: Record<string, unknown>,
  excludeUserPk?: number,
): Promise<void> {
  const errors = await validateUserAttributes(client, attrs, { excludeUserPk });
  if (Object.keys(errors).length > 0) {
    throw new AuthentikError({
      status: 400,
      code: "invalid_attributes",
      message: "User attributes do not match the attribute definitions",
      fieldErrors: Object.fromEntries(
        Object.entries(errors).map(([key, message]) => [`attributes.${key}`, [message]]),
      ),
    });
  }
}

export const usersCreate = defineTool({
  name: "authentik_users_create",
  domain: "users",
  kind: "write",
  title: "Create user",
  description:
    "Create a user. Attributes are validated against the user attribute definitions. " +
    "Does not set a password; use send_recovery_link or onboard_employee for that.",
  input: z.object({ ...userFields, groups: z.array(groupRef).max(50).optional() }),
  handler: async (args, { client }) => {
    const attrs = args.attributes ?? {};
    await assertValidAttributes(client, attrs);
    const body: Schema<"UserRequest"> = {
      username: args.username,
      name: args.name,
      email: args.email,
      is_active: args.isActive ?? true,
      path: args.path,
      type: args.type,
      attributes: attrs,
      groups: await groupPks(client, args.groups),
    };
    const created = await client.post<Schema<"User">>("/core/users/", body);
    return { created: true, user: compactUser(created) };
  },
});
