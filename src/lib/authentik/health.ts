import { getEnv } from "@/lib/config/env";

export type AuthentikHealth = { ok: true; latencyMs: number } | { ok: false; reason: string };

/** Pings authentik's version endpoint. Returns no instance data to callers. */
export async function pingAuthentik(): Promise<AuthentikHealth> {
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
