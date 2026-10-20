import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applicationsCreateWithProvider } from "@/tools/applications/create-with-provider";
import { applicationsUnbind } from "@/tools/applications/bindings";
import { providersGet, providersUpdate } from "@/tools/providers/tools";
import { API, page, server, testClient, testEnv } from "./helpers";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ctx = () => ({ client: testClient(), env: testEnv(), apiKeyName: "t" });

const FLOW_PK = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CERT_PK = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const GROUP_PK = "11111111-1111-1111-1111-111111111111";

const oauthProvider = {
  pk: 5,
  name: "Provider for Wiki",
  meta_model_name: "authentik_providers_oauth2.oauth2provider",
  client_type: "confidential",
  client_id: "cid",
  client_secret: "csecret",
  redirect_uris: [{ url: "https://wiki.example.com/cb", matching_mode: "strict" }],
};

function createHandlers(onPut: (body: Record<string, unknown>) => void) {
  let created = false;
  return [
    http.get(`${API}/core/applications/wiki/`, () =>
      created
        ? HttpResponse.json({ pk: "p", pbm_uuid: "b", slug: "wiki", name: "Wiki", provider: 5 })
        : HttpResponse.json({ detail: "Not found." }, { status: 404 }),
    ),
    http.get(`${API}/flows/instances/:slug/`, () => HttpResponse.json({ pk: FLOW_PK })),
    http.get(`${API}/propertymappings/provider/scope/`, () =>
      HttpResponse.json(
        page(
          ["openid", "email", "profile"].map((scope) => ({ pk: `pm-${scope}`, scope_name: scope })),
          3,
        ),
      ),
    ),
    http.get(`${API}/crypto/certificatekeypairs/`, () =>
      HttpResponse.json(page([{ pk: CERT_PK }], 1)),
    ),
    http.get(`${API}/core/groups/`, () =>
      HttpResponse.json(page([{ pk: GROUP_PK, name: "engineering" }], 1)),
    ),
    http.put(`${API}/core/transactional/applications/`, async ({ request }) => {
      onPut((await request.json()) as Record<string, unknown>);
      created = true;
      return HttpResponse.json({ applied: true, logs: [] });
    }),
    http.get(`${API}/providers/all/5/`, () => HttpResponse.json(oauthProvider)),
    http.get(`${API}/providers/oauth2/5/`, () => HttpResponse.json(oauthProvider)),
    http.get(`${API}/providers/oauth2/5/setup_urls/`, () =>
      HttpResponse.json({ issuer: "https://auth.test/application/o/wiki/" }),
    ),
  ];
}

describe("authentik_applications_create_with_provider", () => {
  it("creates OIDC app atomically and returns connection details once", async () => {
    let body: Record<string, unknown> = {};
    server.use(...createHandlers((value) => (body = value)));
    const result = await applicationsCreateWithProvider.handler(
      applicationsCreateWithProvider.input.parse({
        name: "Wiki",
        slug: "wiki",
        provider: { type: "oauth2", redirectUris: [{ url: "https://wiki.example.com/cb" }] },
        allowedGroups: ["engineering"],
      }),
      ctx(),
    );
    expect(body).toMatchObject({
      provider_model: "authentik_providers_oauth2.oauth2provider",
      app: { slug: "wiki", name: "Wiki" },
      provider: {
        authorization_flow: FLOW_PK,
        invalidation_flow: FLOW_PK,
        client_type: "confidential",
        signing_key: CERT_PK,
        property_mappings: ["pm-openid", "pm-email", "pm-profile"],
        redirect_uris: [{ url: "https://wiki.example.com/cb", matching_mode: "strict" }],
      },
      policy_bindings: [{ group: GROUP_PK, order: 0 }],
    });
    expect(result).toMatchObject({
      created: true,
      clientSecret: "csecret",
      connection: {
        clientId: "cid",
        discoveryUrl: "https://auth.test/application/o/wiki/.well-known/openid-configuration",
      },
      accessRestrictedTo: ["engineering"],
    });
    expect(applicationsCreateWithProvider.returnsNewSecret).toBe(true);
  });

  it("rejects insecure strict redirect URIs but allows localhost", async () => {
    server.use(...createHandlers(() => undefined));
    await expect(
      applicationsCreateWithProvider.handler(
        applicationsCreateWithProvider.input.parse({
          name: "Wiki",
          slug: "wiki",
          provider: { type: "oauth2", redirectUris: [{ url: "http://wiki.example.com/cb" }] },
        }),
        ctx(),
      ),
    ).rejects.toThrow(/https/);
  });

  it("rejects bad slugs and proxy without internal host", async () => {
    expect(
      applicationsCreateWithProvider.input.safeParse({
        name: "x",
        slug: "bad slug!",
        provider: { type: "rac" },
      }).success,
    ).toBe(false);
    server.use(...createHandlers(() => undefined));
    await expect(
      applicationsCreateWithProvider.handler(
        applicationsCreateWithProvider.input.parse({
          name: "Wiki",
          slug: "wiki",
          provider: { type: "proxy", mode: "proxy", externalHost: "https://wiki.example.com" },
        }),
        ctx(),
      ),
    ).rejects.toMatchObject({ fieldErrors: { internalHost: ["required for mode 'proxy'"] } });
  });
});

describe("providers", () => {
  it("get never returns client_secret", async () => {
    server.use(
      http.get(`${API}/providers/all/5/`, () => HttpResponse.json(oauthProvider)),
      http.get(`${API}/providers/oauth2/5/`, () => HttpResponse.json(oauthProvider)),
      http.get(`${API}/providers/oauth2/5/setup_urls/`, () =>
        HttpResponse.json({ issuer: "https://auth.test/application/o/wiki/" }),
      ),
    );
    const result = await providersGet.handler({ pk: 5 }, ctx());
    expect(JSON.stringify(result)).not.toContain("csecret");
  });

  it("update refuses secret fields", async () => {
    await expect(
      providersUpdate.handler({ pk: 5, changes: { client_secret: "x" } }, ctx()),
    ).rejects.toMatchObject({ code: "secret_field" });
  });
});

describe("authentik_applications_unbind", () => {
  it("warns when removing the last binding and does nothing without confirm", async () => {
    server.use(
      http.get(`${API}/core/applications/wiki/`, () =>
        HttpResponse.json({ slug: "wiki", pbm_uuid: "target-1" }),
      ),
      http.get(`${API}/policies/bindings/:pk/`, () =>
        HttpResponse.json({ pk: "b1", target: "target-1", order: 0 }),
      ),
      http.get(`${API}/policies/bindings/`, () => HttpResponse.json(page([{}], 1))),
    );
    const result = await applicationsUnbind.handler(
      applicationsUnbind.input.parse({
        slug: "wiki",
        binding: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      }),
      ctx(),
    );
    expect(result).toMatchObject({ dryRun: true });
    expect(JSON.stringify(result)).toContain("open to all users");
  });
});
