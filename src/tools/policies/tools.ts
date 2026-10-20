import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import { listPaginated } from "@/lib/authentik/pagination";
import { resolveApplication, resolveGroup, resolveUser } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { groupRef, slug, userRef } from "@/lib/validation";
import { compactBinding } from "../applications/bindings";
import { defineTool } from "../define-tool";

type Policy = Schema<"Policy">;
type Binding = Schema<"PolicyBinding">;

const policyPk = z.guid().describe("Policy uuid");

/** "authentik_policies_expression.expressionpolicy" -> "expression" */
function policyPath(policy: Policy): string {
  const app = `${policy.meta_model_name}`.split(".")[0] ?? "";
  return app.replace(/^authentik_policies_/, "");
}

const compactPolicy = (policy: Policy) => ({
  pk: policy.pk,
  name: policy.name,
  type: policy.verbose_name,
  boundTo: policy.bound_to,
});

const target = z
  .object({
    application: slug.optional(),
    flow: slug.optional(),
    policyBindingTarget: z.guid().optional().describe("Raw policy binding model uuid"),
  })
  .refine((t) => [t.application, t.flow, t.policyBindingTarget].filter(Boolean).length === 1, {
    message: "Provide exactly one of application, flow or policyBindingTarget",
  });

async function resolveTarget(client: AuthentikClient, t: z.infer<typeof target>): Promise<string> {
  if (t.application) return (await resolveApplication(client, t.application)).pbm_uuid;
  if (t.flow) {
    return (await client.get<Schema<"Flow">>(`/flows/instances/${encodeURIComponent(t.flow)}/`))
      .policybindingmodel_ptr_id;
  }
  return t.policyBindingTarget as string;
}

export const policiesList = defineTool({
  name: "authentik_policies_list",
  domain: "policies",
  kind: "read",
  title: "List policies",
  description: "List policies of all types with how many objects they are bound to.",
  input: z.object({ search: z.string().max(200).optional(), unbound: z.boolean().optional() }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Policy>(
      client,
      "/policies/all/",
      { search: args.search, bindings__isnull: args.unbound, ordering: "name" },
      env.MCP_MAX_PAGE_ITEMS,
    );
    return { total: page.total, policies: page.results.map(compactPolicy) };
  },
});

export const policiesGet = defineTool({
  name: "authentik_policies_get",
  domain: "policies",
  kind: "read",
  title: "Get policy",
  description: "Get a policy's full type-specific configuration (e.g. expression source).",
  input: z.object({ pk: policyPk }),
  handler: async ({ pk }, { client }) => {
    const base = await client.get<Policy>(`/policies/all/${pk}/`);
    const detail = await client.get<Record<string, unknown>>(
      `/policies/${policyPath(base)}/${pk}/`,
    );
    return { type: base.verbose_name, policy: detail };
  },
});

export const policiesBindingsList = defineTool({
  name: "authentik_policies_bindings_list",
  domain: "policies",
  kind: "read",
  title: "List policy bindings",
  description:
    "List bindings on an application, a flow, or of a given policy (pass policy to see where " +
    "it is used).",
  input: z.object({
    application: slug.optional(),
    flow: slug.optional(),
    policy: policyPk.optional(),
  }),
  handler: async (args, { client, env }) => {
    const targetPk =
      args.application || args.flow
        ? await resolveTarget(client, { application: args.application, flow: args.flow })
        : undefined;
    const page = await listPaginated<Binding>(
      client,
      "/policies/bindings/",
      { target: targetPk, policy: args.policy, ordering: "order" },
      env.MCP_MAX_PAGE_ITEMS,
    );
    return {
      total: page.total,
      bindings: page.results.map((b) => ({ ...compactBinding(b), target: b.target })),
    };
  },
});

