import { describe, expect, it } from "vitest";
import { DOMAINS } from "@/lib/config/env";
import { selectTools } from "@/tools/registry";
import { testEnv } from "./helpers";

describe("tool safety contract", () => {
  it("every destructive or sensitive tool takes a confirm flag", () => {
    const missing = selectTools(testEnv({ MCP_ENABLED_DOMAINS: DOMAINS.join(",") }))
      .filter((tool) => tool.kind === "destructive" || tool.kind === "sensitive")
      .filter((tool) => !("confirm" in tool.input.shape))
      .map((tool) => tool.name);
    expect(missing).toEqual([]);
  });

  it("read-only mode exposes only read tools", () => {
    const kinds = new Set(selectTools(testEnv({ MCP_READ_ONLY: "true" })).map((t) => t.kind));
    expect([...kinds]).toEqual(["read"]);
  });
});
