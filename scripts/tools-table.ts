/**
 * Prints the README tool table from the registry, so docs never drift from code.
 * Usage: pnpm docs:tools
 */
import { ALL_TOOLS } from "../src/tools/registry";

const KIND_LABEL = {
  read: "read",
  write: "write",
  destructive: "write · destructive (confirm)",
  sensitive: "sensitive (confirm)",
} as const;

const rows = ALL_TOOLS.map(
  (tool) => `| ${tool.domain} | \`${tool.name}\` | ${KIND_LABEL[tool.kind]} | ${tool.title} |`,
);
console.log(["| Domain | Tool | Type | Purpose |", "|---|---|---|---|", ...rows].join("\n"));
console.error(`${ALL_TOOLS.length} tools`);
