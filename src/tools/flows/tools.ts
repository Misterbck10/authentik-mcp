import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import { listPaginated } from "@/lib/authentik/pagination";
import { isUuid, resolveFlowPk } from "@/lib/authentik/resolve";
import type { Paginated, Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { email, slug } from "@/lib/validation";
import { defineTool } from "../define-tool";

type Flow = Schema<"Flow">;
type Binding = Schema<"FlowStageBinding">;

const compactFlow = (flow: Flow) => ({
  pk: flow.pk,
  slug: flow.slug,
  name: flow.name,
  title: flow.title,
  designation: flow.designation,
  authentication: flow.authentication,
  layout: flow.layout,
  compatibilityMode: flow.compatibility_mode ?? false,
  deniedAction: flow.denied_action,
  background: flow.background || undefined,
});

const compactBinding = (binding: Binding) => ({
  pk: binding.pk,
  order: binding.order,
  stage: { pk: binding.stage, name: binding.stage_obj.name, type: binding.stage_obj.verbose_name },
  evaluateOnPlan: binding.evaluate_on_plan,
  reEvaluatePolicies: binding.re_evaluate_policies,
  invalidResponseAction: binding.invalid_response_action,
});

async function getFlow(client: AuthentikClient, flowSlug: string): Promise<Flow> {
  return client.get<Flow>(`/flows/instances/${encodeURIComponent(flowSlug)}/`);
}

async function flowBindings(client: AuthentikClient, flowPk: string): Promise<Binding[]> {
  const page = await listPaginated<Binding>(
    client,
    "/flows/bindings/",
    { target: flowPk, ordering: "order" },
    200,
  );
  return page.results;
}

export const flowsList = defineTool({
  name: "authentik_flows_list",
  domain: "flows",
  kind: "read",
  title: "List flows",
  description:
    "List flows (login, enrollment, recovery, authorization...) with designation and layout.",
  input: z.object({
    designation: z
      .enum([
        "authentication",
        "authorization",
        "invalidation",
        "enrollment",
        "unenrollment",
        "recovery",
        "stage_configuration",
      ])
      .optional(),
    search: z.string().max(200).optional(),
  }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Flow>(
      client,
      "/flows/instances/",
      { designation: args.designation, search: args.search, ordering: "slug" },
      env.MCP_MAX_PAGE_ITEMS,
    );
    return { total: page.total, flows: page.results.map(compactFlow) };
  },
});

export const flowsGet = defineTool({
  name: "authentik_flows_get",
  domain: "flows",
  kind: "read",
  title: "Get flow",
  description: "Get a flow by slug including its ordered stage bindings.",
  input: z.object({ slug }),
  handler: async (args, { client }) => {
    const flow = await getFlow(client, args.slug);
    return {
      ...compactFlow(flow),
      stages: (await flowBindings(client, flow.pk)).map(compactBinding),
    };
  },
});

export const flowsBindingsList = defineTool({
  name: "authentik_flows_bindings_list",
  domain: "flows",
  kind: "read",
  title: "List flow stage bindings",
  description: "List the stages bound to a flow, in execution order.",
  input: z.object({ slug }),
  handler: async (args, { client }) => {
    const flow = await getFlow(client, args.slug);
    return { flow: flow.slug, bindings: (await flowBindings(client, flow.pk)).map(compactBinding) };
  },
});

export const stagesList = defineTool({
  name: "authentik_stages_list",
  domain: "flows",
  kind: "read",
  title: "List stages",
  description: "List stages of all types and the flows that use them.",
  input: z.object({ search: z.string().max(200).optional() }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Schema<"Stage">>(
      client,
      "/stages/all/",
      { search: args.search, ordering: "name" },
      env.MCP_MAX_PAGE_ITEMS,
    );
    return {
      total: page.total,
      stages: page.results.map((stage) => ({
        pk: stage.pk,
        name: stage.name,
        type: stage.verbose_name,
        flows: stage.flow_set.map((flow) => flow.slug),
      })),
    };
  },
});

// ---- invitations ----

const compactInvitation = (invitation: Schema<"Invitation">, baseUrl: string) => ({
  pk: invitation.pk,
  name: invitation.name,
  expires: invitation.expires ?? null,
  singleUse: invitation.single_use ?? false,
  flow: invitation.flow_obj?.slug ?? null,
  createdBy: invitation.created_by?.username,
  link: invitation.flow_obj
    ? `${baseUrl}/if/flow/${invitation.flow_obj.slug}/?itoken=${invitation.pk}`
    : null,
});

export const invitationsCreate = defineTool({
  name: "authentik_invitations_create",
  domain: "flows",
  kind: "write",
  title: "Create invitation",
  description:
    "Create an enrollment invitation link (alternative to onboard_employee when the person " +
    "should register themselves). fixedData pre-fills/locks prompt fields (e.g. email). The " +
    "enrollment flow must contain an Invitation stage. To place invitees in a group, configure " +
    "the flow's User Write stage; group membership cannot be set on the invitation itself.",
  input: z.object({
    name: slug.describe("Invitation name (slug format)"),
    flow: slug.describe("Enrollment flow slug"),
    expiresInDays: z.number().int().min(1).max(365).default(7),
    singleUse: z.boolean().default(true),
    fixedData: z.record(z.string(), z.unknown()).optional(),
    sendTo: z.array(email).max(20).optional().describe("Email the link to these addresses"),
  }),
  handler: async (args, { client, env }) => {
    const body: Schema<"InvitationRequest"> = {
      name: args.name,
      flow: await resolveFlowPk(client, args.flow),
      expires: new Date(Date.now() + args.expiresInDays * 86_400_000).toISOString(),
      single_use: args.singleUse,
      fixed_data: args.fixedData ?? {},
    };
    const invitation = await client.post<Schema<"Invitation">>(
      "/stages/invitation/invitations/",
      body,
    );
    if (args.sendTo?.length) {
      await client.post(`/stages/invitation/invitations/${invitation.pk}/send_email/`, {
        email_addresses: args.sendTo,
      });
    }
    return {
      created: true,
      emailedTo: args.sendTo ?? [],
      invitation: compactInvitation(invitation, env.AUTHENTIK_URL),
    };
  },
});

export const invitationsList = defineTool({
  name: "authentik_invitations_list",
  domain: "flows",
  kind: "read",
  title: "List invitations",
  description: "List enrollment invitations with expiry and link.",
  input: z.object({ flow: slug.optional() }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Schema<"Invitation">>(
      client,
      "/stages/invitation/invitations/",
      { flow__slug: args.flow, ordering: "-expires" },
      env.MCP_MAX_PAGE_ITEMS,
    );
    return {
      total: page.total,
      invitations: page.results.map((i) => compactInvitation(i, env.AUTHENTIK_URL)),
    };
  },
});

export const invitationsDelete = defineTool({
  name: "authentik_invitations_delete",
  domain: "flows",
  kind: "destructive",
  idempotent: true,
  title: "Delete invitation",
  description: "Revoke an invitation link. Without confirm: true returns a dry-run.",
  input: z.object({ pk: z.guid(), confirm: confirmField }),
  handler: async ({ pk, confirm }, { client }) => {
    const invitation = await client.get<Schema<"Invitation">>(
      `/stages/invitation/invitations/${pk}/`,
    );
    if (!confirm) return dryRun([`Delete invitation ${invitation.name}`]);
    await client.delete(`/stages/invitation/invitations/${pk}/`);
    return { deleted: true, name: invitation.name };
  },
});

// ---- flows_admin (opt-in domain) ----

async function resolveStagePk(client: AuthentikClient, ref: string): Promise<string> {
  if (isUuid(ref)) return ref;
  const page = await client.get<Paginated<Schema<"Stage">>>("/stages/all/", {
    name: ref,
    page_size: 2,
  });
  const stage = page.results[0];
  if (!stage)
    throw new AuthentikError({
      status: 404,
      code: "not_found",
      message: `Stage not found: ${ref}`,
    });
  return stage.pk;
}

export const flowsBindingsCreate = defineTool({
  name: "authentik_flows_bindings_create",
  domain: "flows_admin",
  kind: "destructive",
  title: "Bind stage to flow",
  description:
    "Insert a stage into a flow at a given order. Changing login/enrollment flows can lock " +
    "users out; test in a private window. Without confirm: true returns a dry-run.",
  input: z.object({
    flow: slug,
    stage: z.string().min(1).max(200).describe("Stage name or uuid"),
    order: z.number().int().min(0).max(10_000),
    evaluateOnPlan: z.boolean().default(false),
    reEvaluatePolicies: z.boolean().default(true),
    confirm: confirmField,
  }),
  handler: async (args, { client }) => {
    const flow = await getFlow(client, args.flow);
    const stage = await resolveStagePk(client, args.stage);
    const existing = await flowBindings(client, flow.pk);
    if (!args.confirm) {
      return dryRun([`Bind stage ${args.stage} to flow ${flow.slug} at order ${args.order}`], {
        currentStages: existing.map(compactBinding),
      });
    }
    const body: Schema<"FlowStageBindingRequest"> = {
      target: flow.pk,
      stage,
      order: args.order,
      evaluate_on_plan: args.evaluateOnPlan,
      re_evaluate_policies: args.reEvaluatePolicies,
    };
    return {
      created: true,
      binding: compactBinding(await client.post<Binding>("/flows/bindings/", body)),
    };
  },
});

export const flowsBindingsUpdate = defineTool({
  name: "authentik_flows_bindings_update",
  domain: "flows_admin",
  kind: "destructive",
  idempotent: true,
  title: "Update flow stage binding",
  description: "Change the order or evaluation options of a flow stage binding. Requires confirm.",
  input: z.object({
    pk: z.guid(),
    order: z.number().int().min(0).max(10_000).optional(),
    evaluateOnPlan: z.boolean().optional(),
    reEvaluatePolicies: z.boolean().optional(),
    confirm: confirmField,
  }),
  handler: async (args, { client }) => {
    const binding = await client.get<Binding>(`/flows/bindings/${args.pk}/`);
    const changes = {
      order: args.order,
      evaluate_on_plan: args.evaluateOnPlan,
      re_evaluate_policies: args.reEvaluatePolicies,
    };
    if (!args.confirm)
      return dryRun([`Update binding of stage ${binding.stage_obj.name}`], changes);
    return {
      updated: true,
      binding: compactBinding(await client.patch<Binding>(`/flows/bindings/${args.pk}/`, changes)),
    };
  },
});

export const flowsBindingsDelete = defineTool({
  name: "authentik_flows_bindings_delete",
  domain: "flows_admin",
  kind: "destructive",
  idempotent: true,
  title: "Remove stage from flow",
  description: "Remove a stage binding from a flow. Requires confirm.",
  input: z.object({ pk: z.guid(), confirm: confirmField }),
  handler: async ({ pk, confirm }, { client }) => {
    const binding = await client.get<Binding>(`/flows/bindings/${pk}/`);
    if (!confirm) return dryRun([`Remove stage ${binding.stage_obj.name} from its flow`]);
    await client.delete(`/flows/bindings/${pk}/`);
    return { deleted: true, stage: binding.stage_obj.name };
  },
});

export const stagesInvitationCreate = defineTool({
  name: "authentik_stages_invitation_create",
  domain: "flows_admin",
  kind: "write",
  title: "Create invitation stage",
  description:
    "Create an Invitation stage (bind it into an enrollment flow with flows_bindings_create).",
  input: z.object({
    name: z.string().min(1).max(200),
    continueWithoutInvitation: z.boolean().default(false),
  }),
  handler: async (args, { client }) => {
    const stage = await client.post<{ pk: string; name: string }>("/stages/invitation/stages/", {
      name: args.name,
      continue_flow_without_invitation: args.continueWithoutInvitation,
    } satisfies Schema<"InvitationStageRequest">);
    return { created: true, stage: { pk: stage.pk, name: stage.name } };
  },
});

export const flowTools = [
  flowsList,
  flowsGet,
  flowsBindingsList,
  stagesList,
  invitationsCreate,
  invitationsList,
  invitationsDelete,
  flowsBindingsCreate,
  flowsBindingsUpdate,
  flowsBindingsDelete,
  stagesInvitationCreate,
];
