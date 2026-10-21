import { z } from "zod";
import type { AuthentikClient } from "@/lib/authentik/client";
import { AuthentikError } from "@/lib/authentik/errors";
import { listPaginated } from "@/lib/authentik/pagination";
import { isUuid, resolveGroup } from "@/lib/authentik/resolve";
import type { Paginated, Schema } from "@/lib/authentik/types";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { groupRef } from "@/lib/validation";
import { defineTool } from "../define-tool";

type Role = Schema<"Role">;

const roleRef = z.string().min(1).max(200).describe("Role uuid or exact name");

async function resolveRole(client: AuthentikClient, ref: string): Promise<Role> {
  if (isUuid(ref)) return client.get<Role>(`/rbac/roles/${ref}/`);
  const page = await client.get<Paginated<Role>>("/rbac/roles/", { name: ref, page_size: 2 });
  const role = page.results[0];
  if (!role)
    throw new AuthentikError({ status: 404, code: "not_found", message: `Role not found: ${ref}` });
  return role;
}

async function rolePermissions(client: AuthentikClient, rolePk: string) {
  const page = await listPaginated<Schema<"Permission">>(
    client,
    "/rbac/permissions/",
    { role: rolePk },
    1000,
  );
  return page.results.map((p) => `${p.app_label}.${p.codename}`);
}

const ROLE_CONCURRENCY = 5;

export const rbacRolesList = defineTool({
  name: "authentik_rbac_roles_list",
  domain: "rbac",
  kind: "read",
  title: "List roles",
  description: "List RBAC roles, optionally with their global permissions.",
  input: z.object({
    search: z.string().max(200).optional(),
    includePermissions: z.boolean().default(false),
  }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Role>(
      client,
      "/rbac/roles/",
      { search: args.search, ordering: "name" },
      env.MCP_MAX_PAGE_ITEMS,
    );
    // At most ROLE_CONCURRENCY permission lookups in flight, instead of one per role at once.
    const roles = [];
    for (let i = 0; i < page.results.length; i += ROLE_CONCURRENCY) {
      roles.push(
        ...(await Promise.all(
          page.results.slice(i, i + ROLE_CONCURRENCY).map(async (role) => ({
            pk: role.pk,
            name: role.name,
            ...(args.includePermissions
              ? { permissions: await rolePermissions(client, role.pk) }
              : {}),
          })),
        )),
      );
    }
    return { total: page.total, roles };
  },
});

export const rbacPermissionsList = defineTool({
  name: "authentik_rbac_permissions_list",
  domain: "rbac",
  kind: "read",
  title: "Find permissions",
  description:
    'Search available permission codenames (format "app_label.codename", e.g. ' +
    '"authentik_core.view_user") to use with roles_assign_permissions.',
  input: z.object({
    search: z.string().max(200).optional(),
    appLabel: z.string().max(100).optional().describe('e.g. "authentik_core"'),
    model: z.string().max(100).optional().describe('e.g. "user", "group", "application"'),
  }),
  handler: async (args, { client }) => {
    const page = await listPaginated<Schema<"Permission">>(
      client,
      "/rbac/permissions/",
      {
        search: args.search,
        content_type__app_label: args.appLabel,
        content_type__model: args.model,
      },
      200,
    );
    return {
      total: page.total,
      truncated: page.truncated,
      permissions: page.results.map((p) => ({
        codename: `${p.app_label}.${p.codename}`,
        name: p.name,
      })),
    };
  },
});

export const rbacRolesCreate = defineTool({
  name: "authentik_rbac_roles_create",
  domain: "rbac",
  kind: "write",
  title: "Create role",
  description: "Create an empty RBAC role. Add permissions with roles_assign_permissions.",
  input: z.object({ name: z.string().min(1).max(150) }),
  handler: async ({ name }, { client }) => {
    const role = await client.post<Role>("/rbac/roles/", { name } satisfies Schema<"RoleRequest">);
    return { created: true, role: { pk: role.pk, name: role.name } };
  },
});

export const rbacRolesAssignPermissions = defineTool({
  name: "authentik_rbac_roles_assign_permissions",
  domain: "rbac",
  kind: "destructive",
  title: "Grant permissions to role",
  description:
    "Grant permissions to a role, globally or on one object (model + objectPk). Granting " +
    "permissions is a privilege change; requires confirm: true.",
  input: z.object({
    role: roleRef,
    permissions: z
      .array(z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/, 'use "app_label.codename"'))
      .min(1)
      .max(200),
    model: z
      .string()
      .regex(/^[a-z0-9_]+\.[a-z0-9_]+$/)
      .optional()
      .describe('Object-level: model as "app_label.model", e.g. "authentik_core.application"'),
    objectPk: z.string().max(100).optional(),
    confirm: confirmField,
  }),
  handler: async (args, { client }) => {
    if (!!args.model !== !!args.objectPk) {
      throw new AuthentikError({
        status: 400,
        code: "validation_error",
        message: "model and objectPk must be provided together",
      });
    }
    const role = await resolveRole(client, args.role);
    const scope = args.model ? `on ${args.model} ${args.objectPk}` : "globally";
    if (!args.confirm) {
      return dryRun(
        [`Grant ${args.permissions.length} permission(s) to role ${role.name} ${scope}`],
        args.permissions,
      );
    }
    await client.post(`/rbac/permissions/assigned_by_roles/${role.pk}/assign/`, {
      permissions: args.permissions,
      model: args.model as Schema<"PermissionAssignRequest">["model"],
      object_pk: args.objectPk,
    });
    return { granted: args.permissions, role: role.name, scope };
  },
});

export const rbacRolesAssignToGroup = defineTool({
  name: "authentik_rbac_roles_assign_to_group",
  domain: "rbac",
  kind: "destructive",
  idempotent: true,
  title: "Assign role to group",
  description:
    "Give a role to a group so all members inherit its permissions. Privilege change; requires " +
    "confirm: true.",
  input: z.object({ role: roleRef, group: groupRef, confirm: confirmField }),
  handler: async (args, { client }) => {
    const [role, group] = await Promise.all([
      resolveRole(client, args.role),
      resolveGroup(client, args.group),
    ]);
    const roles = group.roles ?? [];
    if (roles.includes(role.pk)) return { changed: false, role: role.name, group: group.name };
    if (!args.confirm) return dryRun([`Assign role ${role.name} to group ${group.name}`]);
    await client.patch(`/core/groups/${group.pk}/`, { roles: [...roles, role.pk] });
    return { changed: true, role: role.name, group: group.name };
  },
});

export const rbacTools = [
  rbacRolesList,
  rbacPermissionsList,
  rbacRolesCreate,
  rbacRolesAssignPermissions,
  rbacRolesAssignToGroup,
];
