import { getEnv } from "@/lib/config/env";

export type AuthentikHealth = { ok: true; latencyMs: number } | { ok: false; reason: string };

// /api/health and the landing page are public; caching keeps anonymous traffic from turning
// into admin-token requests against authentik (rate limits, reputation/IP bans).
const CACHE_MS = 30_000;
let cached: { at: number; result: Promise<AuthentikHealth> } | undefined;

/** Pings authentik's version endpoint (cached for 30 s). Returns no instance data to callers. */
export function pingAuthentik(): Promise<AuthentikHealth> {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), result: ping() };
  }
  return cached.result;
}

async function ping(): Promise<AuthentikHealth> {
  const env = getEnv();
  const started = Date.now();
  try {
    const response = await fetch(`${env.AUTHENTIK_URL}/api/v3/admin/version/`, {
      headers: { Authorization: `Bearer ${env.AUTHENTIK_TOKEN}`, Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, reason: `authentik responded ${response.status}` };
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, reason: timedOut ? "authentik timed out" : "authentik unreachable" };
  }
}
