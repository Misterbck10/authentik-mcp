import type { BrandingSnapshot } from "./snapshot";

type Yaml = string | number | boolean | null | undefined | Yaml[] | { [key: string]: Yaml };

const quote = (value: string) => JSON.stringify(value); // JSON strings are valid YAML scalars

function scalar(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "string") return String(value);
  if (value.includes("\n")) return value; // handled as block scalar by caller
  return quote(value);
}

function emit(value: Yaml, indent: number): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return " []";
    return value
      .map((item) => {
        const body = emit(item, indent + 1).replace(/^\n/, "");
        return `\n${pad}- ${body.trimStart()}`;
      })
      .join("");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return " {}";
    return entries
      .map(([key, v]) => {
        if (typeof v === "string" && v.includes("\n")) {
          const block = v
            .replace(/\n$/, "")
            .split("\n")
            .map((line) => `${pad}  ${line}`)
            .join("\n");
          return `\n${pad}${key}: |-\n${block}`;
        }
        if (v && typeof v === "object") return `\n${pad}${key}:${emit(v, indent + 1)}`;
        return `\n${pad}${key}: ${scalar(v as string | number | boolean | null)}`;
      })
      .join("");
  }
  return ` ${scalar(value)}`;
}

/** Converts a branding snapshot to an authentik blueprint (YAML) for versioning in Git. */
export function snapshotToBlueprint(snapshot: BrandingSnapshot): string {
  const { brand } = snapshot;
  const doc: Yaml = {
    version: 1,
    metadata: {
      name: `Branding - ${brand.domain}`,
      labels: { "blueprints.goauthentik.io/description": "Exported by authentik-mcp" },
    },
    entries: [
      {
        model: "authentik_brands.brand",
        identifiers: { domain: brand.domain },
        attrs: brand.fields as { [key: string]: Yaml },
      },
      ...snapshot.flows.map((flow) => ({
        model: "authentik_flows.flow",
        identifiers: { slug: flow.slug },
        state: "present",
        attrs: {
          title: flow.title,
          background: flow.background || undefined,
          layout: flow.layout,
          compatibility_mode: flow.compatibility_mode,
        },
      })),
      ...snapshot.applications
        .filter((app) => app.meta_icon)
        .map((app) => ({
          model: "authentik_core.application",
          identifiers: { slug: app.slug },
          attrs: { meta_icon: app.meta_icon },
        })),
    ],
  };
  return `# yaml-language-server: $schema=https://goauthentik.io/blueprints/schema.json${emit(doc, 0)}\n`;
}
