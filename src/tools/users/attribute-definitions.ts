import { z } from "zod";
import { defineTool } from "../define-tool";
import { userAttributeDefinitions } from "./attributes";

export const usersAttributeDefinitions = defineTool({
  name: "authentik_users_attribute_definitions",
  domain: "users",
  kind: "read",
  title: "List user attribute definitions",
  description:
    "List the object attributes defined for users (key, label, type, required, unique, regex). " +
    "Check these before creating or onboarding users so required attributes are provided.",
  input: z.object({}),
  handler: async (_args, { client }) =>
    (await userAttributeDefinitions(client)).map((definition) => ({
      key: definition.key,
      label: definition.label,
      type: definition.type,
      required: definition.is_required ?? false,
      unique: definition.is_unique ?? false,
      regex: definition.regex || undefined,
      group: definition.group || undefined,
    })),
});
