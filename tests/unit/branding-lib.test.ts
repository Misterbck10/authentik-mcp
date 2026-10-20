import { describe, expect, it } from "vitest";
import { snapshotToBlueprint } from "@/lib/branding/blueprint";
import { mergeAttributes } from "@/lib/branding/brands";
import { designTokens, generateCss } from "@/lib/branding/css-generator";
import { reviewCss } from "@/lib/branding/css-sanitizer";
import { detectImageType, sanitizeSvg } from "@/lib/branding/images";
import { mergeManagedCss, splitManagedCss } from "@/lib/branding/managed-block";
import { planRestore, type BrandingSnapshot } from "@/lib/branding/snapshot";
import { checkPair, contrastRatio, suggestAccessible } from "@/lib/branding/wcag";

const policy = { maxKb: 100, allowedHosts: ["fonts.googleapis.com"], authentikHost: "auth.test" };

describe("wcag", () => {
  it("computes known contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  it("suggests a passing colour for failing pairs", () => {
    const check = checkPair("x", "#9ab", "#ffffff");
    expect(check.passes).toBe(false);
    expect(contrastRatio(check.suggestion!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(suggestAccessible("#335", "#111111"), "#111111")).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

describe("css generator", () => {
  const tokens = designTokens.parse({
    light: { primary: "#0b5fff", background: "#f5f7fa", surface: "#ffffff", text: "#1a1a1a" },
    dark: { primary: "#5c9dff", background: "#0d1117", surface: "#161b22", text: "#e6edf3" },
    fontFamily: "Inter, sans-serif",
    fontUrl: "https://fonts.googleapis.com/css2?family=Inter",
  });
  const css = generateCss(tokens);

  it("uses variables for light and dark and accessibility queries", () => {
    expect(css).toContain(":root {");
    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain("--pf-global--primary-color--100: #0b5fff");
    expect(css).toContain("--pf-v5-global--primary-color--100: #0b5fff");
    expect(css).toContain("prefers-contrast: more");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("prefers-reduced-transparency: reduce");
  });

  it("passes its own review without fragile selectors", () => {
    const review = reviewCss(css, policy);
    expect(review).toMatchObject({ ok: true, errors: [], securityWarnings: [] });
    expect(review.fragileSelectors).toEqual([]);
  });
});

describe("css review", () => {
  it("rejects dangerous constructs and foreign hosts", () => {
    const review = reviewCss(
      `@import url("https://evil.test/x.css");
       body { background: url(https://evil.test/a.png); behavior: url(x.htc); }
       a { color: expression(alert(1)); }`,
      policy,
    );
    expect(review.ok).toBe(false);
    expect(review.errors.join(" ")).toMatch(/@import not allowed/);
    expect(review.errors.join(" ")).toMatch(/url\(\) not allowed/);
    expect(review.errors.join(" ")).toMatch(/expression/);
  });

  it("allows Google Fonts, relative and authentik URLs", () => {
    const review = reviewCss(
      `@import url("https://fonts.googleapis.com/css2?family=Inter");
       :root { --bg: url("/media/branding/bg.png"); --x: url(https://auth.test/a.png); }`,
      policy,
    );
    expect(review.ok).toBe(true);
  });

  it("flags hidden security UI and fragile selectors", () => {
    const review = reviewCss(".pf-c-alert.pf-m-danger { display: none }", policy);
    expect(review.securityWarnings).toHaveLength(1);
    expect(review.fragileSelectors).toContain(".pf-c-alert.pf-m-danger");
  });

  it("rejects invalid syntax and oversize CSS", () => {
    expect(reviewCss("a { color: red", policy).ok).toBe(false);
    expect(reviewCss(`:root{--x:"${"a".repeat(2048)}"}`, { ...policy, maxKb: 1 }).ok).toBe(false);
  });
});

describe("managed block", () => {
  it("replaces only the managed block and keeps manual CSS", () => {
    const first = mergeManagedCss(".manual { color: red; }", ":root { --a: 1; }", "replace");
    const second = mergeManagedCss(first, ":root { --a: 2; }", "replace");
    expect(splitManagedCss(second)).toEqual({
      manual: ".manual { color: red; }",
      managed: ":root { --a: 2; }",
    });
    const appended = mergeManagedCss(second, ":root { --b: 3; }", "append");
    expect(splitManagedCss(appended).managed).toContain("--a: 2");
    expect(splitManagedCss(appended).managed).toContain("--b: 3");
  });
});

describe("images", () => {
  it("detects types by magic bytes", () => {
    expect(detectImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe("png");
    expect(detectImageType(new TextEncoder().encode('<?xml version="1.0"?><svg/>'))).toBe("svg");
    expect(detectImageType(new TextEncoder().encode("<html><script>"))).toBeUndefined();
  });

  it("strips scripts, handlers and external links from SVG", () => {
    const clean = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script>' +
        '<a href="https://evil.test"><rect width="1" height="1"/></a><use href="#a"/></svg>',
    );
    expect(clean).not.toMatch(/script|onload|evil\.test/);
    expect(clean).toContain("<rect");
  });
});

describe("attributes merge", () => {
  it("never drops unrelated keys", () => {
    expect(
      mergeAttributes(
        { settings: { theme: { base: "light" }, navbar: { x: 1 } }, custom: true },
        { settings: { locale: "pt" } },
      ),
    ).toEqual({
      settings: { theme: { base: "light" }, navbar: { x: 1 }, locale: "pt" },
      custom: true,
    });
  });
});

const snapshot = (title: string, icon: string): BrandingSnapshot => ({
  version: 1,
  createdAt: "2026-10-21T00:00:00Z",
  brand: {
    uuid: "b",
    domain: "auth.test",
    fields: {
      branding_title: title,
      branding_logo: "branding/logo-%(theme)s.svg",
      branding_custom_css: "/* mcp:start */\n:root{}\n/* mcp:end */\n",
      attributes: { settings: { locale: "pt" } },
    },
  },
  flows: [
    {
      slug: "login",
      title: "Welcome",
      background: "",
      layout: "stacked",
      compatibility_mode: false,
    },
  ],
  applications: [{ slug: "wiki", meta_icon: icon }],
  sources: [],
});

describe("restore plan", () => {
  it("lists only what differs", () => {
    const plan = planRestore(snapshot("New", "a.png"), snapshot("Old", "a.png"));
    expect(plan.brand).toEqual({ branding_title: { from: "New", to: "Old" } });
    expect(plan.flows).toEqual([]);
    expect(plan.applications).toEqual([]);
    const iconPlan = planRestore(snapshot("Old", "b.png"), snapshot("Old", "a.png"));
    expect(iconPlan.applications).toEqual([{ slug: "wiki", from: "b.png", to: "a.png" }]);
  });
});

describe("blueprint export", () => {
  it("produces a blueprint with brand, flows and icons", () => {
    const yaml = snapshotToBlueprint(snapshot("Acme", "branding/apps/wiki.svg"));
    expect(yaml).toContain("version: 1");
    expect(yaml).toContain('model: "authentik_brands.brand"');
    expect(yaml).toContain('domain: "auth.test"');
    expect(yaml).toContain('branding_logo: "branding/logo-%(theme)s.svg"');
    expect(yaml).toContain("branding_custom_css: |-");
    expect(yaml).toContain('model: "authentik_flows.flow"');
    expect(yaml).toContain('meta_icon: "branding/apps/wiki.svg"');
  });
});
