import { z } from "zod";
import { AuthentikError } from "@/lib/authentik/errors";
import { brandVisual, defaultBrandWarning, diffFields, resolveBrand } from "@/lib/branding/brands";
import { generateCss, designTokens } from "@/lib/branding/css-generator";
import { reviewCss } from "@/lib/branding/css-sanitizer";
import { mergeManagedCss, splitManagedCss } from "@/lib/branding/managed-block";
import { checkPair, type ContrastCheck } from "@/lib/branding/wcag";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { defineTool } from "../define-tool";
import {
  autoSnapshot,
  brandRef,
  brandSlug,
  cssPolicy,
  imageSource,
  materializeImage,
  materializeThemedImage,
  UPGRADE_NOTE,
} from "./shared";

function contrastChecks(tokens: z.infer<typeof designTokens>): ContrastCheck[] {
  const checks: ContrastCheck[] = [];
  for (const [mode, p] of Object.entries({ light: tokens.light, dark: tokens.dark })) {
    if (!p) continue;
    checks.push(
      checkPair(`${mode}: text on background`, p.text, p.background),
      checkPair(`${mode}: text on surface`, p.text, p.surface),
      checkPair(`${mode}: link (primary) on surface`, p.primary, p.surface),
    );
    if (p.textMuted)
      checks.push(checkPair(`${mode}: muted text on surface`, p.textMuted, p.surface));
  }
  return checks;
}

function buttonContrast(tokens: z.infer<typeof designTokens>): ContrastCheck[] {
  // Button text colour is chosen automatically (black/white); verify it still reaches AA.
  return [tokens.light, tokens.dark].filter(Boolean).map((p) => {
    const white = checkPair("button text on primary", "#ffffff", p!.primary);
    const black = checkPair("button text on primary", "#000000", p!.primary);
    return white.ratio >= black.ratio ? white : black;
  });
}

export const applyDesignTokens = defineTool({
  name: "authentik_branding_apply_design_tokens",
  domain: "branding",
  kind: "destructive",
  idempotent: true,
  title: "Apply brand design tokens",
  description:
    "Main branding tool. From brand tokens (colours for light/dark, radius, font, logos, favicon, " +
    "login background) it generates variable-based CSS (PatternFly/authentik variables, " +
    "accessibility media queries), validates WCAG AA contrast, uploads images and sets brand " +
    "fields (themed logos use %(theme)s). Without confirm: true returns the CSS, contrast report " +
    "and diff. Refuses to apply when contrast fails unless ignoreContrast is set. Snapshot first.",
  input: z.object({
    brand: brandRef,
    tokens: designTokens,
    title: z.string().max(100).optional(),
    logoLight: imageSource.optional(),
    logoDark: imageSource.optional(),
    favicon: imageSource.optional(),
    flowBackground: imageSource.optional(),
    ignoreContrast: z.boolean().default(false),
    confirm: confirmField,
  }),
  handler: async (args, { client, env }) => {
    const brand = await resolveBrand(client, args.brand);
    const css = generateCss(args.tokens);
    const review = reviewCss(css, cssPolicy(env));
    // Generated CSS never hides UI on its own; a security warning means a token injected rules.
    if (!review.ok || review.securityWarnings.length) {
      throw new AuthentikError({
        status: 400,
        code: "invalid_css",
        message: [...review.errors, ...review.securityWarnings].join("; "),
      });
    }
    const contrast = [...contrastChecks(args.tokens), ...buttonContrast(args.tokens)];
    const failing = contrast.filter((check) => !check.passes);
    const nextCss = mergeManagedCss(brand.branding_custom_css ?? "", css, "replace");

    if (!args.confirm || (failing.length && !args.ignoreContrast)) {
      return {
        ...dryRun(
          [
            `Replace the MCP-managed CSS block of ${brand.domain}`,
            ...(args.title ? [`Set title to "${args.title}"`] : []),
            ...(args.logoLight || args.logoDark ? ["Upload and set logo"] : []),
            ...(args.favicon ? ["Upload and set favicon"] : []),
            ...(args.flowBackground ? ["Upload and set default flow background"] : []),
          ],
          { css, cssDiff: diffFields({ css: brand.branding_custom_css ?? "" }, { css: nextCss }) },
          defaultBrandWarning(brand),
        ),
        contrast,
        ...(failing.length
          ? {
              blocked: true,
              reason:
                "WCAG AA contrast (4.5:1) fails for some pairs. Use the suggested colours or set " +
                "ignoreContrast: true.",
            }
          : {}),
      };
    }

    const snapshot = await autoSnapshot(client, brand);
    const base = `branding/${brandSlug(brand)}`;
    const logo = await materializeThemedImage(
      client,
      env,
      { light: args.logoLight, dark: args.logoDark },
      `${base}/logo`,
    );
    const favicon = args.favicon
      ? await materializeImage(client, env, args.favicon, `${base}/favicon`)
      : undefined;
    const background = args.flowBackground
      ? await materializeImage(client, env, args.flowBackground, `${base}/flow-background`)
      : undefined;
    const patch = Object.fromEntries(
      Object.entries({
        branding_custom_css: nextCss,
        branding_title: args.title,
        branding_logo: logo.value,
        branding_favicon: favicon?.value,
        branding_default_flow_background: background?.value,
      }).filter(([, v]) => v !== undefined),
    );
    await client.patch(`/core/brands/${brand.brand_uuid}/`, patch);
    return {
      applied: true,
      snapshot,
      fields: Object.keys(patch),
      uploaded: [...logo.uploaded, favicon?.uploaded, background?.uploaded].filter(Boolean),
      contrast,
      note: "Open the preview URLs in a private window (authentik caches brand assets).",
    };
  },
});

