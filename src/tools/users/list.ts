import { z } from "zod";
import { listPaginated } from "@/lib/authentik/pagination";
import type { Schema } from "@/lib/authentik/types";
import { defineTool } from "../define-tool";
import { compactUser } from "./compact";

export const usersList = defineTool({
  name: "authentik_users_list",
  domain: "users",
  kind: "read",
  title: "List users",
  description:
    "List authentik users with optional filters. Returns a compact view (username, name, email, " +
    "active flag, groups, attributes) plus the total count. Use `search` for free text across " +
    "username/name/email. Results are capped by the server limit; `truncated` tells you if more exist.",
  input: z.object({
    search: z.string().max(200).optional().describe("Free-text search on username, name and email"),
    email: z.email().optional().describe("Exact email match"),
    username: z.string().max(150).optional().describe("Exact username match"),
    isActive: z.boolean().optional().describe("Filter by active / deactivated"),
    group: z.string().max(200).optional().describe("Only members of the group with this name"),
    type: z
      .enum(["internal", "external", "service_account", "internal_service_account"])
      .optional()
      .describe("User type"),
    limit: z.number().int().positive().optional().describe("Max users to return (server-capped)"),
  }),
  handler: async (args, { client, env }) => {
    const limit = Math.min(args.limit ?? 50, env.MCP_MAX_PAGE_ITEMS);
    const page = await listPaginated<Schema<"User">>(
      client,
      "/core/users/",
      {
        search: args.search,
        email: args.email,
        username: args.username,
        is_active: args.isActive,
        groups_by_name: args.group ? [args.group] : undefined,
        type: args.type ? [args.type] : undefined,
        include_groups: true,
        include_roles: false,
        ordering: "username",
      },
      limit,
    );
    return {
      total: page.total,
      returned: page.results.length,
      truncated: page.truncated,
      users: page.results.map(compactUser),
    };
  },
});
