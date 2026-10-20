// Exact secret field names (snake_case and camelCase) plus *password / *secret suffixes.
// Kept narrow on purpose: counters like "deletedTokens" or attribute "key" fields must survive.
const SENSITIVE_KEY =
  /(password|secret)$|^(token|access_?token|refresh_?token|id_?token|api_?key|private_?key|key_?data|credentials?|authorization|cookie)$/i;

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
