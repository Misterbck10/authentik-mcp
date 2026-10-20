import { z } from "zod";
import { listPaginated } from "@/lib/authentik/pagination";
import { resolveApplication, resolveCertificatePk, resolveFlowPk } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { AuthentikError } from "@/lib/authentik/errors";
import {
  brandVisual,
  defaultBrandWarning,
  diffFields,
  resolveBrand,
  type Brand,
} from "@/lib/branding/brands";
import { splitManagedCss } from "@/lib/branding/managed-block";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { slug } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { autoSnapshot, brandRef, filePath } from "./shared";

const hostname = z
  .string()
  .regex(/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/i, 'domain like "auth.example.com" or "*.example.com"');

function compactBrand(brand: Brand) {
  const { manual, managed } = splitManagedCss(brand.branding_custom_css ?? "");
  return {
    uuid: brand.brand_uuid,
    domain: brand.domain,
    default: brand.default ?? false,
    title: brand.branding_title,
    logo: brand.branding_logo,
    favicon: brand.branding_favicon,
    flowBackground: brand.branding_default_flow_background,
    customCss: { manualBytes: manual.length, hasManagedBlock: managed !== null },
    attributes: brand.attributes ?? {},
    flows: {
      authentication: brand.flow_authentication,
      invalidation: brand.flow_invalidation,
      recovery: brand.flow_recovery,
      unenrollment: brand.flow_unenrollment,
      userSettings: brand.flow_user_settings,
      deviceCode: brand.flow_device_code,
      userSwitch: brand.flow_user_switch,
      lockdown: brand.flow_lockdown,
    },
    defaultApplication: brand.default_application,
    webCertificate: brand.web_certificate,
  };
}

export const brandsList = defineTool({
  name: "authentik_branding_brands_list",
  domain: "branding",
  kind: "read",
  title: "List brands",
  description: "List brands (per-domain branding) and which one is the default.",
  input: z.object({}),
  handler: async (_args, { client }) => {
    const page = await listPaginated<Brand>(client, "/core/brands/", { ordering: "domain" }, 200);
    return { total: page.total, brands: page.results.map(compactBrand) };
  },
});

export const brandsGet = defineTool({
  name: "authentik_branding_brands_get",
  domain: "branding",
  kind: "read",
  title: "Get brand",
  description: "Get a brand's visual settings, attributes, default flows and certificate.",
  input: z.object({ brand: brandRef }),
  handler: async (args, { client }) => compactBrand(await resolveBrand(client, args.brand)),
});

const flowFields = {
  authenticationFlow: slug.optional(),
  invalidationFlow: slug.optional(),
  recoveryFlow: slug.optional(),
  unenrollmentFlow: slug.optional(),
  userSettingsFlow: slug.optional(),
  deviceCodeFlow: slug.optional(),
  userSwitchFlow: slug.optional().describe("Flow used to switch between accounts"),
  lockdownFlow: slug.optional(),
};

const brandFields = {
  title: z.string().max(100).optional(),
  logo: filePath.or(z.url()).optional().describe("Stored path (may use %(theme)s) or https URL"),
  favicon: filePath.or(z.url()).optional(),
  flowBackground: filePath.or(z.url()).optional(),
  defaultApplication: slug.optional().describe("App slug users land on after login"),
  webCertificate: z.string().max(200).optional().describe("Certificate name or uuid"),
  ...flowFields,
};

type BrandFieldArgs = { [K in keyof typeof brandFields]?: string };

const FLOW_MAP = {
  authenticationFlow: "flow_authentication",
  invalidationFlow: "flow_invalidation",
  recoveryFlow: "flow_recovery",
  unenrollmentFlow: "flow_unenrollment",
  userSettingsFlow: "flow_user_settings",
  deviceCodeFlow: "flow_device_code",
  userSwitchFlow: "flow_user_switch",
  lockdownFlow: "flow_lockdown",
} as const;

async function brandBody(
  client: Parameters<typeof resolveFlowPk>[0],
  args: BrandFieldArgs,
): Promise<Partial<Schema<"BrandRequest">>> {
  const body: Partial<Schema<"BrandRequest">> = {
    branding_title: args.title,
    branding_logo: args.logo,
    branding_favicon: args.favicon,
    branding_default_flow_background: args.flowBackground,
  };
  for (const [arg, field] of Object.entries(FLOW_MAP)) {
    const value = args[arg as keyof typeof FLOW_MAP];
    if (value) body[field] = await resolveFlowPk(client, value);
  }
  if (args.defaultApplication) {
    body.default_application = (await resolveApplication(client, args.defaultApplication)).pk;
  }
  if (args.webCertificate) {
    body.web_certificate = await resolveCertificatePk(client, args.webCertificate);
  }
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

export const brandsCreate = defineTool({
  name: "authentik_branding_brands_create",
  domain: "branding",
  kind: "write",
  title: "Create brand",
  description:
    "Create a brand for a domain (e.g. auth.client.com) so it gets its own title, logo, CSS " +
    "and default flows. Unset fields fall back to authentik defaults.",
  input: z.object({ domain: hostname, ...brandFields }),
  handler: async (args, { client }) => {
    const body = { domain: args.domain, default: false, ...(await brandBody(client, args)) };
    const brand = await client.post<Brand>("/core/brands/", body);
    return { created: true, brand: compactBrand(brand) };
  },
});

export const brandsUpdate = defineTool({
  name: "authentik_branding_brands_update",
  domain: "branding",
  kind: "destructive",
  idempotent: true,
  title: "Update brand",
  description:
    "Change a brand's title, logo, favicon, default flow background, default flows (incl. user " +
    "switch flow), default application or web certificate. Dry-run diff unless confirm: true; " +
    "a snapshot is taken automatically before applying.",
  input: z.object({ brand: brandRef, ...brandFields, confirm: confirmField }),
  handler: async (args, { client }) => {
    const brand = await resolveBrand(client, args.brand);
    const body = await brandBody(client, args);
    const diff = diffFields(brand as Record<string, unknown>, body);
    if (Object.keys(diff).length === 0) return { changed: false, brand: compactBrand(brand) };
    if (!args.confirm)
      return dryRun([`Update brand ${brand.domain}`], diff, defaultBrandWarning(brand));
    const snapshot = await autoSnapshot(client, brand);
    const updated = await client.patch<Brand>(`/core/brands/${brand.brand_uuid}/`, body);
    return { changed: true, snapshot, brand: compactBrand(updated) };
  },
});

export const brandsDelete = defineTool({
  name: "authentik_branding_brands_delete",
  domain: "branding",
  kind: "destructive",
  idempotent: true,
  title: "Delete brand",
  description:
    "Delete a non-default brand; its domain falls back to the default brand. The default brand " +
    "can never be deleted. Snapshot is taken first.",
  input: z.object({ brand: brandRef, confirm: confirmField }),
  handler: async (args, { client }) => {
    const brand = await resolveBrand(client, args.brand);
    if (brand.default) {
      throw new AuthentikError({
        status: 400,
        code: "default_brand",
        message: "The default brand cannot be deleted.",
      });
    }
    if (!args.confirm) return dryRun([`Delete brand ${brand.domain}`], brandVisual(brand));
    const snapshot = await autoSnapshot(client, brand);
    await client.delete(`/core/brands/${brand.brand_uuid}/`);
    return { deleted: true, domain: brand.domain, snapshot };
  },
});
