import { z } from "zod";
import { resolveUser } from "@/lib/authentik/resolve";
import { userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { compactUser } from "./compact";

export const usersGet = defineTool({
  name: "authentik_users_get",
  domain: "users",
  kind: "read",
  title: "Get user",
  description: "Get one user by pk, username or email, including groups and attributes.",
  input: z.object({ user: userRef }),
  handler: async ({ user }, { client }) => compactUser(await resolveUser(client, user)),
});
