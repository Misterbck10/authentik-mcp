import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { designTokens } from "@/lib/branding/css-generator";
import { reviewCss } from "@/lib/branding/css-sanitizer";
import { fetchImage, isPrivateAddress } from "@/lib/branding/files";
import { planRestore, type BrandingSnapshot } from "@/lib/branding/snapshot";
import { blueprintsApply } from "@/tools/blueprints/tools";
import { groupsCreate } from "@/tools/groups/create";
import { groupsAddMembers } from "@/tools/groups/members";
import { policiesGet } from "@/tools/policies/tools";
import { rbacRolesAssignPermissions } from "@/tools/rbac/tools";
import { API, server, testClient, testEnv } from "./helpers";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ctx = () => ({ client: testClient(), env: testEnv(), apiKeyName: "t" });

const ADMINS = "00000000-0000-4000-8000-000000000001";
const CHILD = "00000000-0000-4000-8000-000000000002";
const groups: Record<
  string,
  { pk: string; name: string; is_superuser: boolean; parents: string[] }
> = {
  [ADMINS]: { pk: ADMINS, name: "authentik Admins", is_superuser: true, parents: [] },
  [CHILD]: { pk: CHILD, name: "child-of-admins", is_superuser: false, parents: [ADMINS] },
};

describe("superuser escalation through groups", () => {
  it("refuses a parent that inherits superuser and never posts", async () => {
    let posted = false;
    server.use(
      http.get(`${API}/core/groups/:pk/`, ({ params }) =>
        HttpResponse.json(groups[params.pk as string]),
      ),
      http.post(`${API}/core/groups/`, () => {
        posted = true;
        return HttpResponse.json({});
      }),
    );
    await expect(
      groupsCreate.handler(groupsCreate.input.parse({ name: "helpdesk", parents: [CHILD] }), ctx()),
    ).rejects.toThrow(/grants superuser/);
    expect(posted).toBe(false);
  });

  it("refuses adding members to a group that inherits superuser", async () => {
    server.use(
      http.get(`${API}/core/groups/:pk/`, ({ params }) =>
        HttpResponse.json(groups[params.pk as string]),
      ),
    );
    await expect(
      groupsAddMembers.handler(
        groupsAddMembers.input.parse({ group: CHILD, users: ["ana"] }),
        ctx(),
      ),
    ).rejects.toThrow(/grants superuser/);
  });
});

const snapshot = (overrides: Partial<BrandingSnapshot> = {}): BrandingSnapshot => ({
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  brand: { uuid: "b1", domain: "auth.test", fields: { branding_title: "Old" } as never },
  flows: [{ slug: "login", title: "Login", background: "", compatibility_mode: false }],
  applications: [],
  sources: [{ slug: "plex", type: "plex", icon: "a.png" }],
  ...overrides,
});

describe("branding restore only takes visual fields from the snapshot", () => {
  it("drops non-visual brand/flow keys and keeps the trusted source type", () => {
    const target = snapshot({
      brand: {
        uuid: "b1",
        domain: "auth.test",
        fields: { branding_title: "New", flow_authentication: "evil-flow" } as never,
      },
      flows: [{ slug: "login", title: "Login", authentication: "none" } as never],
      sources: [{ slug: "plex", type: "../../core/users/1", icon: "b.png" }],
    });
    const plan = planRestore(snapshot(), target);
    expect(Object.keys(plan.brand)).toEqual(["branding_title"]);
    expect(plan.flows).toEqual([]);
    expect(plan.sources).toEqual([{ slug: "plex", type: "plex", from: "a.png", to: "b.png" }]);
  });
});

describe("CSS allowlist bypasses", () => {
  const policy = { maxKb: 100, allowedHosts: [], authentikHost: "auth.test" };
  it("rejects escaped schemes and image-set() string URLs", () => {
    expect(reviewCss("body{background:url(\\68ttps://evil.com/x)}", policy).ok).toBe(false);
    expect(
      reviewCss('body{background-image:image-set("https://evil.com/a.png" 1x)}', policy).ok,
    ).toBe(false);
  });

  it("refuses design tokens that would break out of the generated CSS", () => {
    const base = {
      light: { primary: "#000000", background: "#ffffff", surface: "#ffffff", text: "#000000" },
    };
    expect(
      designTokens.safeParse({ ...base, fontFamily: "Inter; } .x { display:none } y {" }).success,
    ).toBe(false);
    expect(
      designTokens.safeParse({ ...base, fontFamily: '"Inter", system-ui, sans-serif' }).success,
    ).toBe(true);
    expect(
      designTokens.safeParse({
        ...base,
        fontUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;700",
      }).success,
    ).toBe(true);
  });
});

