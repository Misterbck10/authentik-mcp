import { z } from "zod";
import { resolveUser } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { compactUser } from "./compact";

function setActiveTool(active: boolean) {
  return defineTool({
    name: active ? "authentik_users_activate" : "authentik_users_deactivate",
    domain: "users",
    kind: "write",
    idempotent: true,
    title: active ? "Activate user" : "Deactivate user",
    description: active
      ? "Re-activate a deactivated user so they can log in again."
      : "Deactivate a user: they can no longer log in. Reversible; prefer this over delete. " +
        "Existing sessions are not revoked (use revoke_sessions or offboard_employee).",
    input: z.object({ user: userRef }),
    handler: async ({ user }, { client }) => {
      const current = await resolveUser(client, user);
      const updated = await client.patch<Schema<"User">>(`/core/users/${current.pk}/`, {
        is_active: active,
      });
      return { changed: current.is_active !== active, user: compactUser(updated) };
    },
  });
}

export const usersActivate = setActiveTool(true);
export const usersDeactivate = setActiveTool(false);
