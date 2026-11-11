import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { crc32 } from "node:zlib";
import { IMAGE_LIMITS, ImageError, inspectImage } from "./image";

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** A real, decodable solid-colour PNG. */
function makePng(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeJpegHeader(w: number, h: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

function makeWebpVp8x(w: number, h: number): Buffer {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(22, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}

describe("inspectImage", () => {
  it("reads PNG, JPEG and WebP dimensions from content", () => {
    expect(inspectImage(makePng(120, 40))).toEqual({ contentType: "image/png", ext: "png", width: 120, height: 40 });
    expect(inspectImage(makeJpegHeader(640, 480))).toEqual({ contentType: "image/jpeg", ext: "jpg", width: 640, height: 480 });
    expect(inspectImage(makeWebpVp8x(300, 200))).toEqual({ contentType: "image/webp", ext: "webp", width: 300, height: 200 });
  });

  it("rejects SVG, HTML and other content regardless of name", () => {
    expect(() => inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toThrow(ImageError);
    expect(() => inspectImage(Buffer.from("<html><body>hi</body></html>"))).toThrow(/PNG, JPEG or WebP/);
    expect(() => inspectImage(Buffer.from("GIF89a\x01\x00\x01\x00"))).toThrow(ImageError);
  });

  it("enforces size and dimension limits", () => {
    expect(() => inspectImage(Buffer.alloc(0))).toThrow(/empty/);
    expect(() => inspectImage(Buffer.concat([makePng(20, 20), Buffer.alloc(IMAGE_LIMITS.maxBytes)]))).toThrow(/1 MB/);
    expect(() => inspectImage(makePng(8, 8))).toThrow(/at least/);
    expect(() => inspectImage(makeJpegHeader(5000, 100))).toThrow(/at most/);
  });

  it("rejects truncated or malformed headers", () => {
    expect(() => inspectImage(makePng(50, 50).subarray(0, 20))).toThrow(ImageError);
    expect(() => inspectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow(ImageError);
  });
});
