// Image validation by content, not by the declared type or file name.
// Accepted: PNG, JPEG, WebP. SVG is rejected on purpose: it can carry scripts, and many email clients don't show it.

export type ImageType = "image/png" | "image/jpeg" | "image/webp";

export interface ImageInfo {
  contentType: ImageType;
  ext: "png" | "jpg" | "webp";
  width: number;
  height: number;
}

export const IMAGE_LIMITS = { maxBytes: 1024 * 1024, minPx: 16, maxPx: 4096 };

export class ImageError extends Error {}

function png(b: Buffer): ImageInfo | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v) || b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { contentType: "image/png", ext: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpeg(b: Buffer): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame header
    const len = b.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { contentType: "image/jpeg", ext: "jpg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

function webp(b: Buffer): ImageInfo | null {
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = b.toString("ascii", 12, 16);
  const base = { contentType: "image/webp" as const, ext: "webp" as const };
  if (chunk === "VP8X") return { ...base, width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { ...base, width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { ...base, width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return null;
}

/** Identify and validate an uploaded image. Throws ImageError with a user-facing message. */
export function inspectImage(bytes: Buffer): ImageInfo {
  if (bytes.length === 0) throw new ImageError("The file is empty.");
  if (bytes.length > IMAGE_LIMITS.maxBytes) throw new ImageError("Images must be 1 MB or smaller.");
  const info = png(bytes) ?? jpeg(bytes) ?? webp(bytes);
  if (!info) throw new ImageError("Use a PNG, JPEG or WebP image.");
  const { minPx, maxPx } = IMAGE_LIMITS;
  if (info.width < minPx || info.height < minPx) throw new ImageError(`Images must be at least ${minPx}×${minPx} pixels.`);
  if (info.width > maxPx || info.height > maxPx) throw new ImageError(`Images must be at most ${maxPx}×${maxPx} pixels.`);
  return info;
}
