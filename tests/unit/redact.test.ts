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
