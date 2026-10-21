import { describe, expect, it } from "vitest";
import { REDACTED, redact } from "@/lib/safety/redact";

describe("redact", () => {
  it("masks sensitive keys at any depth without mutating input", () => {
    const input = {
      username: "ana",
      password: "p",
      provider: { client_id: "id", client_secret: "s", nested: [{ private_key: "k" }] },
      token: null,
    };
    expect(redact(input)).toEqual({
      username: "ana",
      password: REDACTED,
      provider: { client_id: "id", client_secret: REDACTED, nested: [{ private_key: REDACTED }] },
      token: null,
    });
    expect(input.password).toBe("p");
  });
});

describe("redact scope", () => {
  it("keeps non-secret fields that merely mention tokens or keys", () => {
    const input = { key: "locale", deletedTokens: 2, revokeTokens: true, clientSecret: "s" };
    expect(redact(input)).toEqual({
      key: "locale",
      deletedTokens: 2,
      revokeTokens: true,
      clientSecret: REDACTED,
    });
  });

  it("masks credential fields ending in _token / Token", () => {
    const input = { slug: "plex", plex_token: "t", sessionToken: "t", deletedTokens: 3 };
    expect(redact(input)).toEqual({
      slug: "plex",
      plex_token: REDACTED,
      sessionToken: REDACTED,
      deletedTokens: 3,
    });
  });
});
