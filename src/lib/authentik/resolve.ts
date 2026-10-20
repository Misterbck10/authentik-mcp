import type { AuthentikClient } from "./client";
import { AuthentikError } from "./errors";
import type { Paginated, Schema } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = (what: string, ref: string | number) =>
  new AuthentikError({ status: 404, code: "not_found", message: `${what} not found: ${ref}` });

const ambiguous = (what: string, ref: string) =>
  new AuthentikError({
    status: 409,
    code: "ambiguous",
    message: `More than one ${what} matches "${ref}". Use the pk/uuid instead.`,
  });

export const isUuid = (value: string): boolean => UUID_RE.test(value);

async function findOne<T>(
  client: AuthentikClient,
  path: string,
  query: Record<string, string | boolean>,
  what: string,
  ref: string,
): Promise<T | undefined> {
  const page = await client.get<Paginated<T>>(path, { ...query, page_size: 2 });
  if (page.results.length > 1) throw ambiguous(what, ref);
  return page.results[0];
}

/** Resolves a user by pk, username or email (exact match). */
export async function resolveUser(
  client: AuthentikClient,
  ref: string | number,
): Promise<Schema<"User">> {
  if (typeof ref === "number" || /^\d+$/.test(ref)) {
    return client.get<Schema<"User">>(`/core/users/${ref}/`, { include_groups: true });
  }
  const field = ref.includes("@") ? "email" : "username";
  const user = await findOne<Schema<"User">>(
    client,
    "/core/users/",
    { [field]: ref, include_groups: true },
    "user",
    ref,
  );
  if (!user) throw notFound("User", ref);
  return user;
}

/** Resolves a group by uuid or exact name. */
export async function resolveGroup(
  client: AuthentikClient,
  ref: string,
  options: { includeUsers?: boolean } = {},
): Promise<Schema<"Group">> {
  const include_users = options.includeUsers ?? false;
  if (isUuid(ref)) return client.get<Schema<"Group">>(`/core/groups/${ref}/`, { include_users });
  const group = await findOne<Schema<"Group">>(
    client,
    "/core/groups/",
    { name: ref, include_users },
    "group",
    ref,
  );
  if (!group) throw notFound("Group", ref);
  return group;
}

/** Resolves a flow by slug (or uuid) and returns its pk. */
export async function resolveFlowPk(client: AuthentikClient, ref: string): Promise<string> {
  if (isUuid(ref)) return ref;
  const flow = await client
    .get<Schema<"Flow">>(`/flows/instances/${encodeURIComponent(ref)}/`)
    .catch((error: unknown) => {
      if (error instanceof AuthentikError && error.status === 404) throw notFound("Flow", ref);
      throw error;
    });
  return flow.pk;
}

/** Resolves a certificate-key pair by uuid or exact name. */
export async function resolveCertificatePk(client: AuthentikClient, ref: string): Promise<string> {
  if (isUuid(ref)) return ref;
  const cert = await findOne<Schema<"CertificateKeyPair">>(
    client,
    "/crypto/certificatekeypairs/",
    { name: ref },
    "certificate",
    ref,
  );
  if (!cert) throw notFound("Certificate", ref);
  return cert.pk;
}

/** Resolves an application by slug. */
export async function resolveApplication(
  client: AuthentikClient,
  slugRef: string,
): Promise<Schema<"Application">> {
  return client
    .get<Schema<"Application">>(`/core/applications/${encodeURIComponent(slugRef)}/`)
    .catch((error: unknown) => {
      if (error instanceof AuthentikError && error.status === 404) {
        throw notFound("Application", slugRef);
      }
      throw error;
    });
}
