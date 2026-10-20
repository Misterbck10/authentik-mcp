import { z } from "zod";
import { resolveUser } from "@/lib/authentik/resolve";
import { tokenDuration, userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { sendRecovery } from "./recovery";

export const usersSendRecoveryLink = defineTool({
  name: "authentik_users_send_recovery_link",
  domain: "users",
  kind: "write",
  title: "Send password set/recovery link",
  description:
    "Let a user set or reset their password. mode 'email' (default) emails a link using an " +
    "email stage; mode 'link' returns the one-time link so you can share it securely — treat it " +
    "as a secret. Requires a recovery flow on the brand.",
  input: z.object({
    user: userRef,
    mode: z.enum(["email", "link"]).default("email"),
    emailStage: z.string().optional().describe("Email stage name or uuid (default: first one)"),
    tokenDuration: tokenDuration.optional(),
  }),
  handler: async (args, { client }) => {
    const user = await resolveUser(client, args.user);
    return {
      username: user.username,
      ...(await sendRecovery(client, user, args)),
    };
  },
});
