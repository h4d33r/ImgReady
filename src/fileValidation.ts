import type { SupportedImageType } from "./types";

const mimeToType: Record<string, SupportedImageType> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp"
};

export interface ImageValidationLimits {
  maxDimension: number;
  maxPixels: number;
}

export function normalizeMime(value: string | undefined): string {
  return (value ?? "").split(";", 1)[0].trim().toLowerCase();
}

export function detectImageType(bytes: Uint8Array): SupportedImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 6) {
    const sig = String.fromCharCode(...bytes.slice(0, 6));
    if (sig === "GIF87a" || sig === "GIF89a") return "gif";
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    if (riff === "RIFF" && webp === "WEBP") return "webp";
  }
  return null;
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}
function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}
function u32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);

  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    while (i < bytes.length && bytes[i] === 0xff) i++;
    if (i >= bytes.length) break;

    const marker = bytes[i++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (i + 1 >= bytes.length) return null;

    const length = u16be(bytes, i);
    if (length < 2 || i + length > bytes.length) return null;
    if (sof.has(marker)) {
      if (length < 7) return null;
      const height = u16be(bytes, i + 3);
      const width = u16be(bytes, i + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 20) return null;
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const chunk = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    const data = offset + 8;
    if (size < 0 || data + size > bytes.length) return null;

    if (chunk === "VP8X" && size >= 10 && data + 10 <= bytes.length) {
      return { width: 1 + u24le(bytes, data + 4), height: 1 + u24le(bytes, data + 7) };
    }
    if (chunk === "VP8L" && size >= 5 && data + 5 <= bytes.length && bytes[data] === 0x2f) {
      const b1 = bytes[data + 1], b2 = bytes[data + 2], b3 = bytes[data + 3], b4 = bytes[data + 4];
      return {
        width: 1 + (b1 | ((b2 & 0x3f) << 8)),
        height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10))
      };
    }
    if (chunk === "VP8 " && size >= 10 && data + 10 <= bytes.length) {
      if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null;
      const width = u16le(bytes, data + 6) & 0x3fff;
      const height = u16le(bytes, data + 8) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset = data + size + (size % 2);
  }
  return null;
}

export function getImageDimensions(bytes: Uint8Array, type: SupportedImageType): { width: number; height: number } | null {
  if (type === "png") {
    if (bytes.length < 24 || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (type === "gif") {
    if (bytes.length < 10) return null;
    const width = u16le(bytes, 6);
    const height = u16le(bytes, 8);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (type === "jpeg") return jpegDimensions(bytes);
  if (type === "webp") return webpDimensions(bytes);
  return null;
}

export function validateImagePayload(
  bytes: ArrayBuffer,
  contentType: string | undefined,
  limits: ImageValidationLimits = { maxDimension: 16384, maxPixels: 40_000_000 }
): { type: SupportedImageType; mime: string; width: number; height: number } {
  const mime = normalizeMime(contentType);
  const expected = mimeToType[mime];
  if (!expected) throw new Error(`Unsupported or missing image MIME type: ${mime || "(none)"}.`);

  const view = new Uint8Array(bytes);
  const actual = detectImageType(view);
  if (!actual) throw new Error("Downloaded bytes do not match a supported raster image signature.");
  if (actual !== expected) throw new Error(`MIME/signature mismatch: header says ${mime}, bytes are ${actual}.`);

  const dimensions = getImageDimensions(view, actual);
  if (!dimensions) throw new Error("Could not safely determine image dimensions.");
  if (dimensions.width > limits.maxDimension || dimensions.height > limits.maxDimension) {
    throw new Error(`Image dimensions ${dimensions.width}×${dimensions.height} exceed the configured maximum dimension (${limits.maxDimension}px).`);
  }

  const pixels = dimensions.width * dimensions.height;
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxPixels) {
    throw new Error(`Image dimensions ${dimensions.width}×${dimensions.height} exceed the configured pixel limit.`);
  }

  return { type: actual, mime, ...dimensions };
}

export function extensionFor(type: SupportedImageType): string {
  return type === "jpeg" ? "jpg" : type;
}
