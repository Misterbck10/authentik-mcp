import DOMPurify from "isomorphic-dompurify";

export type ImageType = "svg" | "png" | "jpg" | "webp" | "ico";

export const MIME: Record<ImageType, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);

/** Detects the image type from magic bytes (never trusts the file name). */
export function detectImageType(bytes: Uint8Array): ImageType | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "ico";
  const head = new TextDecoder().decode(bytes.slice(0, 1024)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return undefined;
}

let hookInstalled = false;

function installHook(): void {
  if (hookInstalled) return;
  // Only same-document references (#id) survive; external/javascript hrefs are dropped.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    for (const attr of ["href", "xlink:href"]) {
      const value = node.getAttribute?.(attr);
      if (value !== null && value !== undefined && !value.startsWith("#"))
        node.removeAttribute(attr);
    }
  });
  hookInstalled = true;
}

/** Removes scripts, event handlers, foreignObject and external references from an SVG. */
export function sanitizeSvg(svg: string): string {
  installHook();
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "iframe", "use"],
  });
}
