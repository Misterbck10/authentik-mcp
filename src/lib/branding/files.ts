import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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

const MAX_REDIRECTS = 3;

const badUrl = (message: string) =>
  new AuthentikError({ status: 400, code: "insecure_url", message });

/** True for loopback, private, link-local (cloud metadata), CGNAT and other non-public ranges. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}

async function assertPublicHttps(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw badUrl("Source URL must use https");
  const addresses = isIP(url.hostname.replace(/^\[|\]$/g, ""))
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true }).catch(() => {
        throw badUrl(`Cannot resolve ${url.hostname}`);
      });
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw badUrl("Source URL must point to a public host");
  }
}

/** Reads at most `limit` bytes, aborting as soon as the stream exceeds it. */
async function readCapped(response: Response, limit: number, maxMb: number): Promise<Uint8Array> {
  const tooLarge = () =>
    new AuthentikError({
      status: 400,
      code: "file_too_large",
      message: `Image exceeds ${maxMb} MB`,
    });
  if (Number(response.headers.get("content-length") ?? 0) > limit) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Downloads a public https image with a size cap. Redirects are followed manually so every hop
 * is re-checked; private/internal addresses (SSRF targets such as cloud metadata) are refused.
 */
export async function fetchImage(url: string, maxMb: number): Promise<Uint8Array> {
  let target = new URL(url);
  const signal = AbortSignal.timeout(10_000);
  for (let hop = 0; ; hop++) {
    await assertPublicHttps(target);
    const response = await fetch(target, { signal, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw badUrl("Too many redirects");
      target = new URL(location, target);
      continue;
    }
    if (!response.ok) {
      throw new AuthentikError({
        status: 400,
        code: "download_failed",
        message: `Could not download image (${response.status})`,
      });
    }
    return readCapped(response, maxMb * 1024 * 1024, maxMb);
  }
}

export { MIME };
