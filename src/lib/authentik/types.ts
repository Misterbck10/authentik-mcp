import type { components } from "./schema";

/** Shorthand for authentik OpenAPI schema objects, e.g. `Schema<"User">`. */
export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

export type Pagination = Schema<"Pagination">;

export interface Paginated<T> {
  pagination: Pagination;
  results: T[];
}
