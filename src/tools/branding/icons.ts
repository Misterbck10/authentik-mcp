import { z } from "zod";
import { resolveApplication } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { slug } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { imageSource, materializeImage } from "./shared";

export const applicationsSetIcon = defineTool({
  name: "authentik_branding_applications_set_icon",
  domain: "branding",
  kind: "write",
  idempotent: true,
  title: "Set application icon",
  description: "Set the icon shown in the user's app library (stored file, URL or upload).",
  input: z.object({ slug, icon: imageSource }),
  handler: async (args, { client, env }) => {
    const app = await resolveApplication(client, args.slug);
    const icon = await materializeImage(client, env, args.icon, `branding/apps/${app.slug}`);
    await client.patch(`/core/applications/${encodeURIComponent(app.slug)}/`, {
      meta_icon: icon.value,
    });
    return {
      changed: true,
      application: app.slug,
      previous: app.meta_icon || null,
      icon: icon.value,
    };
  },
});

export const sourcesSetIcon = defineTool({
  name: "authentik_branding_sources_set_icon",
  domain: "branding",
  kind: "write",
  idempotent: true,
  title: "Set source icon",
  description: "Set the icon of a login source button (e.g. 'Sign in with Google').",
  input: z.object({ slug, icon: imageSource }),
  handler: async (args, { client, env }) => {
    const source = await client.get<Schema<"Source">>(
      `/sources/all/${encodeURIComponent(args.slug)}/`,
    );
    const type = `${source.meta_model_name}`.split(".")[0]?.replace(/^authentik_sources_/, "");
    const icon = await materializeImage(client, env, args.icon, `branding/sources/${source.slug}`);
    await client.patch(`/sources/${type}/${encodeURIComponent(source.slug)}/`, {
      icon: icon.value,
    });
    return { changed: true, source: source.slug, previous: source.icon || null, icon: icon.value };
  },
});
