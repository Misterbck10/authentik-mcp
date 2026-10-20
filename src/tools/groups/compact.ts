import type { Schema } from "@/lib/authentik/types";

export function compactGroup(group: Schema<"Group">) {
  return {
    pk: group.pk,
    name: group.name,
    isSuperuser: group.is_superuser ?? false,
    parents: group.parents_obj?.map((parent) => parent.name) ?? [],
    children: group.children_obj?.map((child) => child.name) ?? [],
    memberCount: group.users?.length,
    roles: group.roles_obj?.map((role) => role.name) ?? [],
    attributes: group.attributes ?? {},
  };
}
