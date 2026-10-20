/** Normalised authentik API error, safe to show to the agent. */
export class AuthentikError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string[]>;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
  }) {
    super(params.message);
    this.name = "AuthentikError";
    this.status = params.status;
    this.code = params.code;
    this.fieldErrors = params.fieldErrors ?? {};
  }

  toJSON(): {
    status: number;
    code: string;
    message: string;
    fieldErrors: Record<string, string[]>;
  } {
    return {
      status: this.status,
      code: this.code,
      message: this.message,
      fieldErrors: this.fieldErrors,
    };
  }
}

const STATUS_CODES: Record<number, string> = {
  400: "validation_error",
  401: "unauthenticated",
  403: "permission_denied",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  429: "rate_limited",
};

const toMessages = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(toMessages);
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(toMessages);
  return [];
};

/** Maps authentik's per-field validation payload (`{field: [msg]}`) into `fieldErrors`. */
function extractFieldErrors(body: Record<string, unknown>): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const [field, value] of Object.entries(body)) {
    if (field === "detail" || field === "code") continue;
    const messages = toMessages(value);
    if (messages.length > 0) fieldErrors[field] = messages;
  }
  return fieldErrors;
}

export function normalizeError(status: number, body: unknown): AuthentikError {
  const code = STATUS_CODES[status] ?? (status >= 500 ? "server_error" : "http_error");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return new AuthentikError({ status, code, message: `authentik responded ${status}` });
  }
  const record = body as Record<string, unknown>;
  const fieldErrors = extractFieldErrors(record);
  const detail = typeof record.detail === "string" ? record.detail : undefined;
  const summary = Object.entries(fieldErrors)
    .map(([field, messages]) => `${field}: ${messages.join(" ")}`)
    .join("; ");
  return new AuthentikError({
    status,
    code: typeof record.code === "string" ? record.code : code,
    message: detail ?? (summary || `authentik responded ${status}`),
    fieldErrors,
  });
}

export function networkError(reason: "timeout" | "unreachable"): AuthentikError {
  return new AuthentikError({
    status: 0,
    code: reason,
    message:
      reason === "timeout" ? "authentik did not respond in time" : "authentik is unreachable",
  });
}
