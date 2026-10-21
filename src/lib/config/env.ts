import { z } from "zod";

export const DOMAINS = [
  "users",
  "groups",
  "applications",
  "providers",
  "outposts",
  "flows",
  "flows_admin",
  "events",
  "crypto",
  "policies",
  "sources",
  "rbac",
  "blueprints",
  "system",
  "branding",
] as const;

export type Domain = (typeof DOMAINS)[number];

// flows_admin is opt-in: it must be listed explicitly in MCP_ENABLED_DOMAINS.
const DEFAULT_DOMAINS: Domain[] = DOMAINS.filter((domain) => domain !== "flows_admin");

const csv = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

const apiKeySchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+:.+$/, "each entry must be name:secret")
  .transform((entry) => {
    const separator = entry.indexOf(":");
    return { name: entry.slice(0, separator), secret: entry.slice(separator + 1) };
  })
  .refine((key) => key.secret.length >= 32, "secrets must be at least 32 characters");

const envSchema = z
  .object({
    AUTHENTIK_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, "")),
    AUTHENTIK_TOKEN: z.string().min(1, "is required"),
    MCP_API_KEYS: z
      .string()
      .min(1, "is required")
      .transform(csv)
      .pipe(z.array(apiKeySchema).min(1)),
    MCP_READ_ONLY: booleanString,
    MCP_ENABLED_DOMAINS: z
      .string()
      .optional()
      .transform((value) => (value ? csv(value) : DEFAULT_DOMAINS))
      .pipe(z.array(z.enum(DOMAINS))),
    MCP_BRANDING_MAX_CSS_KB: z.coerce.number().int().positive().default(100),
    MCP_BRANDING_MAX_IMAGE_MB: z.coerce.number().positive().max(25).default(5),
    MCP_BRANDING_ALLOWED_ASSET_HOSTS: z
      .string()
      .default("fonts.googleapis.com,fonts.gstatic.com")
      .transform(csv),
    MCP_MAX_PAGE_ITEMS: z.coerce.number().int().positive().max(1000).default(200),
    AUTHENTIK_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    AUTHENTIK_DEFAULT_AUTH_FLOW: z
      .string()
      .default("default-provider-authorization-implicit-consent"),
    AUTHENTIK_DEFAULT_INVALIDATION_FLOW: z.string().default("default-provider-invalidation-flow"),
    // OAuth 2.1 with authentik as Authorization Server (optional; API keys keep working).
    MCP_OAUTH_ISSUER: z
      .url({ protocol: /^https$/ })
      .optional()
      .describe("Issuer of the authentik OAuth2 provider, e.g. https://auth/application/o/mcp/"),
    MCP_OAUTH_CLIENT_ID: z.string().min(1).optional().describe("Expected token audience"),
    MCP_OAUTH_ALLOWED_GROUPS: z
      .string()
      .optional()
      .transform((value) => (value ? csv(value) : [])),
    MCP_PUBLIC_URL: z
      .url()
      .optional()
      .transform((url) => url?.replace(/\/+$/, ""))
      .describe("Public origin of this server, used as the OAuth resource identifier"),
  })
  .refine((env) => !env.MCP_OAUTH_ISSUER || !!env.MCP_OAUTH_CLIENT_ID, {
    path: ["MCP_OAUTH_CLIENT_ID"],
    message: "is required when MCP_OAUTH_ISSUER is set",
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
    this.name = "EnvError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Messages reference variable names only, never values (they may hold secrets).
    throw new EnvError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`),
    );
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily parsed so `next build` works without runtime secrets. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
