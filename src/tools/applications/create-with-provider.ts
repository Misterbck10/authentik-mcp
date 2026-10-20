import { z } from "zod";
import { AuthentikError } from "@/lib/authentik/errors";
import { resolveApplication, resolveGroup } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { groupRef, slug } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { getProviderDetail, providerEndpoints } from "../providers/fetch";
import { compactApplication } from "./compact";
import { buildProvider, providerInput } from "./provider-builders";

export const applicationsCreateWithProvider = defineTool({
  name: "authentik_applications_create_with_provider",
  domain: "applications",
  kind: "write",
  returnsNewSecret: true,
  title: "Create application with provider (SSO)",
  description:
    "Create an application and its provider atomically (all or nothing) to connect a service " +
    "to authentik SSO. Provider types: oauth2 (OIDC — preferred when the app supports it), " +
    "proxy (forward auth for apps without SSO support; then add it to an outpost), saml, ldap, rac. " +
    "Optionally restrict access to groups. Returns connection details; for OAuth2 the " +
    "client_secret is shown ONCE here — store it safely.",
  input: z.object({
    name: z.string().min(1).max(200),
    slug,
    provider: providerInput,
    launchUrl: z.url().optional(),
    description: z.string().max(500).optional(),
    publisher: z.string().max(200).optional(),
    group: z.string().max(200).optional().describe("Section name in the user's app library"),
    openInNewTab: z.boolean().optional(),
    allowedGroups: z
      .array(groupRef)
      .max(20)
      .optional()
      .describe("Only members of these groups may access the app (bound as policy bindings)"),
  }),
  handler: async (args, { client, env }) => {
    const existing = await resolveApplication(client, args.slug).catch(() => undefined);
    if (existing) {
      throw new AuthentikError({
        status: 409,
        code: "conflict",
        message: `An application with slug "${args.slug}" already exists.`,
      });
    }

    const { model, body } = await buildProvider(
      client,
      env,
      `Provider for ${args.name}`,
      args.provider,
    );
    const groups = await Promise.all(
      (args.allowedGroups ?? []).map((ref) => resolveGroup(client, ref)),
    );

    const request: Schema<"TransactionApplicationRequest"> = {
      app: {
        name: args.name,
        slug: args.slug,
        meta_launch_url: args.launchUrl,
        meta_description: args.description,
        meta_publisher: args.publisher,
        group: args.group,
        open_in_new_tab: args.openInNewTab,
        policy_engine_mode: "any",
      },
      provider_model: model,
      provider: body as Schema<"TransactionApplicationRequest">["provider"],
      policy_bindings: groups.map((group, index) => ({ group: group.pk, order: index })),
    };
    const result = await client.put<Schema<"TransactionApplicationResponse">>(
      "/core/transactional/applications/",
      request,
    );
    if (!result.applied) {
      throw new AuthentikError({
        status: 400,
        code: "not_applied",
        message: `authentik did not apply the application: ${result.logs.join(" | ")}`,
      });
    }

    const app = await resolveApplication(client, args.slug);
    if (!app.provider) return { created: true, application: compactApplication(app) };
    const { type, provider } = await getProviderDetail(client, app.provider);
    return {
      created: true,
      application: compactApplication(app),
      provider: { pk: provider.pk, type, name: provider.name },
      connection: await providerEndpoints(client, type, provider),
      ...(type === "oauth2" && provider.client_type === "confidential"
        ? {
            clientSecret: provider.client_secret,
            secretNotice: "Shown once. Use authentik_providers_get_secret to retrieve it later.",
          }
        : {}),
      accessRestrictedTo: groups.map((group) => group.name),
    };
  },
});
