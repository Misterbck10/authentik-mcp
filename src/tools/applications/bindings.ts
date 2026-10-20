import { z } from "zod";
import { AuthentikError } from "@/lib/authentik/errors";
import { listPaginated } from "@/lib/authentik/pagination";
import { resolveApplication, resolveGroup, resolveUser } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { groupRef, slug, userRef, uuid } from "@/lib/validation";
import { defineTool } from "../define-tool";

type Binding = Schema<"PolicyBinding">;

export function compactBinding(binding: Binding) {
  return {
    pk: binding.pk,
    order: binding.order,
    enabled: binding.enabled ?? true,
    negate: binding.negate ?? false,
    policy: binding.policy_obj
      ? { pk: binding.policy_obj.pk, name: binding.policy_obj.name }
      : undefined,
    group: binding.group_obj
      ? { pk: binding.group_obj.pk, name: binding.group_obj.name }
      : undefined,
    user: binding.user_obj
      ? { pk: binding.user_obj.pk, username: binding.user_obj.username }
      : undefined,
    expires: binding.expiring ? binding.expires : null,
  };
}

async function nextOrder(client: Parameters<typeof listPaginated>[0], target: string) {
  const page = await listPaginated<Binding>(client, "/policies/bindings/", { target }, 500);
  return page.results.reduce((max, binding) => Math.max(max, binding.order + 1), 0);
}

export const applicationsBind = defineTool({
  name: "authentik_applications_bind",
  domain: "applications",
  kind: "write",
  title: "Restrict application access (bind group/user/policy)",
  description:
    "Bind a group, a user or a policy to an application. With policy engine mode 'any', a user " +
    "gets access if any binding passes; an app with no bindings is open to everyone. Use this to " +
    "restrict an app to specific groups. Binding expiry is managed by authentik and cannot be set " +
    "through the API.",
  input: z
    .object({
      slug,
      group: groupRef.optional(),
      user: userRef.optional(),
      policy: uuid.optional().describe("Policy uuid (see authentik_policies_list)"),
      negate: z.boolean().default(false),
      order: z.number().int().min(0).optional(),
    })
    .refine((args) => [args.group, args.user, args.policy].filter(Boolean).length === 1, {
      message: "Provide exactly one of group, user or policy",
    }),
  handler: async (args, { client }) => {
    const app = await resolveApplication(client, args.slug);
    const body: Schema<"PolicyBindingRequest"> = {
      target: app.pbm_uuid,
      order: args.order ?? (await nextOrder(client, app.pbm_uuid)),
      negate: args.negate,
      enabled: true,
    };
    if (args.group) body.group = (await resolveGroup(client, args.group)).pk;
    if (args.user) body.user = (await resolveUser(client, args.user)).pk;
    if (args.policy) body.policy = args.policy;
    const binding = await client.post<Binding>("/policies/bindings/", body);
    return { bound: true, application: app.slug, binding: compactBinding(binding) };
  },
});

export const applicationsListBindings = defineTool({
  name: "authentik_applications_list_bindings",
  domain: "applications",
  kind: "read",
  title: "List application access bindings",
  description: "List the group/user/policy bindings that control who can access an application.",
  input: z.object({ slug }),
  handler: async (args, { client }) => {
    const app = await resolveApplication(client, args.slug);
    const page = await listPaginated<Binding>(
      client,
      "/policies/bindings/",
      { target: app.pbm_uuid },
      500,
    );
    if (page.results.length === 0) {
      return {
        application: app.slug,
        bindings: [],
        note: "No bindings: every user can access this app.",
      };
    }
    return {
      application: app.slug,
      policyEngineMode: app.policy_engine_mode,
      bindings: page.results.map(compactBinding),
    };
  },
});

export const assertBindingOnTarget = (binding: Binding, target: string) => {
  if (binding.target !== target) {
    throw new AuthentikError({
      status: 400,
      code: "wrong_target",
      message: "This binding does not belong to the given application.",
    });
  }
};

export const applicationsUnbind = defineTool({
  name: "authentik_applications_unbind",
  domain: "applications",
  kind: "destructive",
  idempotent: true,
  title: "Remove application access binding",
  description:
    "Remove a binding from an application (see list_bindings for pks). Removing the last " +
    "binding opens the app to every user. Without confirm: true returns a dry-run.",
  input: z.object({ slug, binding: uuid, confirm: confirmField }),
  handler: async (args, { client }) => {
    const app = await resolveApplication(client, args.slug);
    const binding = await client.get<Binding>(`/policies/bindings/${args.binding}/`);
    assertBindingOnTarget(binding, app.pbm_uuid);
    const remaining = await listPaginated<Binding>(
      client,
      "/policies/bindings/",
      { target: app.pbm_uuid },
      1,
    );
    const warnings =
      remaining.total <= 1 ? ["This is the last binding: the app becomes open to all users."] : [];
    if (!args.confirm) {
      return dryRun([`Remove binding from ${app.slug}`], compactBinding(binding), warnings);
    }
    await client.delete(`/policies/bindings/${binding.pk}/`);
    return { removed: true, application: app.slug, warnings };
  },
});
