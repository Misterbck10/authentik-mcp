import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cryptoExpiring } from "@/tools/crypto/tools";
import { eventsList } from "@/tools/events/tools";
import { invitationsCreate } from "@/tools/flows/tools";
import { rbacRolesAssignPermissions } from "@/tools/rbac/tools";
import { selectTools } from "@/tools/registry";
import { systemInfo, systemSettingsUpdate } from "@/tools/system/tools";
import { API, BASE_URL, page, server, testClient, testEnv } from "./helpers";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ctx = () => ({ client: testClient(), env: testEnv(), apiKeyName: "t" });
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("authentik_events_list", () => {
  it("applies the date window client-side and stops paging past `since`", async () => {
    const pagesRequested: number[] = [];
    const events = [1, 2, 3, 4].map((n) => ({
      pk: `e${n}`,
      action: "login",
      app: "authentik.events",
      created: daysFromNow(-n),
    }));
    server.use(
      http.get(`${API}/events/events/`, ({ request }) => {
        const pageNumber = Number(new URL(request.url).searchParams.get("page"));
        pagesRequested.push(pageNumber);
        return HttpResponse.json(
          page(
            events.slice((pageNumber - 1) * 2, pageNumber * 2),
            4,
            pageNumber < 2 ? pageNumber + 1 : 0,
          ),
        );
      }),
    );
    const result = await eventsList.handler(
      eventsList.input.parse({ since: daysFromNow(-2.5), until: daysFromNow(-1.5) }),
      ctx(),
    );
    expect((result as { events: { pk: string }[] }).events.map((e) => e.pk)).toEqual(["e2"]);
    expect(pagesRequested).toEqual([1, 2]);
  });
});

describe("authentik_crypto_expiring", () => {
  it("returns only certificates expiring within the window, soonest first", async () => {
    server.use(
      http.get(`${API}/crypto/certificatekeypairs/`, () =>
        HttpResponse.json(
          page(
            [
              { pk: "a", name: "later", cert_expiry: daysFromNow(400) },
              { pk: "b", name: "soon", cert_expiry: daysFromNow(10) },
              { pk: "c", name: "expired", cert_expiry: daysFromNow(-3) },
            ],
            3,
          ),
        ),
      ),
    );
    const result = (await cryptoExpiring.handler({ days: 30 }, ctx())) as {
      certificates: { name: string }[];
    };
    expect(result.certificates.map((c) => c.name)).toEqual(["expired", "soon"]);
  });
});

describe("authentik_system_settings_update", () => {
  it("dry-run shows a from/to diff and does not patch", async () => {
    let patched = false;
    server.use(
      http.get(`${API}/admin/settings/`, () => HttpResponse.json({ base_url: "https://old.test" })),
      http.patch(`${API}/admin/settings/`, () => {
        patched = true;
        return HttpResponse.json({});
      }),
    );
    const result = await systemSettingsUpdate.handler(
      systemSettingsUpdate.input.parse({ baseUrl: "https://new.test" }),
      ctx(),
    );
    expect(result).toMatchObject({
      dryRun: true,
      details: { base_url: { from: "https://old.test", to: "https://new.test" } },
    });
    expect(patched).toBe(false);
  });

  it("rejects non-https base URLs", () => {
    expect(systemSettingsUpdate.input.safeParse({ baseUrl: "http://auth.test" }).success).toBe(
      false,
    );
  });
});

describe("authentik_system_info", () => {
  it("never returns request headers", async () => {
    server.use(
      http.get(`${API}/admin/system/`, () =>
        HttpResponse.json({ http_headers: { HTTP_AUTHORIZATION: "Bearer x" }, base_url: BASE_URL }),
      ),
    );
    expect(JSON.stringify(await systemInfo.handler({}, ctx()))).not.toContain("Bearer");
  });
});

describe("authentik_rbac_roles_assign_permissions", () => {
  it("requires confirm and validates codenames", async () => {
    expect(
      rbacRolesAssignPermissions.input.safeParse({ role: "r", permissions: ["view_user"] }).success,
    ).toBe(false);
    server.use(
      http.get(`${API}/rbac/roles/`, () =>
        HttpResponse.json(page([{ pk: "r1", name: "helpdesk" }], 1)),
      ),
    );
    const result = await rbacRolesAssignPermissions.handler(
      rbacRolesAssignPermissions.input.parse({
        role: "helpdesk",
        permissions: ["authentik_core.view_user"],
      }),
      ctx(),
    );
    expect(result).toMatchObject({ dryRun: true });
  });
});

describe("authentik_invitations_create", () => {
  it("returns a usable enrollment link", async () => {
    server.use(
      http.get(`${API}/flows/instances/enroll/`, () =>
        HttpResponse.json({ pk: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      ),
      http.post(`${API}/stages/invitation/invitations/`, () =>
        HttpResponse.json(
          { pk: "inv1", name: "new-hire", flow_obj: { slug: "enroll" } },
          { status: 201 },
        ),
      ),
    );
    const result = await invitationsCreate.handler(
      invitationsCreate.input.parse({ name: "new-hire", flow: "enroll" }),
      ctx(),
    );
    expect(result).toMatchObject({
      invitation: { link: `${BASE_URL}/if/flow/enroll/?itoken=inv1` },
    });
  });
});

describe("domain gating", () => {
  it("keeps flows_admin tools off unless the domain is enabled", () => {
    const names = (env: ReturnType<typeof testEnv>) => selectTools(env).map((t) => t.name);
    expect(names(testEnv())).not.toContain("authentik_flows_bindings_create");
    expect(names(testEnv({ MCP_ENABLED_DOMAINS: "flows,flows_admin" }))).toContain(
      "authentik_flows_bindings_create",
    );
  });

  it("every tool name is unique and follows the naming convention", () => {
    const all = selectTools(
      testEnv({
        MCP_ENABLED_DOMAINS:
          "users,groups,applications,providers,outposts,flows,flows_admin,events,crypto,policies,sources,rbac,blueprints,system",
      }),
    );
    const names = all.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => /^authentik_[a-z_]+$/.test(name))).toBe(true);
  });
});
