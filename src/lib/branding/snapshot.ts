import { randomBytes } from "node:crypto";
import type { AuthentikClient } from "@/lib/authentik/client";
import type { Schema } from "@/lib/authentik/types";
import { brandVisual, diffFields, listAll, type Brand, type BrandVisual } from "./brands";
import { listFiles, uploadBytes } from "./files";

export interface BrandingSnapshot {
  version: 1;
  createdAt: string;
  brand: { uuid: string; domain: string; fields: BrandVisual };
  flows: {
    slug: string;
    title: string;
    background: string;
    layout?: string;
    compatibility_mode: boolean;
  }[];
  applications: { slug: string; meta_icon: string }[];
  sources: { slug: string; type: string; icon: string }[];
}

const sourceType = (source: Schema<"Source">) =>
  `${source.meta_model_name}`.split(".")[0]?.replace(/^authentik_sources_/, "") ?? "";

export async function captureSnapshot(
  client: AuthentikClient,
  brand: Brand,
): Promise<BrandingSnapshot> {
  const [flows, applications, sources] = await Promise.all([
    listAll<Schema<"Flow">>(client, "/flows/instances/"),
    listAll<Schema<"Application">>(client, "/core/applications/", { superuser_full_list: true }),
    listAll<Schema<"Source">>(client, "/sources/all/"),
  ]);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    brand: { uuid: brand.brand_uuid, domain: brand.domain, fields: brandVisual(brand) },
    flows: flows.map((flow) => ({
      slug: flow.slug,
      title: flow.title,
      background: flow.background ?? "",
      layout: flow.layout,
      compatibility_mode: flow.compatibility_mode ?? false,
    })),
    applications: applications.map((app) => ({ slug: app.slug, meta_icon: app.meta_icon ?? "" })),
    sources: sources
      .filter((source) => !source.managed)
      .map((source) => ({ slug: source.slug, type: sourceType(source), icon: source.icon ?? "" })),
  };
}

export interface StoredSnapshot {
  id: string;
  storedIn: "files" | "inline";
  snapshot?: BrandingSnapshot;
  note?: string;
}

/**
 * Stores the snapshot as JSON through the Files API. Media files are served publicly, so the
 * name gets a random suffix; snapshots never contain secrets. Falls back to returning it inline.
 */
export async function storeSnapshot(
  client: AuthentikClient,
  snapshot: BrandingSnapshot,
): Promise<StoredSnapshot> {
  const stamp = snapshot.createdAt.replace(/[:.]/g, "-");
  const domain = snapshot.brand.domain.replace(/[^\w-]/g, "_") || "default";
  const id = `mcp-backups/branding-${domain}-${stamp}-${randomBytes(4).toString("hex")}.json`;
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
    await uploadBytes(client, id, bytes, "application/json");
    return { id, storedIn: "files" };
  } catch {
    return {
      id: `inline-${stamp}`,
      storedIn: "inline",
      snapshot,
      note: "Files API rejected the backup; keep this JSON to restore later.",
    };
  }
}

export async function loadSnapshot(
  client: AuthentikClient,
  baseUrl: string,
  id: string,
): Promise<BrandingSnapshot> {
  const file = (await listFiles(client, id)).find((candidate) => candidate.name === id);
  if (!file) throw new Error(`Snapshot not found: ${id}`);
  const url = file.url.startsWith("http")
    ? file.url
    : `${baseUrl}${file.url.startsWith("/") ? "" : "/"}${file.url}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Could not download snapshot (${response.status})`);
  return (await response.json()) as BrandingSnapshot;
}

export interface RestorePlan {
  brand: Record<string, { from: unknown; to: unknown }>;
  flows: { slug: string; changes: Record<string, { from: unknown; to: unknown }> }[];
  applications: { slug: string; from: string; to: string }[];
  sources: { slug: string; type: string; from: string; to: string }[];
}

export function planRestore(current: BrandingSnapshot, target: BrandingSnapshot): RestorePlan {
  const bySlug = <T extends { slug: string }>(items: T[]) =>
    new Map(items.map((item) => [item.slug, item]));
  const flows = bySlug(current.flows);
  const apps = bySlug(current.applications);
  const sources = bySlug(current.sources);
  return {
    brand: diffFields(
      current.brand.fields as Record<string, unknown>,
      target.brand.fields as Record<string, unknown>,
    ),
    flows: target.flows
      .filter((flow) => flows.has(flow.slug))
      .map((flow) => {
        const { slug, ...fields } = flow;
        const { slug: _ignored, ...now } = flows.get(slug)!;
        return { slug, changes: diffFields(now, fields) };
      })
      .filter((entry) => Object.keys(entry.changes).length > 0),
    applications: target.applications
      .filter((app) => apps.has(app.slug) && apps.get(app.slug)!.meta_icon !== app.meta_icon)
      .map((app) => ({ slug: app.slug, from: apps.get(app.slug)!.meta_icon, to: app.meta_icon })),
    sources: target.sources
      .filter((src) => sources.has(src.slug) && sources.get(src.slug)!.icon !== src.icon)
      .map((src) => ({
        slug: src.slug,
        type: src.type,
        from: sources.get(src.slug)!.icon,
        to: src.icon,
      })),
  };
}

export async function applyRestore(
  client: AuthentikClient,
  brandUuid: string,
  plan: RestorePlan,
): Promise<void> {
  const brandPatch = Object.fromEntries(
    Object.entries(plan.brand).map(([key, value]) => [key, value.to]),
  );
  if (Object.keys(brandPatch).length) await client.patch(`/core/brands/${brandUuid}/`, brandPatch);
  for (const flow of plan.flows) {
    const patch = Object.fromEntries(
      Object.entries(flow.changes).map(([key, value]) => [key, value.to]),
    );
    await client.patch(`/flows/instances/${encodeURIComponent(flow.slug)}/`, patch);
  }
  for (const app of plan.applications) {
    await client.patch(`/core/applications/${encodeURIComponent(app.slug)}/`, {
      meta_icon: app.to,
    });
  }
  for (const source of plan.sources) {
    await client.patch(`/sources/${source.type}/${encodeURIComponent(source.slug)}/`, {
      icon: source.to,
    });
  }
}
