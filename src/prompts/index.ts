import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "@/lib/config/env";

const userMessage = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

export function registerPrompts(server: McpServer, env: Env): void {
  const enabled = new Set(env.MCP_ENABLED_DOMAINS);

  if (enabled.has("users") && !env.MCP_READ_ONLY) {
    server.registerPrompt(
      "onboard-employee",
      {
        title: "Onboard an employee",
        description: "Create an account, add groups and send the password-set link",
        argsSchema: z.object({
          name: z.string().describe("Full name"),
          email: z.string().describe("Work email"),
          department: z.string().optional(),
          groups: z.string().optional().describe("Comma-separated group names"),
        }),
      },
      (args) =>
        userMessage(
          `Onboard a new employee in authentik.
Name: ${args.name}
Email: ${args.email}
Department: ${args.department ?? "(ask me)"}
Groups: ${args.groups ?? "(ask me)"}

Steps:
1. Call authentik_users_attribute_definitions and ask me for any required attribute.
2. Check the groups exist with authentik_groups_list; ask before creating new groups.
3. Propose a username (e.g. from the email local part) and confirm it with me.
4. Call authentik_users_onboard_employee (passwordSetup "email").
5. Summarise the account, groups and how the password link was delivered.`,
        ),
    );
  }

  if (enabled.has("applications") && !env.MCP_READ_ONLY) {
    server.registerPrompt(
      "connect-new-app",
      {
        title: "Connect a new app to SSO",
        description: "Choose OIDC vs proxy and create the application with its provider",
        argsSchema: z.object({
          name: z.string(),
          url: z.string().describe("Public URL of the application"),
          integration: z.string().optional().describe("oidc, saml, proxy or unknown"),
        }),
      },
      (args) =>
        userMessage(
          `Connect "${args.name}" (${args.url}) to authentik SSO. Integration: ${args.integration ?? "unknown"}.

1. If the app supports OpenID Connect, use provider type oauth2 (preferred). Ask for the exact
   redirect URI(s) from the app's documentation/settings. Use SAML only if OIDC is unsupported.
2. If it has no SSO support, use proxy (forward_single by default) and afterwards add it to the
   embedded outpost with authentik_outposts_add_provider.
3. Ask which groups may access it; pass them as allowedGroups.
4. Call authentik_applications_create_with_provider.
5. Give me the values to paste into the app (client id/secret, issuer/discovery URL, or the
   reverse-proxy snippet) and remind me the client secret is shown only once.
6. Verify with authentik_applications_check_access for one user.`,
        ),
    );
  }

  if (enabled.has("branding") && !env.MCP_READ_ONLY) {
    server.registerPrompt(
      "apply-brand-identity",
      {
        title: "Apply brand identity",
        description: "Snapshot, generate CSS from brand tokens, review the diff and apply",
        argsSchema: z.object({
          brandName: z.string(),
          brand: z.string().optional().describe('Brand domain or "default"'),
          colors: z.string().optional().describe("Hex colours: primary, background, text, ..."),
          typography: z.string().optional(),
          logos: z.string().optional().describe("Light/dark logo URLs"),
          favicon: z.string().optional(),
          loginBackground: z.string().optional(),
          locale: z.string().optional(),
          theme: z.string().optional().describe("automatic, light or dark"),
        }),
      },
      (args) =>
        userMessage(
          `Apply the "${args.brandName}" visual identity to authentik brand "${args.brand ?? "default"}".
Colours: ${args.colors ?? "(ask me)"}
Typography: ${args.typography ?? "(ask me)"}
Logos (light/dark): ${args.logos ?? "(ask me)"}
Favicon: ${args.favicon ?? "(ask me)"}
Login background: ${args.loginBackground ?? "(optional)"}
Locale: ${args.locale ?? "(ask me)"}, default theme: ${args.theme ?? "automatic"}

1. Read authentik://branding/css-guide.
2. authentik_branding_snapshot for the brand and tell me the snapshot id.
3. authentik_branding_apply_design_tokens WITHOUT confirm; show me the contrast report,
   the generated CSS and the diff. If contrast fails, propose the suggested colours.
4. Only after I approve, call it again with confirm: true.
5. authentik_branding_set_theme_defaults for theme/locale (dry-run, then confirm).
6. authentik_branding_preview_urls and remind me to use a private window.`,
        ),
    );
  }
}
