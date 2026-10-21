import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import { isUuid } from "@/lib/authentik/resolve";
import type { Paginated, Schema } from "@/lib/authentik/types";

/** Picks the email stage by uuid/name, or the only/first configured one. */
export async function resolveEmailStagePk(client: AuthentikClient, ref?: string): Promise<string> {
  if (ref && isUuid(ref)) return ref;
  const page = await client.get<Paginated<Schema<"EmailStage">>>("/stages/email/", {
    ...(ref ? { name: ref } : {}),
    page_size: 20,
  });
  const stage = page.results[0];
  if (!stage) {
    throw new AuthentikError({
      status: 404,
      code: "no_email_stage",
      message: ref
        ? `Email stage not found: ${ref}`
        : "No email stage is configured in authentik; create one or use mode 'link'.",
    });
  }
  return stage.pk;
}

export interface RecoveryResult {
  mode: "email" | "link";
  sentTo?: string;
  link?: string;
}

const NO_RECOVERY_FLOW_HINT =
  "The brand has no recovery flow. Create one (e.g. apply the 'Example - Recovery with email " +
  "verification' blueprint) and set it with authentik_branding_brands_update { recoveryFlow }.";

/** Rewrites authentik's terse "No recovery flow set." into an actionable error. */
function explainRecoveryError(error: unknown): never {
  if (error instanceof AuthentikError && /no recovery flow/i.test(error.message)) {
    throw new AuthentikError({
      status: 400,
      code: "no_recovery_flow",
      message: NO_RECOVERY_FLOW_HINT,
    });
  }
  throw error;
}

/** Sends a recovery email or creates a recovery link (requires a recovery flow on the brand). */
export async function sendRecovery(
  client: AuthentikClient,
  user: Schema<"User">,
  options: { mode: "email" | "link"; emailStage?: string; tokenDuration?: string },
): Promise<RecoveryResult> {
  if (options.mode === "link") {
    const { link } = await client
      .post<Schema<"Link">>(`/core/users/${user.pk}/recovery/`, {
        token_duration: options.tokenDuration,
      })
      .catch(explainRecoveryError);
    return { mode: "link", link };
  }
  if (!user.email) {
    throw new AuthentikError({
      status: 400,
      code: "no_email",
      message: `User ${user.username} has no email address; use mode 'link'.`,
    });
  }
  await client
    .post(`/core/users/${user.pk}/recovery_email/`, {
      email_stage: await resolveEmailStagePk(client, options.emailStage),
      token_duration: options.tokenDuration,
    })
    .catch(explainRecoveryError);
  return { mode: "email", sentTo: user.email };
}
