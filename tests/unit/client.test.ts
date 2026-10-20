import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AuthentikError } from "@/lib/authentik/errors";
import { listPaginated } from "@/lib/authentik/pagination";
import { API, page, server, testClient } from "./helpers";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("AuthentikClient", () => {
  it("sends bearer auth and repeated array query params", async () => {
    let seen: URL | undefined;
    let auth: string | null = null;
    server.use(
      http.get(`${API}/core/users/`, ({ request }) => {
        seen = new URL(request.url);
        auth = request.headers.get("authorization");
        return HttpResponse.json(page([], 0));
      }),
    );
    await testClient().get("/core/users/", {
      groups_by_name: ["a", "b"],
      is_active: true,
      x: undefined,
    });
    expect(auth).toBe("Bearer t");
    expect(seen?.searchParams.getAll("groups_by_name")).toEqual(["a", "b"]);
    expect(seen?.searchParams.get("is_active")).toBe("true");
    expect(seen?.searchParams.has("x")).toBe(false);
  });

  it("retries idempotent requests on 503", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/x/`, () => {
        calls++;
        return calls < 3 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({ ok: 1 });
      }),
    );
    await expect(testClient().get("/x/")).resolves.toEqual({ ok: 1 });
    expect(calls).toBe(3);
  });

  it("never retries POST", async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/x/`, () => {
        calls++;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    await expect(testClient().post("/x/", {})).rejects.toBeInstanceOf(AuthentikError);
    expect(calls).toBe(1);
  });

  it("normalises field validation errors", async () => {
    server.use(
      http.post(`${API}/core/users/`, () =>
        HttpResponse.json({ username: ["This field must be unique."] }, { status: 400 }),
      ),
    );
    const error = await testClient()
      .post("/core/users/", {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthentikError);
    expect((error as AuthentikError).toJSON()).toEqual({
      status: 400,
      code: "validation_error",
      message: "username: This field must be unique.",
      fieldErrors: { username: ["This field must be unique."] },
    });
  });

  it("maps detail-only errors", async () => {
    server.use(
      http.get(`${API}/x/`, () => HttpResponse.json({ detail: "Not found." }, { status: 404 })),
    );
    await expect(testClient().get("/x/")).rejects.toMatchObject({
      code: "not_found",
      message: "Not found.",
    });
  });
});

describe("listPaginated", () => {
  it("follows pages and stops at the limit", async () => {
    server.use(
      http.get(`${API}/items/`, ({ request }) => {
        const pageNumber = Number(new URL(request.url).searchParams.get("page"));
        const items = [1, 2].map((n) => ({ id: (pageNumber - 1) * 2 + n }));
        return HttpResponse.json(page(items, 6, pageNumber < 3 ? pageNumber + 1 : 0));
      }),
    );
    const result = await listPaginated<{ id: number }>(testClient(), "/items/", {}, 2);
    expect(result.results.map((item) => item.id)).toEqual([1, 2]);
    expect(result).toMatchObject({ total: 6, truncated: true });
  });
});
