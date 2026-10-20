import postcss, { type Root } from "postcss";

export interface CssPolicy {
  maxKb: number;
  /** Hosts allowed in url() and @import besides the authentik host itself. */
  allowedHosts: string[];
  authentikHost: string;
}

export interface CssReview {
  ok: boolean;
  errors: string[];
  /** Hiding security-relevant UI; requires explicit acknowledgement. */
  securityWarnings: string[];
  /** Direct selectors that may break on upgrade. */
  fragileSelectors: string[];
}

const FORBIDDEN = [
  { pattern: /javascript:/i, message: "javascript: URLs are not allowed" },
  { pattern: /expression\s*\(/i, message: "expression() is not allowed" },
  { pattern: /<\/?\s*(style|script)/i, message: "HTML tags are not allowed in CSS" },
];

const SECURITY_HINT =
  /error|alert|danger|warning|mfa|otp|totp|webauthn|authenticator|recovery|forgot|reset|password|captcha|message|notice|security/i;
const HIDES = /^(display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(\.0+)?)\b/i;

// Selectors that only touch theming hooks and are stable across upgrades.
const STABLE_SELECTOR =
  /^(\*(::?(before|after))?|:root|html(\[data-theme=["']?(light|dark)["']?\])?|body|[a-z][a-z0-9-]*::part\([\w-]+\))$/i;

function urlHostAllowed(raw: string, policy: CssPolicy): boolean {
  const value = raw.trim().replace(/^['"]|['"]$/g, "");
  if (value.startsWith("data:"))
    return /^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(value);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("//")) return true; // relative
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (url.protocol !== "https:") return false;
    return url.hostname === policy.authentikHost || policy.allowedHosts.includes(url.hostname);
  } catch {
    return false;
  }
}

function checkUrls(root: Root, policy: CssPolicy, errors: string[]): void {
  const urlPattern = /url\(\s*([^)]*)\)/gi;
  root.walkDecls((decl) => {
    for (const match of decl.value.matchAll(urlPattern)) {
      if (!urlHostAllowed(match[1] ?? "", policy)) {
        errors.push(`url() not allowed in "${decl.prop}": ${match[1]}`);
      }
    }
  });
  root.walkAtRules("import", (rule) => {
    const target = rule.params.replace(/^url\(\s*|\s*\)\s*[^)]*$/g, "").split(/\s/)[0] ?? "";
    if (!urlHostAllowed(target, policy)) errors.push(`@import not allowed: ${rule.params}`);
  });
}

/** Validates CSS syntax and safety rules before it is sent to authentik. */
export function reviewCss(css: string, policy: CssPolicy): CssReview {
  const errors: string[] = [];
  const securityWarnings: string[] = [];
  const fragile = new Set<string>();

  const sizeKb = Buffer.byteLength(css, "utf8") / 1024;
  if (sizeKb > policy.maxKb)
    errors.push(`CSS is ${sizeKb.toFixed(1)} KB; limit is ${policy.maxKb} KB`);
  for (const rule of FORBIDDEN) if (rule.pattern.test(css)) errors.push(rule.message);

  let root: Root;
  try {
    root = postcss.parse(css);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "parse error";
    return {
      ok: false,
      errors: [...errors, `Invalid CSS: ${reason}`],
      securityWarnings,
      fragileSelectors: [],
    };
  }

  checkUrls(root, policy, errors);
  // Checked per declaration so e.g. "scroll-behavior" is not mistaken for "behavior".
  root.walkDecls((decl) => {
    const prop = decl.prop.toLowerCase();
    if (prop === "behavior" || prop === "-moz-binding") errors.push(`${decl.prop} is not allowed`);
  });
  root.walkRules((rule) => {
    const insideKeyframes =
      rule.parent?.type === "atrule" && /keyframes/i.test((rule.parent as { name: string }).name);
    if (insideKeyframes) return;
    for (const selector of rule.selectors) {
      if (!STABLE_SELECTOR.test(selector.trim())) fragile.add(selector.trim());
    }
    if (SECURITY_HINT.test(rule.selector)) {
      rule.walkDecls((decl) => {
        if (HIDES.test(`${decl.prop}:${decl.value}`)) {
          securityWarnings.push(`"${rule.selector}" sets ${decl.prop}: ${decl.value}`);
        }
      });
    }
  });

  return { ok: errors.length === 0, errors, securityWarnings, fragileSelectors: [...fragile] };
}
