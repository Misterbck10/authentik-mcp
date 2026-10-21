import { z } from "zod";
import type { Schema } from "@/lib/authentik/types";
import { listFiles } from "@/lib/branding/files";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { defineTool } from "../define-tool";
import { filePath, imageSource, materializeImage } from "./shared";

export const filesList = defineTool({
  name: "authentik_branding_files_list",
  domain: "branding",
  kind: "read",
  title: "List stored files",
  description: "List files in authentik storage (logos, favicons, backgrounds, icons, backups).",
  input: z.object({ search: z.string().max(200).optional() }),
  handler: async (args, { client }) => {
    const files = await listFiles(client, args.search);
    return {
      count: files.length,
      // Signed access tokens in the query string are stripped; they are credentials.
      files: files.map((f) => ({ name: f.name, mimeType: f.mime_type, url: f.url.split("?")[0] })),
    };
  },
});

export const filesUpload = defineTool({
  name: "authentik_branding_files_upload",
  domain: "branding",
  kind: "write",
  title: "Upload image",
  description:
    "Upload an image (svg, png, jpg, webp, ico) from an https URL or base64 to authentik " +
    "storage. Type is checked by content, size is capped and SVGs are sanitised. Returns the " +
    "path to use in brand/flow/app/source fields.",
  input: z.object({
    name: filePath.describe('Target path without extension, e.g. "branding/acme/logo-light"'),
    source: imageSource,
  }),
  handler: async (args, { client, env }) => {
    if ("path" in args.source || "externalUrl" in args.source) {
      return {
        uploaded: false,
        reason: "Source is already a stored path or external URL; nothing to upload.",
      };
    }
    const result = await materializeImage(
      client,
      env,
      args.source,
      args.name.replace(/\.\w+$/, ""),
    );
    return { uploaded: true, path: result.value, sanitizedSvg: result.sanitized ?? false };
  },
});

export const filesDelete = defineTool({
  name: "authentik_branding_files_delete",
  domain: "branding",
  kind: "destructive",
  idempotent: true,
  title: "Delete stored file",
  description:
    "Delete a stored file. Refuses while any brand, flow, application or source still uses it.",
  input: z.object({ name: filePath, confirm: confirmField }),
  handler: async (args, { client }) => {
    const usedBy = await client.get<Schema<"UsedBy">[]>("/admin/file/used_by/", {
      name: args.name,
    });
    if (usedBy.length > 0) {
      return {
        deleted: false,
        reason: "File is still in use; change these objects first.",
        usedBy: usedBy.map((use) => ({ model: use.model_name, name: use.name })),
      };
    }
    if (!args.confirm) return dryRun([`Delete file ${args.name}`]);
    await client.delete("/admin/file/", { name: args.name, usage: "media" });
    return { deleted: true, name: args.name };
  },
});
