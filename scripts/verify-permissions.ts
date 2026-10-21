/**
 * Verifies that a token has the permissions the MCP tools need (and nothing sensitive extra).
 * Usage: pnpm verify:permissions [envFile]   (default .env.production.local)
 * Creates and deletes temporary "mcp-permcheck-*" objects. Never prints the token.
 */
import { readFileSync } from "node:fs";
import { AuthentikClient } from "../src/lib/authentik/client";
import { parseEnv } from "../src/lib/config/env";
import type { AnyToolDefinition } from "../src/tools/define-tool";
import { ALL_TOOLS } from "../src/tools/registry";

const file = process.argv[2] ?? ".env.production.local";
const vars = Object.fromEntries(
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
const env = parseEnv({ MCP_API_KEYS: `check:${"x".repeat(32)}`, ...vars });
// maxRetries: 0 so a failing check never multiplies requests.
const client = new AuthentikClient({
  baseUrl: env.AUTHENTIK_URL,
  token: env.AUTHENTIK_TOKEN,
  timeoutMs: 30_000,
  maxRetries: 0,
});
const ctx = { client, env, apiKeyName: "permcheck" };
const tool = (name: string): AnyToolDefinition => {
  const found = ALL_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`unknown tool ${name}`);
  return found;
};

let failures = 0;
async function check(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  try {
    const t = tool(name);
    const result = await t.handler(t.input.parse(args), ctx);
    console.log(`ok    ${name}`);
    return result;
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

async function mustBeDenied(label: string, path: string): Promise<void> {
  try {
    const result = await client.get<{ results?: unknown[] }>(path);
    const leaked = Array.isArray(result.results) ? result.results.length : 1;
    if (leaked > 0) {
      failures++;
      console.log(`FAIL  ${label}: accessible`);
    } else console.log(`ok    ${label}: not visible`);
  } catch {
    console.log(`ok    ${label}: denied`);
  }
}

const reads: [string, Record<string, unknown>?][] = [
  ["authentik_users_list"],
  ["authentik_users_get", { user: "akadmin" }],
  ["authentik_users_attribute_definitions"],
  ["authentik_users_list_sessions", { user: "akadmin" }],
  ["authentik_groups_list"],
  ["authentik_applications_list"],
  ["authentik_providers_list"],
  ["authentik_outposts_list"],
  ["authentik_outposts_health", { outpost: "embedded" }],
  ["authentik_flows_list"],
  ["authentik_flows_get", { slug: "default-authentication-flow" }],
  ["authentik_stages_list"],
  ["authentik_invitations_list"],
  ["authentik_events_list", { limit: 5 }],
  ["authentik_events_audit_user_activity", { user: "akadmin", days: 3 }],
  ["authentik_policies_list"],
  ["authentik_crypto_list"],
  ["authentik_crypto_expiring"],
  ["authentik_sources_list"],
  ["authentik_rbac_roles_list"],
  ["authentik_rbac_permissions_list", { model: "user" }],
  ["authentik_blueprints_list"],
  ["authentik_blueprints_available"],
  ["authentik_system_version"],
  ["authentik_system_info"],
  ["authentik_system_workers_status"],
  ["authentik_system_tasks_list"],
  ["authentik_system_settings_get"],
  ["authentik_branding_brands_list"],
  ["authentik_branding_get_effective_css", { brand: "default" }],
  ["authentik_branding_files_list"],
  ["authentik_branding_prompt_fields_list"],
  ["authentik_branding_email_templates"],
];

/**
 * One request first: a bad token would otherwise produce dozens of 401/403s in a row,
 * which reverse-proxy bouncers (CrowdSec, fail2ban) treat as an attack and ban the IP.
 */
async function preflight(): Promise<void> {
  try {
    await client.get("/core/users/me/");
  } catch (error) {
    console.log(`Token rejected (${error instanceof Error ? error.message : error}). Stopping.`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  await preflight();
  console.log(`Checking ${env.AUTHENTIK_URL} with token from ${file}\n-- reads`);
  for (const [name, args] of reads) await check(name, args);

  console.log("-- write cycle (temporary objects)");
  const id = `mcp-permcheck-${Date.now().toString(36)}`;
  await check("authentik_groups_create", { name: id });
  await check("authentik_users_onboard_employee", {
    username: id,
    name: "Permission check",
    email: `${id}@example.invalid`,
    groups: [id],
    passwordSetup: "link",
  });
  await check("authentik_applications_create_with_provider", {
    name: id,
    slug: id,
    allowedGroups: [id],
    provider: { type: "oauth2", redirectUris: [{ url: "https://permcheck.example.invalid/cb" }] },
  });
  await check("authentik_applications_check_access", { slug: id, user: id });
  await check("authentik_branding_snapshot", { brand: "default" });
  await check("authentik_users_offboard_employee", { user: id, deleteUser: true, confirm: true });
  await check("authentik_applications_delete", { slug: id, deleteProvider: true, confirm: true });
  await check("authentik_groups_delete", { group: id, confirm: true });

  console.log("-- must stay inaccessible");
  await mustBeDenied("OAuth access tokens", "/oauth2/access_tokens/");
  await mustBeDenied("OAuth refresh tokens", "/oauth2/refresh_tokens/");
  await mustBeDenied("WebAuthn devices", "/authenticators/admin/webauthn/");
  await mustBeDenied("TOTP devices", "/authenticators/admin/totp/");

  console.log(failures ? `\n${failures} problem(s)` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main();
