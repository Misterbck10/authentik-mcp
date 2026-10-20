import { z } from "zod";
import { AuthentikError } from "@/lib/authentik/errors";
import type { Paginated, Schema } from "@/lib/authentik/types";
import { resolveBrand } from "@/lib/branding/brands";
import { snapshotToBlueprint } from "@/lib/branding/blueprint";
import {
  applyRestore,
  captureSnapshot,
  loadSnapshot,
  planRestore,
  storeSnapshot,
  type BrandingSnapshot,
} from "@/lib/branding/snapshot";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { defineTool } from "../define-tool";
import { autoSnapshot, brandRef } from "./shared";

export const brandingSnapshot = defineTool({
  name: "authentik_branding_snapshot",
  domain: "branding",
  kind: "write",
  title: "Snapshot branding",
  description:
    "Save the full visual state (brand fields, CSS, attributes, flow titles/backgrounds/layouts, " +
    "app and source icons) as JSON in authentik storage (mcp-backups/...). Returns its id for " +
    "branding_restore. Contains no secrets.",
  input: z.object({ brand: brandRef }),
  handler: async (args, { client }) => {
    const brand = await resolveBrand(client, args.brand);
    return storeSnapshot(client, await captureSnapshot(client, brand));
  },
});

export const brandingRestore = defineTool({
  name: "authentik_branding_restore",
  domain: "branding",
  kind: "destructive",
  title: "Restore branding snapshot",
  description:
    "Restore a snapshot (by id from branding_snapshot, or inline JSON). Dry-run shows exactly " +
    "which fields, flows and icons would change. A fresh snapshot of the current state is taken " +
    "before applying, so a restore can itself be undone.",
  input: z
    .object({
      id: z.string().max(300).optional(),
      snapshot: z.record(z.string(), z.unknown()).optional().describe("Inline snapshot JSON"),
      confirm: confirmField,
    })
    .refine((args) => !!args.id !== !!args.snapshot, { message: "Provide either id or snapshot" }),
  handler: async (args, { client, env }) => {
    const target = args.snapshot
      ? (args.snapshot as unknown as BrandingSnapshot)
      : await loadSnapshot(client, env.AUTHENTIK_URL, args.id!).catch((error: unknown) => {
          throw new AuthentikError({
            status: 404,
            code: "snapshot_not_found",
            message: error instanceof Error ? error.message : "Snapshot not found",
          });
        });
    if (target.version !== 1 || !target.brand?.uuid) {
      throw new AuthentikError({
        status: 400,
        code: "invalid_snapshot",
        message: "Not a branding snapshot",
      });
    }
    const brand = await resolveBrand(client, target.brand.uuid);
    const plan = planRestore(await captureSnapshot(client, brand), target);
    const changes =
      Object.keys(plan.brand).length +
      plan.flows.length +
      plan.applications.length +
      plan.sources.length;
    if (changes === 0)
      return { changed: false, reason: "Current state already matches the snapshot." };
    if (!args.confirm) {
      return dryRun(
        [`Restore ${changes} change(s) on ${brand.domain} from ${target.createdAt}`],
        plan,
      );
    }
    const before = await autoSnapshot(client, brand);
    await applyRestore(client, brand.brand_uuid, plan);
    return { restored: true, changes, undoSnapshot: before };
  },
});

export const brandingExportBlueprint = defineTool({
  name: "authentik_branding_export_blueprint",
  domain: "branding",
  kind: "read",
  title: "Export branding as blueprint",
  description:
    "Export the current visual configuration (brand, flow appearance, app icons) as an authentik " +
    "blueprint YAML to version the brand identity in Git.",
  input: z.object({ brand: brandRef }),
  handler: async (args, { client }) => {
    const brand = await resolveBrand(client, args.brand);
    return {
      filename: `branding-${brand.domain}.yaml`,
      yaml: snapshotToBlueprint(await captureSnapshot(client, brand)),
    };
  },
});

export const brandingPreviewUrls = defineTool({
  name: "authentik_branding_preview_urls",
  domain: "branding",
  kind: "read",
  title: "Preview URLs",
  description: "URLs to check the branding: login, app library, recovery and user settings.",
  input: z.object({ brand: brandRef }),
  handler: async (args, { client, env }) => {
    const brand = await resolveBrand(client, args.brand);
    const origin =
      brand.default || brand.domain.startsWith("*") ? env.AUTHENTIK_URL : `https://${brand.domain}`;
    const flowSlug = async (pk: string | null | undefined, fallback: string) => {
      if (!pk) return fallback;
      const page = await client.get<Paginated<Schema<"Flow">>>("/flows/instances/", {
        flow_uuid: pk,
      });
      return page.results[0]?.slug ?? fallback;
    };
    const login = await flowSlug(brand.flow_authentication, "default-authentication-flow");
    const recovery = brand.flow_recovery ? await flowSlug(brand.flow_recovery, "") : "";
    return {
      login: `${origin}/if/flow/${login}/`,
      library: `${origin}/if/user/#/library`,
      userSettings: `${origin}/if/user/#/settings`,
      ...(recovery ? { recovery: `${origin}/if/flow/${recovery}/` } : {}),
      tip: "Use a private window or hard refresh: logos, favicons and CSS are cached by the browser.",
    };
  },
});
