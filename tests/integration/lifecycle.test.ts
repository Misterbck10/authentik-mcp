/**
 * End-to-end against a disposable authentik (docker-compose.test.yml).
 * Run with: pnpm test:integration   (tear down: pnpm test:integration:down)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { AuthentikClient } from "@/lib/authentik/client";
import { parseEnv } from "@/lib/config/env";
import { applicationsCheckAccess, applicationsDelete } from "@/tools/applications/crud";
import { applicationsCreateWithProvider } from "@/tools/applications/create-with-provider";
import { brandsGet } from "@/tools/branding/brands";
import { applyDesignTokens } from "@/tools/branding/css";
import { brandingRestore, brandingSnapshot } from "@/tools/branding/snapshots";
import type { AnyToolDefinition } from "@/tools/define-tool";
import { groupsCreate } from "@/tools/groups/create";
import { groupsDelete } from "@/tools/groups/delete";
import { usersOffboardEmployee } from "@/tools/users/offboard-employee";
import { usersOnboardEmployee } from "@/tools/users/onboard-employee";

const BASE_URL = process.env.INTEGRATION_AUTHENTIK_URL ?? "http://localhost:9000";
const TOKEN =
  process.env.INTEGRATION_AUTHENTIK_TOKEN ?? "integration-bootstrap-token-0123456789abcdef";

const env = parseEnv({
  AUTHENTIK_URL: BASE_URL,
  AUTHENTIK_TOKEN: TOKEN,
  MCP_API_KEYS: `integration:${"i".repeat(32)}`,
});
const client = new AuthentikClient({ baseUrl: BASE_URL, token: TOKEN, timeoutMs: 30_000 });
const ctx = { client, env, apiKeyName: "integration" };

const run = <T = Record<string, unknown>>(tool: AnyToolDefinition, args: Record<string, unknown>) =>
  tool.handler(tool.input.parse(args), ctx) as Promise<T>;

async function waitForAuthentik(): Promise<void> {
  const deadline = Date.now() + 280_000;
  while (Date.now() < deadline) {
    try {
      await client.get("/core/users/me/");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw new Error(`authentik at ${BASE_URL} did not become ready`);
}

const suffix = Date.now().toString(36);
const groupName = `it-group-${suffix}`;
const username = `it-user-${suffix}`;
const appSlug = `it-app-${suffix}`;

beforeAll(waitForAuthentik);

describe("onboard → OIDC app → check_access → offboard", () => {
  it("runs the full employee + SSO lifecycle", async () => {
    await run(groupsCreate, { name: groupName });

    const onboard = await run(usersOnboardEmployee, {
      username,
      name: "Integration User",
      email: `${username}@example.test`,
      department: "QA",
      groups: [groupName],
      passwordSetup: "none",
    });
    expect(onboard).toMatchObject({ created: true, user: { username, groups: [groupName] } });

    const again = await run(usersOnboardEmployee, {
      username,
      name: "Integration User",
      email: `${username}@example.test`,
      passwordSetup: "none",
    });
    expect(again).toMatchObject({ created: false });

    const app = await run(applicationsCreateWithProvider, {
      name: `Integration ${suffix}`,
      slug: appSlug,
      provider: { type: "oauth2", redirectUris: [{ url: "https://app.example.test/callback" }] },
      allowedGroups: [groupName],
    });
    expect(app).toMatchObject({ created: true, connection: { clientId: expect.any(String) } });
    expect(String((app.connection as { discoveryUrl: string }).discoveryUrl)).toMatch(
      /\/application\/o\/.+\/\.well-known\/openid-configuration$/,
    );
    expect(app.clientSecret).toEqual(expect.any(String));

    expect(await run(applicationsCheckAccess, { slug: appSlug, user: username })).toMatchObject({
      passing: true,
    });

    const dry = await run(usersOffboardEmployee, { user: username });
    expect(dry).toMatchObject({ dryRun: true });

    const offboard = await run(usersOffboardEmployee, {
      user: username,
      deleteUser: true,
      confirm: true,
    });
    expect(offboard).toMatchObject({ offboarded: true, deleted: true, removedGroups: [groupName] });

    await run(applicationsDelete, { slug: appSlug, deleteProvider: true, confirm: true });
    await run(groupsDelete, { group: groupName, confirm: true });
  });
});

describe("branding snapshot → apply → restore", () => {
  it("restores the brand to its original state", async () => {
    const before = await run<{ title: string; customCss: unknown }>(brandsGet, {
      brand: "default",
    });
    const snapshot = await run<{ id: string; storedIn: string; snapshot?: unknown }>(
      brandingSnapshot,
      {
        brand: "default",
      },
    );

    const applied = await run(applyDesignTokens, {
      brand: "default",
      title: `Integration ${suffix}`,
      tokens: {
        light: { primary: "#0b5fff", background: "#f5f7fa", surface: "#ffffff", text: "#1a1a1a" },
      },
      confirm: true,
    });
    expect(applied).toMatchObject({ applied: true });
    const during = await run<{ title: string; customCss: { hasManagedBlock: boolean } }>(
      brandsGet,
      {
        brand: "default",
      },
    );
    expect(during).toMatchObject({
      title: `Integration ${suffix}`,
      customCss: { hasManagedBlock: true },
    });

    const restoreArgs =
      snapshot.storedIn === "files" ? { id: snapshot.id } : { snapshot: snapshot.snapshot };
    expect(await run(brandingRestore, restoreArgs)).toMatchObject({ dryRun: true });
    expect(await run(brandingRestore, { ...restoreArgs, confirm: true })).toMatchObject({
      restored: true,
    });

    const after = await run<{ title: string; customCss: unknown }>(brandsGet, { brand: "default" });
    expect(after.title).toBe(before.title);
    expect(after.customCss).toEqual(before.customCss);
  });
});
