import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import { isUuid } from "@/lib/authentik/resolve";
import type { Paginated, Schema } from "@/lib/authentik/types";
import { diffFields, resolveBrand } from "@/lib/branding/brands";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { slug } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { autoSnapshot, imageSource, materializeImage } from "./shared";

export const flowsCustomize = defineTool({
  name: "authentik_branding_flows_customize",
  domain: "branding",
  kind: "destructive",
  idempotent: true,
  title: "Customise flow appearance",
  description:
    "Change a flow's title, background image, layout or compatibility mode. Compatibility mode " +
    "emulates Shadow DOM with a polyfill, which changes how custom CSS applies — test after " +
    "toggling it. Snapshot (of the default brand state) first.",
  input: z.object({
    flow: slug,
    title: z.string().max(200).optional(),
    background: imageSource.optional(),
    layout: z
      .enum([
        "stacked",
        "content_left",
        "content_right",
        "sidebar_left",
        "sidebar_right",
        "sidebar_left_frame_background",
        "sidebar_right_frame_background",
      ])
      .optional(),
    compatibilityMode: z.boolean().optional(),
    deniedAction: z.enum(["message_continue", "message", "continue"]).optional(),
    confirm: confirmField,
  }),
  handler: async (args, { client, env }) => {
    const flow = await client.get<Schema<"Flow">>(
      `/flows/instances/${encodeURIComponent(args.flow)}/`,
    );
    const planned = {
      title: args.title,
      layout: args.layout,
      compatibility_mode: args.compatibilityMode,
      denied_action: args.deniedAction,
      background: args.background ? "(new image)" : undefined,
    };
    const diff = diffFields(flow as Record<string, unknown>, planned);
    const warnings =
      args.compatibilityMode !== undefined && args.compatibilityMode !== flow.compatibility_mode
        ? ["Compatibility mode changes how custom CSS reaches components (polyfilled Shadow DOM)."]
        : [];
    if (Object.keys(diff).length === 0) return { changed: false };
    if (!args.confirm) return dryRun([`Customise flow ${flow.slug}`], diff, warnings);

    const snapshot = await autoSnapshot(client, await resolveBrand(client, "default"));
    const background = args.background
      ? (
          await materializeImage(
            client,
            env,
            args.background,
            `branding/flows/${flow.slug}-background`,
          )
        ).value
      : undefined;
    const patch = Object.fromEntries(
      Object.entries({ ...planned, background }).filter(([, v]) => v !== undefined),
    );
    await client.patch(`/flows/instances/${encodeURIComponent(flow.slug)}/`, patch);
    return { changed: true, flow: flow.slug, snapshot, warnings };
  },
});

async function resolvePrompt(client: AuthentikClient, ref: string): Promise<Schema<"Prompt">> {
  if (isUuid(ref)) return client.get<Schema<"Prompt">>(`/stages/prompt/prompts/${ref}/`);
  for (const query of [{ name: ref }, { field_key: ref }]) {
    const page = await client.get<Paginated<Schema<"Prompt">>>("/stages/prompt/prompts/", {
      ...query,
      page_size: 2,
    });
    if (page.results.length > 1) {
      throw new AuthentikError({
        status: 409,
        code: "ambiguous",
        message: `Several prompts match "${ref}"; use the prompt name or uuid.`,
      });
    }
    if (page.results[0]) return page.results[0];
  }
  throw new AuthentikError({ status: 404, code: "not_found", message: `Prompt not found: ${ref}` });
}

export const promptFieldsList = defineTool({
  name: "authentik_branding_prompt_fields_list",
  domain: "branding",
  kind: "read",
  title: "List form fields",
  description:
    "List prompt (form) fields with label, placeholder, order and the stages using them.",
  input: z.object({ search: z.string().max(200).optional() }),
  handler: async (args, { client }) => {
    const page = await client.get<Paginated<Schema<"Prompt">>>("/stages/prompt/prompts/", {
      search: args.search,
      ordering: "order",
      page_size: 200,
    });
    return page.results.map((p) => ({
      pk: p.pk,
      name: p.name,
      fieldKey: p.field_key,
      type: p.type,
      label: p.label,
      placeholder: p.placeholder,
      subText: p.sub_text,
      order: p.order,
      required: p.required,
      stages: p.prompt_stages_obj.map((s) => s.name),
    }));
  },
});

export const promptFieldsUpdate = defineTool({
  name: "authentik_branding_prompt_fields_update",
  domain: "branding",
  kind: "destructive",
  idempotent: true,
  title: "Update form field texts",
  description:
    "Change labels, placeholders, help text and order of form fields (e.g. translate the " +
    "registration form). Prompts are shared between stages: changes apply everywhere they are " +
    "used. Dry-run unless confirm: true.",
  input: z.object({
    fields: z
      .array(
        z.object({
          prompt: z.string().min(1).max(200).describe("Prompt name, field_key or uuid"),
          label: z.string().max(200).optional(),
          placeholder: z.string().max(500).optional(),
          subText: z.string().max(1000).optional(),
          order: z.number().int().min(0).max(10_000).optional(),
        }),
      )
      .min(1)
      .max(50),
    confirm: confirmField,
  }),
  handler: async (args, { client }) => {
    const plans = await Promise.all(
      args.fields.map(async (field) => {
        const prompt = await resolvePrompt(client, field.prompt);
        const patch = {
          label: field.label,
          placeholder: field.placeholder,
          sub_text: field.subText,
          order: field.order,
        };
        return { prompt, patch, diff: diffFields(prompt as Record<string, unknown>, patch) };
      }),
    );
    const changes = plans.filter((plan) => Object.keys(plan.diff).length > 0);
    const summary = changes.map((plan) => ({
      prompt: plan.prompt.name,
      usedIn: plan.prompt.prompt_stages_obj.map((s) => s.name),
      changes: plan.diff,
    }));
    if (!args.confirm) return dryRun([`Update ${changes.length} form field(s)`], summary);
    for (const plan of changes) {
      const body = Object.fromEntries(
        Object.entries(plan.patch).filter(([, v]) => v !== undefined),
      );
      await client.patch(`/stages/prompt/prompts/${plan.prompt.pk}/`, body);
    }
    return { updated: summary.length, fields: summary };
  },
});

export const emailTemplatesInfo = defineTool({
  name: "authentik_branding_email_templates",
  domain: "branding",
  kind: "read",
  title: "Email templates (info)",
  description:
    "List email templates available to email stages. Custom HTML templates cannot be uploaded " +
    "through the API: they must be mounted as files in authentik's /templates directory.",
  input: z.object({}),
  handler: async (_args, { client }) => ({
    templates: await client.get<Schema<"TypeCreate">[]>("/stages/email/templates/"),
    limitation:
      "The API can only select one of these templates on an email stage. To brand emails, " +
      "mount custom templates into /templates on the authentik server/worker containers " +
      "(e.g. a Docker volume) and then pick them here.",
  }),
});
