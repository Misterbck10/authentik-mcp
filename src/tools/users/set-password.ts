import { z } from "zod";
import { resolveUser } from "@/lib/authentik/resolve";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";

export const usersSetPassword = defineTool({
  name: "authentik_users_set_password",
  domain: "users",
  kind: "destructive",
  title: "Set user password",
  description:
    "Set a user's password directly (replaces the current one). Prefer send_recovery_link so " +
    "the user chooses their own password. The password is never logged or returned. " +
    "Requires confirm: true.",
  input: z.object({
    user: userRef,
    password: z.string().min(8).max(256),
    confirm: confirmField,
  }),
  idempotent: true,
  handler: async ({ user, password, confirm }, { client }) => {
    const target = await resolveUser(client, user);
    if (!confirm) return dryRun([`Replace the password of ${target.username}`]);
    await client.post(`/core/users/${target.pk}/set_password/`, { password });
    return { passwordSet: true, username: target.username };
  },
});
