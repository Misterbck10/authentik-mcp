import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { brandsDelete } from "@/tools/branding/brands";
import { applyDesignTokens, setCustomCss } from "@/tools/branding/css";
import { setThemeDefaults } from "@/tools/branding/theme";
import { API, page, server, testClient, testEnv } from "./helpers";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ctx = () => ({ client: testClient(), env: testEnv(), apiKeyName: "t" });

const BRAND_UUID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const brand = {
  brand_uuid: BRAND_UUID,
  domain: "authentik-default",
  default: true,
  branding_title: "authentik",
  branding_custom_css: ".mine { color: red; }",
  attributes: { settings: { navbar: { userDisplay: "name" } } },
};

function brandHandlers(onPatch?: (body: Record<string, unknown>) => void) {
  return [
    http.get(`${API}/core/brands/`, () => HttpResponse.json(page([brand], 1))),
    http.get(`${API}/core/brands/${BRAND_UUID}/`, () => HttpResponse.json(brand)),
    http.patch(`${API}/core/brands/${BRAND_UUID}/`, async ({ request }) => {
      onPatch?.((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(brand);
    }),
    // snapshot sources
    http.get(`${API}/flows/instances/`, () => HttpResponse.json(page([], 0))),
    http.get(`${API}/core/applications/`, () => HttpResponse.json(page([], 0))),
    http.get(`${API}/sources/all/`, () => HttpResponse.json(page([], 0))),
    http.post(`${API}/admin/file/`, () => HttpResponse.json({})),
    http.get(`${API}/admin/file/`, () => HttpResponse.json([])),
  ];
}

const goodTokens = {
  light: { primary: "#0b5fff", background: "#f5f7fa", surface: "#ffffff", text: "#1a1a1a" },
};

describe("authentik_branding_apply_design_tokens", () => {
  it("dry-run returns CSS and contrast report without patching", async () => {
    let patched = false;
    server.use(...brandHandlers(() => (patched = true)));
    const result = await applyDesignTokens.handler(
      applyDesignTokens.input.parse({ brand: "default", tokens: goodTokens }),
      ctx(),
    );
    expect(result).toMatchObject({ dryRun: true });
    expect(JSON.stringify(result)).toContain("--pf-global--primary-color--100");
    expect(JSON.stringify(result)).toContain("DEFAULT brand");
    expect(patched).toBe(false);
  });

  it("blocks apply when contrast fails, even with confirm", async () => {
    let patched = false;
    server.use(...brandHandlers(() => (patched = true)));
    const result = await applyDesignTokens.handler(
      applyDesignTokens.input.parse({
        brand: "default",
        tokens: { light: { ...goodTokens.light, text: "#cccccc" } },
        confirm: true,
      }),
      ctx(),
    );
    expect(result).toMatchObject({ blocked: true });
    expect(patched).toBe(false);
  });

  it("applies with confirm, keeps manual CSS and snapshots first", async () => {
    const calls: string[] = [];
    let body: Record<string, unknown> = {};
    server.use(
      // Listed first: msw uses the first matching handler.
      http.post(`${API}/admin/file/`, () => {
        calls.push("snapshot");
        return HttpResponse.json({});
      }),
      ...brandHandlers((value) => {
        calls.push("patch");
        body = value;
      }),
    );
    const result = await applyDesignTokens.handler(
      applyDesignTokens.input.parse({
        brand: "default",
        tokens: goodTokens,
        title: "Acme",
        confirm: true,
      }),
      ctx(),
    );
    expect(calls).toEqual(["snapshot", "patch"]);
    expect(String(body.branding_custom_css)).toMatch(
      /^\.mine \{ color: red; \}[\s\S]*\/\* mcp:start \*\//,
    );
    expect(body.branding_title).toBe("Acme");
    expect(result).toMatchObject({ applied: true, snapshot: { storedIn: "files" } });
  });
});

describe("authentik_branding_set_custom_css", () => {
  it("blocks hiding security UI without acknowledgement", async () => {
    server.use(...brandHandlers());
    const result = await setCustomCss.handler(
      setCustomCss.input.parse({
        brand: "default",
        css: ".pf-c-alert { display: none; }",
        confirm: true,
      }),
      ctx(),
    );
    expect(result).toMatchObject({ blocked: true });
  });

  it("rejects forbidden CSS outright", async () => {
    server.use(...brandHandlers());
    await expect(
      setCustomCss.handler(
        setCustomCss.input.parse({
          brand: "default",
          css: "a { background: url(javascript:alert(1)) }",
        }),
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "invalid_css" });
  });
});

describe("authentik_branding_set_theme_defaults", () => {
  it("merges theme and locale into existing attributes", async () => {
    let body: Record<string, unknown> = {};
    server.use(...brandHandlers((value) => (body = value)));
    await setThemeDefaults.handler(
      setThemeDefaults.input.parse({
        brand: "default",
        theme: "dark",
        locale: "pt",
        confirm: true,
      }),
      ctx(),
    );
    expect(body.attributes).toEqual({
      settings: { navbar: { userDisplay: "name" }, theme: { base: "dark" }, locale: "pt" },
    });
  });
});

describe("authentik_branding_brands_delete", () => {
  it("never deletes the default brand", async () => {
    server.use(...brandHandlers());
    await expect(
      brandsDelete.handler(brandsDelete.input.parse({ brand: "default", confirm: true }), ctx()),
    ).rejects.toMatchObject({ code: "default_brand" });
  });
});
