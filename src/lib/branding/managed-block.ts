export const BLOCK_START = "/* mcp:start */";
export const BLOCK_END = "/* mcp:end */";

export interface SplitCss {
  /** CSS outside the managed block (written by humans). */
  manual: string;
  /** CSS inside the managed block, without the markers, or null if there is none. */
  managed: string | null;
}

export function splitManagedCss(css: string): SplitCss {
  const start = css.indexOf(BLOCK_START);
  const end = css.indexOf(BLOCK_END, start + BLOCK_START.length);
  if (start === -1 || end === -1) return { manual: css.trim(), managed: null };
  const before = css.slice(0, start);
  const after = css.slice(end + BLOCK_END.length);
  return {
    manual: `${before.trimEnd()}\n${after.trimStart()}`.trim(),
    managed: css.slice(start + BLOCK_START.length, end).trim(),
  };
}

/**
 * replace: the managed block is replaced (manual CSS kept).
 * append:  new CSS is added to the end of the managed block.
 * The managed block is always placed after manual CSS so it wins the cascade.
 */
export function mergeManagedCss(current: string, css: string, mode: "replace" | "append"): string {
  const { manual, managed } = splitManagedCss(current);
  const block = mode === "append" && managed ? `${managed}\n\n${css.trim()}` : css.trim();
  return [manual, `${BLOCK_START}\n${block}\n${BLOCK_END}`].filter(Boolean).join("\n\n") + "\n";
}
