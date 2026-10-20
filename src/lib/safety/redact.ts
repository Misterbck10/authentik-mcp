const SENSITIVE_KEY =
  /pass(word)?|secret|private[_-]?key|key_data|token|credential|^key$|authorization/i;

export const REDACTED = "[REDACTED]";

/** Deep-copies `value`, replacing values of sensitive keys. */
export function redact<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) && inner != null ? REDACTED : redactValue(inner);
  }
  return output;
}
