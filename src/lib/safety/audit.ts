import { redact } from "./redact";

export interface AuditEntry {
  apiKeyName: string;
  tool: string;
  args: unknown;
  result: "ok" | "error";
  durationMs: number;
  errorCode?: string;
}

/** Writes one structured JSON line per tool call to stdout (collected by Vercel / Docker logs). */
export function audit(entry: AuditEntry): void {
  const { args, ...rest } = entry;
  console.log(
    JSON.stringify({
      type: "audit",
      timestamp: new Date().toISOString(),
      ...rest,
      argsRedacted: redact(args),
    }),
  );
}
