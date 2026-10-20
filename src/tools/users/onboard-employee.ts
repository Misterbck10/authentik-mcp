import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import type { Paginated, Schema } from "@/lib/authentik/types";
import { email, groupRef, tokenDuration } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { compactUser } from "./compact";
import { assertValidAttributes, groupPks, userFields } from "./create";
import { sendRecovery } from "./recovery";

async function findExisting(
  client: AuthentikClient,
  username: string,
  emailAddress: string,
): Promise<Schema<"User"> | undefined> {
  for (const query of [{ username }, { email: emailAddress }]) {
    const page = await client.get<Paginated<Schema<"User">>>("/core/users/", {
      ...query,
      include_groups: true,
      page_size: 1,
    });
    if (page.results[0]) return page.results[0];
  }
  return undefined;
}

export const usersOnboardEmployee = defineTool({
  name: "authentik_users_onboard_employee",
  domain: "users",
  kind: "write",
  idempotent: true,
  title: "Onboard employee",
  description:
    "Create an employee account in one step: user with name/email/attributes (department, " +
    "jobTitle, plus any required attribute definitions), group memberships, and a password-set " +
    "link sent by email (or returned with passwordSetup 'link'). Idempotent: if the username " +
    "or email already exists, nothing is changed and the existing user is returned.",
  input: z.object({
    username: userFields.username,
    name: userFields.name,
    email,
    department: z.string().max(100).optional(),
    jobTitle: z.string().max(100).optional(),
    attributes: userFields.attributes,
    groups: z.array(groupRef).max(50).optional(),
    path: userFields.path,
    passwordSetup: z.enum(["email", "link", "none"]).default("email"),
    emailStage: z.string().optional().describe("Email stage name or uuid (default: first one)"),
    tokenDuration: tokenDuration.optional(),
  }),
  handler: async (args, { client }) => {
    const existing = await findExisting(client, args.username, args.email);
    if (existing) {
      return {
        created: false,
        reason: "A user with this username or email already exists; nothing was changed.",
        user: compactUser(existing),
      };
    }

    const attributes = {
      ...args.attributes,
      ...(args.department ? { department: args.department } : {}),
      ...(args.jobTitle ? { jobTitle: args.jobTitle } : {}),
    };
    // Validate everything before creating anything, so a bad group or attribute leaves no trace.
    await assertValidAttributes(client, attributes);
    const groups = await groupPks(client, args.groups);

    const user = await client.post<Schema<"User">>("/core/users/", {
      username: args.username,
      name: args.name,
      email: args.email,
      is_active: true,
      type: "internal",
      path: args.path,
      attributes,
      groups,
    } satisfies Schema<"UserRequest">);

    const passwordSetup =
      args.passwordSetup === "none"
        ? { mode: "none" as const }
        : await sendRecovery(client, user, {
            mode: args.passwordSetup,
            emailStage: args.emailStage,
            tokenDuration: args.tokenDuration,
          }).catch((error: unknown) => ({
            mode: args.passwordSetup,
            error: error instanceof Error ? error.message : "failed",
            hint: "User was created; retry with authentik_users_send_recovery_link.",
          }));

    const fresh = await client.get<Schema<"User">>(`/core/users/${user.pk}/`, {
      include_groups: true,
    });
    return { created: true, user: compactUser(fresh), passwordSetup };
  },
});
