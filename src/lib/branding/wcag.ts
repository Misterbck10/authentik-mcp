/** WCAG 2.x contrast helpers for hex colours (#rgb or #rrggbb). */

export const AA_NORMAL = 4.5;

export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const value = hex.replace(/^#/, "");
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Invalid hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/**
 * Moves `color` towards black or white (whichever increases contrast against `against`)
 * until the target ratio is met. Returns the closest passing colour.
 */
export function suggestAccessible(color: string, against: string, target = AA_NORMAL): string {
  const base = parseHex(color);
  const towards: Rgb = luminance(against) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let step = 0; step <= 100; step++) {
    const t = step / 100;
    const candidate = toHex(base.map((c, i) => c + (towards[i]! - c) * t) as Rgb);
    if (contrastRatio(candidate, against) >= target) return candidate;
  }
  return toHex(towards);
}

/** Picks black or white text for a background colour. */
export function readableTextOn(background: string): string {
  return contrastRatio("#ffffff", background) >= contrastRatio("#000000", background)
    ? "#ffffff"
    : "#000000";
}

export interface ContrastCheck {
  pair: string;
  foreground: string;
  background: string;
  ratio: number;
  passes: boolean;
  suggestion?: string;
}

export function checkPair(pair: string, foreground: string, background: string): ContrastCheck {
  const ratio = contrastRatio(foreground, background);
  const passes = ratio >= AA_NORMAL;
  return {
    pair,
    foreground,
    background,
    ratio,
    passes,
    ...(passes ? {} : { suggestion: suggestAccessible(foreground, background) }),
  };
}
