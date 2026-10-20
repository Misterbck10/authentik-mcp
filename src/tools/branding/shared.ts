import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import type { Brand } from "@/lib/branding/brands";
import type { CssPolicy } from "@/lib/branding/css-sanitizer";
import { fetchImage, FILE_PATH, MIME, prepareImage, uploadBytes } from "@/lib/branding/files";
import { captureSnapshot, storeSnapshot, type StoredSnapshot } from "@/lib/branding/snapshot";
import type { Env } from "@/lib/config/env";

export const brandRef = z
  .string()
  .min(1)
  .max(253)
  .describe('Brand uuid, domain (e.g. "auth.example.com") or "default"');

export const filePath = z
  .string()
  .regex(FILE_PATH, "relative path without leading slash, e.g. branding/logo.svg");

/** Where an image comes from: an existing stored file/URL, a URL to download, or base64. */
export const imageSource = z
  .union([
    z.object({ path: filePath.describe("Existing file in authentik storage") }),
    z.object({ externalUrl: z.url().describe("Use this https URL directly (not uploaded)") }),
    z.object({ url: z.url().describe("Download from this https URL and upload to authentik") }),
    z.object({ base64: z.string().min(16).describe("Image bytes, base64-encoded") }),
  ])
  .describe("One of: path | externalUrl | url | base64");

export type ImageSource = z.infer<typeof imageSource>;

export function cssPolicy(env: Env): CssPolicy {
  return {
    maxKb: env.MCP_BRANDING_MAX_CSS_KB,
    allowedHosts: env.MCP_BRANDING_ALLOWED_ASSET_HOSTS,
    authentikHost: new URL(env.AUTHENTIK_URL).hostname,
  };
}

export const brandSlug = (brand: Brand) => brand.domain.replace(/[^\w.-]/g, "_") || "default";

/**
 * Resolves an image source to the value stored in authentik fields.
 * Uploads (after type/size validation and SVG sanitisation) when needed.
 */
export async function materializeImage(
  client: AuthentikClient,
  env: Env,
  source: ImageSource,
  targetBase: string,
): Promise<{ value: string; uploaded?: string; sanitized?: boolean; ext?: string }> {
  if ("path" in source) return { value: source.path, ext: source.path.split(".").pop() };
  if ("externalUrl" in source) {
    if (!source.externalUrl.startsWith("https://")) {
      throw new AuthentikError({
        status: 400,
        code: "insecure_url",
        message: "Image URLs must use https",
      });
    }
    return { value: source.externalUrl };
  }
  const raw =
    "url" in source
      ? await fetchImage(source.url, env.MCP_BRANDING_MAX_IMAGE_MB)
      : new Uint8Array(Buffer.from(source.base64.replace(/^data:[^,]+,/, ""), "base64"));
  const image = prepareImage(raw, env.MCP_BRANDING_MAX_IMAGE_MB);
  const name = `${targetBase}.${image.type}`;
  await uploadBytes(client, name, image.bytes, MIME[image.type]);
  return { value: name, uploaded: name, sanitized: image.sanitized, ext: image.type };
}

/** Light/dark pair → single themed path with %(theme)s (both must share an extension). */
export async function materializeThemedImage(
  client: AuthentikClient,
  env: Env,
  sources: { light?: ImageSource; dark?: ImageSource },
  targetBase: string,
): Promise<{ value?: string; uploaded: string[] }> {
  if (!sources.light && !sources.dark) return { uploaded: [] };
  if (sources.light && !sources.dark) {
    const single = await materializeImage(client, env, sources.light, targetBase);
    return { value: single.value, uploaded: single.uploaded ? [single.uploaded] : [] };
  }
  if (!sources.light && sources.dark) {
    const single = await materializeImage(client, env, sources.dark, targetBase);
    return { value: single.value, uploaded: single.uploaded ? [single.uploaded] : [] };
  }
  const light = await materializeImage(client, env, sources.light!, `${targetBase}-light`);
  const dark = await materializeImage(client, env, sources.dark!, `${targetBase}-dark`);
  const themed = light.value.replace(/-light(\.\w+)$/, "-%(theme)s$1");
  if (
    !light.uploaded ||
    !dark.uploaded ||
    light.ext !== dark.ext ||
    !themed.includes("%(theme)s")
  ) {
    throw new AuthentikError({
      status: 400,
      code: "theme_pair",
      message:
        "Light/dark variants must both be uploaded (url or base64) with the same file type so " +
        "the %(theme)s placeholder can resolve them.",
    });
  }
  return { value: themed, uploaded: [light.uploaded, dark.uploaded] };
}

/** Snapshot taken automatically before any applied branding change. */
export async function autoSnapshot(client: AuthentikClient, brand: Brand): Promise<StoredSnapshot> {
  return storeSnapshot(client, await captureSnapshot(client, brand));
}

export const UPGRADE_NOTE =
  "Direct selectors (not CSS variables or ::part) may break after an authentik upgrade.";
