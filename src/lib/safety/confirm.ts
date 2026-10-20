import { z } from "zod";

export const confirmField = z
  .boolean()
  .optional()
  .describe("Must be true to apply. Without it the tool returns a dry-run of what would happen.");

export interface DryRun {
  dryRun: true;
  wouldDo: string[];
  details?: unknown;
  warnings?: string[];
  hint: string;
}

export function dryRun(wouldDo: string[], details?: unknown, warnings?: string[]): DryRun {
  return {
    dryRun: true,
    wouldDo,
    ...(details === undefined ? {} : { details }),
    ...(warnings?.length ? { warnings } : {}),
    hint: "Nothing was changed. Call the tool again with confirm: true to apply.",
  };
}
