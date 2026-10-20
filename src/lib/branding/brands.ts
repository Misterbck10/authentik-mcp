import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import { listPaginated } from "@/lib/authentik/pagination";
import { isUuid } from "@/lib/authentik/resolve";
import type { Paginated, Schema } from "@/lib/authentik/types";

export type Brand = Schema<"Brand">;

/** "default" selects the default brand; otherwise a uuid or exact domain. */
export async function resolveBrand(client: AuthentikClient, ref: string): Promise<Brand> {
  if (isUuid(ref)) return client.get<Brand>(`/core/brands/${ref}/`);
  const query = ref === "default" ? { default: true } : { domain: ref };
  const page = await client.get<Paginated<Brand>>("/core/brands/", { ...query, page_size: 2 });
  const brand = page.results[0];
  if (!brand) {
    throw new AuthentikError({
      status: 404,
      code: "not_found",
      message: `Brand not found: ${ref}`,
    });
  }
  return brand;
}

export const BRAND_VISUAL_FIELDS = [
  "branding_title",
  "branding_logo",
  "branding_favicon",
  "branding_default_flow_background",
  "branding_custom_css",
  "attributes",
] as const;

export type BrandVisual = Pick<Brand, (typeof BRAND_VISUAL_FIELDS)[number]>;

export function brandVisual(brand: Brand): BrandVisual {
  return Object.fromEntries(
    BRAND_VISUAL_FIELDS.map((field) => [field, brand[field]]),
  ) as BrandVisual;
}

export function defaultBrandWarning(brand: Brand): string[] {
  return brand.default
    ? ["This is the DEFAULT brand: changes affect every domain without its own brand."]
    : [];
}

/** Deep merge for brand/user attributes: never drops keys we did not set. */
export function mergeAttributes(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    const existing = result[key];
    result[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === "object"
        ? mergeAttributes(existing as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return result;
}

/** Field-level diff for dry-runs. */
export function diffFields(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    if (JSON.stringify(current[key]) !== JSON.stringify(value))
      diff[key] = { from: current[key], to: value };
  }
  return diff;
}

export async function listAll<T>(
  client: AuthentikClient,
  path: string,
  query: Record<string, string | boolean> = {},
): Promise<T[]> {
  return (await listPaginated<T>(client, path, query, 1000)).results;
}