export const setCustomCss = defineTool({
  name: "authentik_branding_set_custom_css",
  domain: "branding",
  kind: "destructive",
  idempotent: false,
  title: "Set custom CSS",
  description:
    "Apply hand-written CSS inside the MCP-managed block (/* mcp:start */ … /* mcp:end */): " +
    "mode replace swaps the block, append adds to it. CSS outside the block is never touched. " +
    "CSS is parsed and checked (size, forbidden constructs, allowed url()/@import hosts). Hiding " +
    "security UI (errors, MFA, recovery) needs acknowledgeHiddenSecurity. Prefer CSS variables " +
    "and ::part(). Snapshot first.",
  input: z.object({
    brand: brandRef,
    css: z.string().min(1),
    mode: z.enum(["replace", "append"]).default("replace"),
    acknowledgeHiddenSecurity: z.boolean().default(false),
    confirm: confirmField,
  }),
  handler: async (args, { client, env }) => {
    const brand = await resolveBrand(client, args.brand);
    const review = reviewCss(args.css, cssPolicy(env));
    if (!review.ok) {
      throw new AuthentikError({
        status: 400,
        code: "invalid_css",
        message: review.errors.join("; "),
      });
    }
    const warnings = [
      ...defaultBrandWarning(brand),
      ...(review.fragileSelectors.length
        ? [`${UPGRADE_NOTE} Fragile: ${review.fragileSelectors.slice(0, 10).join(", ")}`]
        : []),
      ...review.securityWarnings.map((w) => `Hides security-relevant UI: ${w}`),
    ];
    const nextCss = mergeManagedCss(brand.branding_custom_css ?? "", args.css, args.mode);
    const blocked = review.securityWarnings.length > 0 && !args.acknowledgeHiddenSecurity;
    if (!args.confirm || blocked) {
      return {
        ...dryRun(
          [`${args.mode} MCP CSS block on ${brand.domain}`],
          { resultingCss: nextCss },
          warnings,
        ),
        ...(blocked
          ? { blocked: true, reason: "Set acknowledgeHiddenSecurity: true to hide security UI." }
          : {}),
      };
    }
    const snapshot = await autoSnapshot(client, brand);
    await client.patch(`/core/brands/${brand.brand_uuid}/`, { branding_custom_css: nextCss });
    return { applied: true, snapshot, warnings };
  },
});

export const getEffectiveCss = defineTool({
  name: "authentik_branding_get_effective_css",
  domain: "branding",
  kind: "read",
  title: "Get brand CSS",
  description:
    "Return the brand's current custom CSS split into manual CSS and the MCP-managed block.",
  input: z.object({ brand: brandRef }),
  handler: async (args, { client }) => {
    const brand = await resolveBrand(client, args.brand);
    return {
      domain: brand.domain,
      ...splitManagedCss(brandVisual(brand).branding_custom_css ?? ""),
    };
  },
});
