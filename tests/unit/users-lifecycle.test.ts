import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { usersDelete } from "@/tools/users/delete";
import { usersOffboardEmployee } from "@/tools/users/offboard-employee";
import { usersOnboardEmployee } from "@/tools/users/onboard-employee";
import { usersSetPassword } from "@/tools/users/set-password";
import { API, page, server, testClient, testEnv } from "./helpers";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ctx = () => ({ client: testClient(), env: testEnv(), apiKeyName: "t" });

const ana = {
  pk: 7,
  uuid: "00000000-0000-0000-0000-000000000007",
  username: "ana",
  name: "Ana",
  email: "ana@example.com",
  is_active: true,
  is_superuser: false,
  groups_obj: [{ pk: "11111111-1111-1111-1111-111111111111", name: "staff" }],
  attributes: {},
  date_joined: "2026-01-01T00:00:00Z",
};

const noAttributeDefinitions = http.get(`${API}/core/object_attributes/`, () =>
  HttpResponse.json(page([], 0)),
);

describe("destructive tools without confirm", () => {
  it("delete returns a dry-run and never calls DELETE", async () => {
    let deleted = false;
    server.use(
      http.get(`${API}/core/users/7/`, () => HttpResponse.json(ana)),
      http.delete(`${API}/core/users/7/`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const result = await usersDelete.handler(usersDelete.input.parse({ user: 7 }), ctx());
    expect(result).toMatchObject({ dryRun: true });
    expect(deleted).toBe(false);
  });

  it("set_password dry-run does not echo the password", async () => {
    server.use(http.get(`${API}/core/users/7/`, () => HttpResponse.json(ana)));
    const result = await usersSetPassword.handler(
      usersSetPassword.input.parse({ user: 7, password: "super-secret-pw" }),
      ctx(),
    );
    expect(JSON.stringify(result)).not.toContain("super-secret-pw");
  });
});

describe("authentik_users_onboard_employee", () => {
  it("is idempotent when the username already exists", async () => {
    let created = false;
    server.use(
      http.get(`${API}/core/users/`, () => HttpResponse.json(page([ana], 1))),
      http.post(`${API}/core/users/`, () => {
        created = true;
        return HttpResponse.json(ana, { status: 201 });
      }),
    );
    const result = await usersOnboardEmployee.handler(
      usersOnboardEmployee.input.parse({ username: "ana", name: "Ana", email: "ana@example.com" }),
      ctx(),
    );
    expect(result).toMatchObject({ created: false, user: { username: "ana" } });
    expect(created).toBe(false);
  });

  it("rejects missing required attributes before creating anything", async () => {
    let created = false;
    server.use(
      http.get(`${API}/core/users/`, () => HttpResponse.json(page([], 0))),
      http.get(`${API}/core/object_attributes/`, () =>
        HttpResponse.json(
          page([{ key: "costCenter", label: "Cost center", type: "text", is_required: true }], 1),
        ),
      ),
      http.post(`${API}/core/users/`, () => {
        created = true;
        return HttpResponse.json(ana, { status: 201 });
      }),
    );
    await expect(
      usersOnboardEmployee.handler(
        usersOnboardEmployee.input.parse({ username: "bo", name: "Bo", email: "bo@example.com" }),
        ctx(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_attributes",
      fieldErrors: { "attributes.costCenter": ["Cost center is required"] },
    });
    expect(created).toBe(false);
  });

  it("creates the user and emails a password-set link", async () => {
    let body: Record<string, unknown> | undefined;
    let emailed = false;
    server.use(
      noAttributeDefinitions,
      http.get(`${API}/core/users/`, () => HttpResponse.json(page([], 0))),
      http.get(`${API}/core/groups/`, () =>
        HttpResponse.json(page([{ pk: "11111111-1111-1111-1111-111111111111", name: "staff" }], 1)),
      ),
      http.post(`${API}/core/users/`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...ana, pk: 8, username: "bo" }, { status: 201 });
      }),
      http.get(`${API}/stages/email/`, () =>
        HttpResponse.json(page([{ pk: "22222222-2222-2222-2222-222222222222", name: "e" }], 1)),
      ),
      http.post(`${API}/core/users/8/recovery_email/`, () => {
        emailed = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(`${API}/core/users/8/`, () => HttpResponse.json({ ...ana, pk: 8, username: "bo" })),
    );
    const result = await usersOnboardEmployee.handler(
      usersOnboardEmployee.input.parse({
        username: "bo",
        name: "Bo",
        email: "bo@example.com",
        department: "IT",
        groups: ["staff"],
      }),
      ctx(),
    );
    expect(body).toMatchObject({
      attributes: { department: "IT" },
      groups: ["11111111-1111-1111-1111-111111111111"],
    });
    expect(emailed).toBe(true);
    expect(result).toMatchObject({ created: true, passwordSetup: { mode: "email" } });
  });
});

describe("authentik_users_offboard_employee", () => {
  const offboardHandlers = () => [
    http.get(`${API}/core/users/7/`, () => HttpResponse.json(ana)),
    http.get(`${API}/core/tokens/`, () => HttpResponse.json(page([{ identifier: "ana-api" }], 1))),
    http.get(`${API}/core/authenticated_sessions/`, () => HttpResponse.json(page([{}], 2))),
  ];

  it("dry-run lists every step and changes nothing", async () => {
    server.use(...offboardHandlers());
    const result = await usersOffboardEmployee.handler(
      usersOffboardEmployee.input.parse({ user: 7 }),
      ctx(),
    );
    expect(result).toMatchObject({ dryRun: true });
    const steps = (result as { wouldDo: string[] }).wouldDo.join("\n");
    expect(steps).toContain("Deactivate ana");
    expect(steps).toContain("staff");
    expect(steps).toContain("ana-api");
    expect(steps).toContain("2 session");
    expect(steps).not.toContain("delete ana");
  });

  it("deactivates before anything else and does not delete by default", async () => {
    const calls: string[] = [];
    server.use(
      ...offboardHandlers(),
      http.patch(`${API}/core/users/7/`, async ({ request }) => {
        calls.push(`patch ${JSON.stringify(await request.json())}`);
        return HttpResponse.json(ana);
      }),
      http.delete(`${API}/core/tokens/ana-api/`, () => {
        calls.push("delete token");
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(`${API}/core/authenticated_sessions/bulk_delete/`, () => {
        calls.push("revoke sessions");
        return HttpResponse.json({ deleted: 2 });
      }),
    );
    const result = await usersOffboardEmployee.handler(
      usersOffboardEmployee.input.parse({ user: 7, confirm: true }),
      ctx(),
    );
    expect(calls).toEqual([
      'patch {"is_active":false}',
      'patch {"groups":[]}',
      "delete token",
      "revoke sessions",
    ]);
    expect(result).toMatchObject({ offboarded: true, deleted: false, revokedSessions: 2 });
  });
});
