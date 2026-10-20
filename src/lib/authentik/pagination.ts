import type { AuthentikClient, Query } from "./client";
import type { Paginated } from "./types";

export interface PageResult<T> {
  results: T[];
  /** Total matching objects reported by authentik. */
  total: number;
  /** True when more objects exist than were returned. */
  truncated: boolean;
}

const PAGE_SIZE = 100;

/** Fetches pages until `limit` items are collected or results run out. */
export async function listPaginated<T>(
  client: AuthentikClient,
  path: string,
  query: Query,
  limit: number,
): Promise<PageResult<T>> {
  const results: T[] = [];
  let total = 0;
  const pageSize = Math.min(PAGE_SIZE, limit);

  for (let page = 1; results.length < limit; page++) {
    const response = await client.get<Paginated<T>>(path, { ...query, page, page_size: pageSize });
    total = response.pagination.count;
    results.push(...response.results.slice(0, limit - results.length));
    if (!response.pagination.next || response.results.length === 0) break;
  }

  return { results, total, truncated: total > results.length };
}