export const policiesCreateExpression = defineTool({
  name: "authentik_policies_create_expression_policy",
  domain: "policies",
  kind: "write",
  title: "Create expression policy",
  description:
    "Create a Python expression policy (runs inside authentik with access to request/user). " +
    "Expressions are powerful: review them carefully. Returns a dry-run with the expression " +
    "unless confirm: true. Bind it afterwards with policies_bind.",
  input: z.object({
    name: z.string().min(1).max(200),
    expression: z.string().min(1).max(20_000),
    executionLogging: z.boolean().default(false),
    confirm: confirmField,
  }),
  handler: async (args, { client }) => {
    if (!args.confirm) {
      return dryRun([`Create expression policy ${args.name}`], { expression: args.expression });
    }
    const policy = await client.post<Policy>("/policies/expression/", {
      name: args.name,
      expression: args.expression,
      execution_logging: args.executionLogging,
    } satisfies Schema<"ExpressionPolicyRequest">);
    return { created: true, policy: compactPolicy(policy) };
  },
});

export const policiesBind = defineTool({
  name: "authentik_policies_bind",
  domain: "policies",
  kind: "write",
  title: "Bind policy/group/user to object",
  description:
    "Create a policy binding on an application or flow. Binding to a flow can block logins; " +
    "requires confirm: true for flows.",
  input: z.object({
    target,
    policy: policyPk.optional(),
    group: groupRef.optional(),
    user: userRef.optional(),
    order: z.number().int().min(0).default(0),
    negate: z.boolean().default(false),
    timeout: z.number().int().min(1).max(300).optional(),
    failureResult: z.boolean().optional(),
    confirm: confirmField,
  }),
  handler: async (args, { client }) => {
    const subjects = [args.policy, args.group, args.user].filter((value) => value !== undefined);
    if (subjects.length !== 1) {
      throw new AuthentikError({
        status: 400,
        code: "validation_error",
        message: "Provide exactly one of policy, group or user",
      });
    }
    const targetPk = await resolveTarget(client, args.target);
    if (args.target.flow && !args.confirm) {
      return dryRun([`Bind to flow ${args.target.flow} at order ${args.order}`], undefined, [
        "Flow bindings can prevent users from logging in.",
      ]);
    }
    const body: Schema<"PolicyBindingRequest"> = {
      target: targetPk,
      order: args.order,
      negate: args.negate,
      enabled: true,
      timeout: args.timeout,
      failure_result: args.failureResult,
    };
    if (args.policy) body.policy = args.policy;
    if (args.group) body.group = (await resolveGroup(client, args.group)).pk;
    if (args.user) body.user = (await resolveUser(client, args.user)).pk;
    return {
      created: true,
      binding: compactBinding(await client.post<Binding>("/policies/bindings/", body)),
    };
  },
});

export const policiesUnbind = defineTool({
  name: "authentik_policies_unbind",
  domain: "policies",
  kind: "destructive",
  idempotent: true,
  title: "Delete policy binding",
  description: "Delete a policy binding by pk. Without confirm: true returns a dry-run.",
  input: z.object({ binding: z.guid(), confirm: confirmField }),
  handler: async (args, { client }) => {
    const binding = await client.get<Binding>(`/policies/bindings/${args.binding}/`);
    if (!args.confirm) return dryRun([`Delete binding ${binding.pk}`], compactBinding(binding));
    await client.delete(`/policies/bindings/${binding.pk}/`);
    return { deleted: true };
  },
});

export const policiesTest = defineTool({
  name: "authentik_policies_test",
  domain: "policies",
  kind: "read",
  title: "Test policy",
  description: "Evaluate a policy for a user and return pass/fail with messages.",
  input: z.object({ pk: policyPk, user: userRef }),
  handler: async (args, { client }) => {
    const user = await resolveUser(client, args.user);
    const result = await client.post<Schema<"PolicyTestResult">>(`/policies/all/${args.pk}/test/`, {
      user: user.pk,
    });
    return { username: user.username, passing: result.passing, messages: result.messages };
  },
});

export const policyTools = [
  policiesList,
  policiesGet,
  policiesBindingsList,
  policiesCreateExpression,
  policiesBind,
  policiesUnbind,
  policiesTest,
];
