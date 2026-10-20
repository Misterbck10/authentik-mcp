import { z } from "zod";
import { resolveGroup } from "@/lib/authentik/resolve";
import { groupRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { compactGroup } from "./compact";

export const groupsGet = defineTool({
  name: "authentik_groups_get",
  domain: "groups",
  kind: "read",
  title: "Get group",
  description: "Get one group by name or uuid.",
  input: z.object({ group: groupRef }),
  handler: async ({ group }, { client }) =>
    compactGroup(await resolveGroup(client, group, { includeUsers: true })),
});
