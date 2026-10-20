/** Internal guide served as authentik://branding/css-guide. Keep it short and practical. */
export const CSS_GUIDE = `# authentik CSS customisation guide

authentik's UI is built from Lit web components (Shadow DOM) on top of PatternFly 4/5.
Brand custom CSS applies to the flow executor (login, enrollment, recovery) and the user
app library. Order of preference:

1. **CSS variables** (survive upgrades). Set them on \`:root\` (light) and
   \`html[data-theme="dark"]\` (dark). Emit both PatternFly v4 and v5 names:
   | Purpose | PF4 | PF5 |
   |---|---|---|
   | Primary / buttons | --pf-global--primary-color--100 | --pf-v5-global--primary-color--100 |
   | Primary hover | --pf-global--primary-color--200 | --pf-v5-global--primary-color--200 |
   | Links | --pf-global--link--Color (+ --hover) | --pf-v5-global--link--Color |
   | Page background | --pf-global--BackgroundColor--200 | --pf-v5-global--BackgroundColor--200 |
   | Cards / surfaces | --pf-global--BackgroundColor--100 | --pf-v5-global--BackgroundColor--100 |
   | Text | --pf-global--Color--100 | --pf-v5-global--Color--100 |
   | Muted text | --pf-global--Color--200 | --pf-v5-global--Color--200 |
   | Danger / success | --pf-global--danger-color--100 / --pf-global--success-color--100 | v5 equivalents |
   | Radius | --pf-global--BorderRadius--sm / --lg | v5 equivalents |
   | Fonts | --pf-global--FontFamily--sans-serif, --pf-global--FontFamily--heading--sans-serif | --pf-v5-global--FontFamily--text / --heading |
   | authentik accent | --ak-accent | |
   Component-level button variables: --pf-c-button--m-primary--BackgroundColor,
   --pf-c-button--m-primary--hover--BackgroundColor, --pf-c-button--m-primary--Color.

2. **::part()** for components that expose parts, e.g.
   \`ak-flow-executor::part(locale-select)\`, \`ak-library::part(card-header-icon)\`.
   Part names are not fully documented: inspect the UI (devtools, look for \`part="..."\`)
   before relying on one.

3. **Direct selectors** only as a last resort — they target internal markup and can
   break on any upgrade. Flows in *compatibility mode* render without real Shadow DOM,
   so direct selectors behave differently there.

Rules enforced by this server:
- Max size MCP_BRANDING_MAX_CSS_KB; parsed with postcss before sending.
- No javascript:, expression(), behavior, -moz-binding, HTML tags.
- url() / @import only to the authentik host, relative paths, data:image or
  MCP_BRANDING_ALLOWED_ASSET_HOSTS (Google Fonts by default).
- Hiding errors, MFA prompts or recovery links requires explicit acknowledgement.
- Server-managed CSS lives between /* mcp:start */ and /* mcp:end */; CSS outside is untouched.

Accessibility: keep text/background and button text/primary at WCAG AA (4.5:1). Honour
prefers-contrast, prefers-reduced-motion and prefers-reduced-transparency. Prefer rem units.
`;
