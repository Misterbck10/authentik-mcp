import { setupServer } from "msw/node";
import { AuthentikClient } from "@/lib/authentik/client";
import type { Env } from "@/lib/config/env";
import { parseEnv } from "@/lib/config/env";

export const BASE_URL = "https://auth.test";
export const API = `${BASE_URL}/api/v3`;

export const server = setupServer();

export function testClient(): AuthentikClient {
  return new AuthentikClient({ baseUrl: BASE_URL, token: "t", timeoutMs: 1_000, retryBaseMs: 1 });
}

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    AUTHENTIK_URL: BASE_URL,
    AUTHENTIK_TOKEN: "t",
    MCP_API_KEYS: `test:${"k".repeat(32)}`,
    ...overrides,
  });
}

export function page<T>(results: T[], count: number, next = 0) {
  return {
    pagination: {
      next,
      previous: 0,
      count,
      current: 1,
      total_pages: 1,
      start_index: 1,
      end_index: results.length,
    },
    results,
  };
}
