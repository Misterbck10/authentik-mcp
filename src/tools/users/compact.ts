import type { Schema } from "@/lib/authentik/types";

/** Compact user view returned to the agent (no avatar blobs, no internal ids beyond pk/uuid). */
export function compactUser(user: Schema<"User">) {
  return {
    pk: user.pk,
    uuid: user.uuid,
    username: user.username,
    name: user.name,
    email: user.email ?? "",
    isActive: user.is_active ?? true,
    isSuperuser: user.is_superuser,
    type: user.type,
    path: user.path,
    lastLogin: user.last_login ?? null,
    dateJoined: user.date_joined,
    groups: user.groups_obj?.map((group) => group.name) ?? [],
    attributes: user.attributes ?? {},
  };
}
