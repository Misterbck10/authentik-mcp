import { z } from "zod";
import { resolveUser } from "@/lib/authentik/resolve";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { compactUser } from "./compact";

export const usersDelete = defineTool({
  name: "authentik_users_delete",
  domain: "users",
  kind: "destructive",
  title: "Delete user",
  description:
    "Permanently delete a user (irreversible; audit history keeps the username). " +
    "Prefer deactivate. Without confirm: true returns a dry-run.",
  input: z.object({ user: userRef, confirm: confirmField }),
  idempotent: true,
  handler: async ({ user, confirm }, { client }) => {
    const target = await resolveUser(client, user);
    if (!confirm) {
      const warnings = target.is_superuser ? ["This user is a superuser."] : [];
      return dryRun(
        [`Delete user ${target.username} (pk ${target.pk})`],
        compactUser(target),
        warnings,
      );
    }
    await client.delete(`/core/users/${target.pk}/`);
    return { deleted: true, username: target.username, pk: target.pk };
  },
});
