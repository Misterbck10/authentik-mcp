import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { selectTools } from "@/tools/registry";
import { usersList } from "@/tools/users/list";
import { API, page, server, testClient, testEnv } from "./helpers";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const user = {
  pk: 1,
  uuid: "00000000-0000-0000-0000-000000000001",
  username: "ana",
  name: "Ana",
  email: "ana@example.com",
  is_active: true,
  is_superuser: false,
  groups_obj: [{ name: "staff" }],
  avatar: "data:image/png;base64,AAAA",
  attributes: { department: "IT" },
  date_joined: "2026-01-01T00:00:00Z",
  type: "internal",
};

describe("authentik_users_list", () => {
  it("returns a compact, capped list", async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get(`${API}/core/users/`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(page([user], 1));
      }),
    );
    const ctx = {
      client: testClient(),
      env: testEnv({ MCP_MAX_PAGE_ITEMS: "10" }),
      apiKeyName: "t",
    };
    const result = await usersList.handler(
      usersList.input.parse({ group: "staff", limit: 500 }),
      ctx,
    );

    expect(query?.get("page_size")).toBe("10");
    expect(query?.getAll("groups_by_name")).toEqual(["staff"]);
    expect(result).toMatchObject({ total: 1, returned: 1, truncated: false });
    const [compact] = (result as { users: Record<string, unknown>[] }).users;
    expect(compact).toMatchObject({ username: "ana", groups: ["staff"], isActive: true });
    expect(compact).not.toHaveProperty("avatar");
  });

  it("rejects invalid input", () => {
    expect(usersList.input.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(usersList.input.safeParse({ limit: -1 }).success).toBe(false);
  });
});

describe("selectTools", () => {
  it("filters by domain", () => {
    expect(selectTools(testEnv({ MCP_ENABLED_DOMAINS: "groups" }))).toHaveLength(0);
    expect(selectTools(testEnv({ MCP_READ_ONLY: "true" })).map((t) => t.name)).toContain(
      "authentik_users_list",
    );
  });
});
