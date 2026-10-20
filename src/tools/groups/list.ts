import { z } from "zod";
import { listPaginated } from "@/lib/authentik/pagination";
import type { Schema } from "@/lib/authentik/types";
import { defineTool } from "../define-tool";
import { compactGroup } from "./compact";

export const groupsList = defineTool({
  name: "authentik_groups_list",
  domain: "groups",
  kind: "read",
  title: "List groups",
  description:
    "List groups with parents, children, roles and member counts. Filter by search or member.",
  input: z.object({
    search: z.string().max(200).optional(),
    member: z.string().max(150).optional().describe("Only groups this username belongs to"),
    isSuperuser: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
  }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<Schema<"Group">>(
      client,
      "/core/groups/",
      {
        search: args.search,
        members_by_username: args.member ? [args.member] : undefined,
        is_superuser: args.isSuperuser,
        include_users: true,
        include_parents: true,
        include_children: true,
        ordering: "name",
      },
      Math.min(args.limit ?? 100, env.MCP_MAX_PAGE_ITEMS),
    );
    return { total: page.total, truncated: page.truncated, groups: page.results.map(compactGroup) };
  },
});