describe("image download SSRF guard", () => {
  it("classifies private, metadata and public addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "172.20.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("refuses literal private hosts and non-https before fetching", async () => {
    await expect(fetchImage("https://169.254.169.254/latest/meta-data", 1)).rejects.toThrow(
      /public host/,
    );
    await expect(fetchImage("http://example.com/a.png", 1)).rejects.toThrow(/https/);
  });
});

describe("RBAC permission codenames with digits", () => {
  it("accepts authentik_providers_oauth2 permissions and models", () => {
    expect(
      rbacRolesAssignPermissions.input.safeParse({
        role: "app-admins",
        permissions: ["authentik_providers_oauth2.change_oauth2provider"],
        model: "authentik_providers_oauth2.oauth2provider",
        objectPk: "1",
      }).success,
    ).toBe(true);
  });
});

describe("password expiry policy path", () => {
  it("maps authentik_policies_expiry to /policies/password_expiry/", async () => {
    const pk = "00000000-0000-4000-8000-0000000000aa";
    server.use(
      http.get(`${API}/policies/all/${pk}/`, () =>
        HttpResponse.json({
          pk,
          verbose_name: "Password Expiry Policy",
          meta_model_name: "authentik_policies_expiry.passwordexpirypolicy",
        }),
      ),
      http.get(`${API}/policies/password_expiry/${pk}/`, () => HttpResponse.json({ pk, days: 90 })),
    );
    const result = await policiesGet.handler({ pk }, ctx());
    expect(result).toMatchObject({ policy: { days: 90 } });
  });
});

describe("blueprints_apply waits for the worker result", () => {
  it("reports the new run's status instead of applied: true", async () => {
    const pk = "00000000-0000-4000-8000-0000000000bb";
    let applied = false;
    server.use(
      http.get(`${API}/managed/blueprints/${pk}/`, () =>
        HttpResponse.json(
          applied
            ? { pk, name: "bp", status: "error", last_applied: "2026-02-02T00:00:00Z" }
            : { pk, name: "bp", status: "successful", last_applied: "2026-01-01T00:00:00Z" },
        ),
      ),
      http.post(`${API}/managed/blueprints/${pk}/apply/`, () => {
        applied = true;
        return HttpResponse.json({ pk, name: "bp", status: "successful" });
      }),
    );
    const result = await blueprintsApply.handler({ pk, confirm: true }, ctx());
    expect(result).toMatchObject({ applied: false, blueprint: { status: "error" } });
  });
});

describe("DELETE retried after a lost response", () => {
  it("treats 404 on the retry as already deleted", async () => {
    let attempts = 0;
    server.use(
      http.delete(`${API}/core/tokens/x/`, () => {
        attempts++;
        return attempts === 1
          ? new HttpResponse(null, { status: 504 })
          : new HttpResponse(JSON.stringify({ detail: "Not found." }), { status: 404 });
      }),
    );
    await expect(testClient().deleteObject("/core/tokens/x/")).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("still reports 404 when the first attempt already said so", async () => {
    server.use(http.delete(`${API}/core/tokens/y/`, () => new HttpResponse(null, { status: 404 })));
    await expect(testClient().deleteObject("/core/tokens/y/")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("reports 404 after a 503, which the server did not process", async () => {
    let attempts = 0;
    server.use(
      http.delete(`${API}/core/users/999/`, () =>
        ++attempts === 1
          ? new HttpResponse(null, { status: 503 })
          : new HttpResponse(null, { status: 404 }),
      ),
    );
    await expect(testClient().deleteObject("/core/users/999/")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("plain delete() never hides a 404", async () => {
    let attempts = 0;
    server.use(
      http.delete(`${API}/core/tokens/z/`, () =>
        ++attempts === 1
          ? new HttpResponse(null, { status: 504 })
          : new HttpResponse(null, { status: 404 }),
      ),
    );
    await expect(testClient().delete("/core/tokens/z/")).rejects.toMatchObject({ status: 404 });
  });
});
