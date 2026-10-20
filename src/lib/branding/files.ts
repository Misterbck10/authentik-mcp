import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import type { Schema } from "@/lib/authentik/types";
import { detectImageType, MIME, sanitizeSvg, type ImageType } from "./images";

export type StoredFile = Schema<"FileList">;

/** Relative storage path without leading slash, e.g. "branding/logo-light.svg". */
export const FILE_PATH = /^(?!\/)(?!.*\.\.)[\w\-./]{1,200}$/;

export async function listFiles(client: AuthentikClient, search?: string): Promise<StoredFile[]> {
  return client.get<StoredFile[]>("/admin/file/", { search, usage: "media" });
}

export async function uploadBytes(
  client: AuthentikClient,
  name: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<StoredFile | undefined> {
  const form = new FormData();
  // Copy into a plain ArrayBuffer-backed view; Blob rejects SharedArrayBuffer-typed arrays.
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  form.append("file", blob, name.split("/").pop());
  form.append("name", name);
  form.append("usage", "media");
  await client.upload("/admin/file/", form);
  return (await listFiles(client, name)).find((file) => file.name === name);
}

export interface PreparedImage {
  type: ImageType;
  bytes: Uint8Array;
  sanitized: boolean;
}

/** Validates type by magic bytes and size, and sanitises SVGs. */
export function prepareImage(bytes: Uint8Array, maxMb: number): PreparedImage {
  if (bytes.byteLength > maxMb * 1024 * 1024) {
    throw new AuthentikError({
      status: 400,
      code: "file_too_large",
      message: `Image is ${(bytes.byteLength / 1048576).toFixed(1)} MB; limit is ${maxMb} MB`,
    });
  }
  const type = detectImageType(bytes);
  if (!type) {
    throw new AuthentikError({
      status: 400,
      code: "unsupported_type",
      message: "Only svg, png, jpg, webp and ico images are accepted",
    });
  }
  if (type !== "svg") return { type, bytes, sanitized: false };
  const clean = sanitizeSvg(new TextDecoder().decode(bytes));
  if (!clean.includes("<svg")) {
    throw new AuthentikError({
      status: 400,
      code: "invalid_svg",
      message: "SVG is empty after sanitisation",
    });
  }
  return { type, bytes: new TextEncoder().encode(clean), sanitized: true };
}

/** Downloads an https image with a size cap. */
export async function fetchImage(url: string, maxMb: number): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new AuthentikError({
      status: 400,
      code: "insecure_url",
      message: "Source URL must use https",
    });
  }
  const response = await fetch(parsed, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
  if (!response.ok) {
    throw new AuthentikError({
      status: 400,
      code: "download_failed",
      message: `Could not download image (${response.status})`,
    });
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxMb * 1024 * 1024) {
    throw new AuthentikError({
      status: 400,
      code: "file_too_large",
      message: `Image exceeds ${maxMb} MB`,
    });
  }
  return new Uint8Array(await response.arrayBuffer());
}

export { MIME };
