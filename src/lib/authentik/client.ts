import { getEnv } from "@/lib/config/env";
import { AuthentikError, networkError, normalizeError } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type QueryValue =
  string | number | boolean | undefined | null | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
}

export interface ClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  maxRetries?: number;
  retryBaseMs?: number;
}

const IDEMPOTENT: ReadonlySet<HttpMethod> = new Set(["GET", "PUT", "DELETE"]);
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 502, 503, 504]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function buildQuery(query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((item) => params.append(key, String(item)));
    else params.append(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Typed-by-caller HTTP client for authentik's /api/v3. Never logs tokens or bodies. */
export class AuthentikClient {
  private readonly apiBase: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(private readonly config: ClientConfig) {
    this.apiBase = `${config.baseUrl.replace(/\/+$/, "")}/api/v3`;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 250;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  /** multipart/form-data POST (file uploads). Never retried. */
  async upload<T>(path: string, form: FormData): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.apiBase}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.token}`, Accept: "application/json" },
        body: form,
        signal: AbortSignal.timeout(this.config.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      throw networkError(timedOut ? "timeout" : "unreachable");
    }
    if (!response.ok) throw normalizeError(response.status, await parseBody(response));
    return (await parseBody(response)) as T;
  }

  delete<T = void>(path: string, query?: Query): Promise<T> {
    return this.request<T>("DELETE", path, { query });
  }

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.apiBase}${path.startsWith("/") ? path : `/${path}`}${buildQuery(options.query)}`;
    const attempts = IDEMPOTENT.has(method) ? this.maxRetries + 1 : 1;

    // Set once an attempt may have reached the server without us seeing the response.
    let maybeApplied = false;
    for (let attempt = 1; ; attempt++) {
      const isLast = attempt >= attempts;
      let response: Response;
      try {
        response = await this.send(method, url, options.body);
      } catch (error) {
        if (!isLast) {
          maybeApplied = true;
          await this.backoff(attempt);
          continue;
        }
        const timedOut = error instanceof DOMException && error.name === "TimeoutError";
        throw networkError(timedOut ? "timeout" : "unreachable");
      }

      if (response.ok) return (await parseBody(response)) as T;
      // A retried DELETE that finds nothing means an earlier attempt already deleted it.
      if (method === "DELETE" && response.status === 404 && maybeApplied) return undefined as T;
      if (!isLast && RETRYABLE_STATUS.has(response.status)) {
        if (response.status !== 429) maybeApplied = true;
        await this.backoff(attempt, response.headers.get("retry-after"));
        continue;
      }
      throw normalizeError(response.status, await parseBody(response));
    }
  }

  private send(method: HttpMethod, url: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
      cache: "no-store",
    });
  }

  private backoff(attempt: number, retryAfter?: string | null): Promise<void> {
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
    const exponential = this.retryBaseMs * 2 ** (attempt - 1);
    return sleep(Number.isFinite(retryAfterMs) ? Math.min(retryAfterMs, 5_000) : exponential);
  }
}

let shared: AuthentikClient | undefined;

export function getAuthentikClient(): AuthentikClient {
  if (!shared) {
    const env = getEnv();
    shared = new AuthentikClient({
      baseUrl: env.AUTHENTIK_URL,
      token: env.AUTHENTIK_TOKEN,
      timeoutMs: env.AUTHENTIK_TIMEOUT_MS,
    });
  }
  return shared;
}

export { AuthentikError };
