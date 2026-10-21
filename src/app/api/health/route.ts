import { NextResponse } from "next/server";
import { pingAuthentik } from "@/lib/authentik/health";
import { EnvError, getEnv } from "@/lib/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    getEnv();
  } catch (error) {
    if (error instanceof EnvError) console.error(error.message);
    return NextResponse.json({ status: "error", reason: "invalid configuration" }, { status: 503 });
  }
  const authentik = await pingAuthentik();
  // Public endpoint: report up/down only, not latency or failure details.
  return NextResponse.json(
    { status: authentik.ok ? "ok" : "degraded" },
    { status: authentik.ok ? 200 : 503 },
  );
}
