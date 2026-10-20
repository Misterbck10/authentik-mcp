import type { AuthentikClient } from "@/lib/authentik/client";
import { listPaginated } from "@/lib/authentik/pagination";
import type { Paginated, Schema } from "@/lib/authentik/types";

export type ObjectAttribute = Schema<"ObjectAttribute">;

/** Enabled object attribute definitions for the user model. */
export async function userAttributeDefinitions(
  client: AuthentikClient,
): Promise<ObjectAttribute[]> {
  const page = await listPaginated<ObjectAttribute>(
    client,
    "/core/object_attributes/",
    { enabled: true, object_type__app_label: "authentik_core", object_type__model: "user" },
    500,
  );
  return page.results;
}

function readPath(source: Record<string, unknown>, key: string): unknown {
  if (key in source) return source[key];
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object") return (value as Record<string, unknown>)[part];
    return undefined;
  }, source);
}

function typeError(definition: ObjectAttribute, value: unknown): string | undefined {
  if (definition.type === "number" && typeof value !== "number") return "must be a number";
  if (definition.type === "boolean" && typeof value !== "boolean") return "must be a boolean";
  if (definition.type === "text" && typeof value !== "string") return "must be text";
  if (definition.regex && typeof value === "string" && !new RegExp(definition.regex).test(value)) {
    return `must match ${definition.regex}`;
  }
  return undefined;
}

/**
 * Validates attributes against authentik object attribute definitions
 * (required, type, regex and uniqueness). Returns per-key errors.
 */
export async function validateUserAttributes(
  client: AuthentikClient,
  attributes: Record<string, unknown>,
  options: { excludeUserPk?: number } = {},
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const definition of await userAttributeDefinitions(client)) {
    const value = readPath(attributes, definition.key);
    if (value === undefined || value === null || value === "") {
      if (definition.is_required) errors[definition.key] = `${definition.label} is required`;
      continue;
    }
    const error = typeError(definition, value);
    if (error) {
      errors[definition.key] = `${definition.label} ${error}`;
      continue;
    }
    if (definition.is_unique) {
      const filter = JSON.stringify({ [definition.key]: value });
      const page = await client.get<Paginated<Schema<"User">>>("/core/users/", {
        attributes: filter,
        page_size: 2,
      });
      if (page.results.some((user) => user.pk !== options.excludeUserPk)) {
        errors[definition.key] = `${definition.label} must be unique (already used)`;
      }
    }
  }
  return errors;
}
