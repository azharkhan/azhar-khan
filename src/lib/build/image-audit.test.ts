import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditImages, metadataIn } from "./image-audit.mjs";

let temporary = "";
let dist = "";
let source = "";

beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), "image-audit-"));
  dist = join(temporary, "dist");
  source = join(temporary, "src");
  await mkdir(dist, { recursive: true });
  await mkdir(source, { recursive: true });
});

afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const length = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, marker, length >> 8, length & 0xff]), payload]);
}

function jpeg(payload?: Buffer): Buffer {
  const app0 = jpegSegment(0xe0, Buffer.from("JFIF\0", "ascii"));
  const app1 = payload ? jpegSegment(0xe1, payload) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, app1, Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])]);
}

function webpChunk(name: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(name, "ascii"), size, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function webp(...chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF", "ascii"), size, body]);
}

function pngChunk(name: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(name, "ascii"), data, Buffer.alloc(4)]);
}

function png(...chunks: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

describe("metadataIn", () => {
  it("detects JPEG APP1 EXIF and XMP and accepts a clean JFIF image", () => {
    expect(metadataIn(jpeg(Buffer.from("Exif\0\0TIFF", "binary")), ".jpg")).toEqual(["EXIF"]);
    expect(metadataIn(jpeg(Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0"), Buffer.from("<x:xmpmeta/>") ])), ".jpg")).toEqual(["XMP"]);
    expect(metadataIn(jpeg(), ".jpeg")).toEqual([]);
  });

  it("detects WebP metadata chunks and VP8X metadata flags", () => {
    expect(metadataIn(webp(webpChunk("EXIF", Buffer.from("payload"))), ".webp")).toEqual(["EXIF"]);
    expect(metadataIn(webp(webpChunk("XMP ", Buffer.from("payload"))), ".webp")).toEqual(["XMP"]);
    expect(metadataIn(webp(webpChunk("VP8X", Buffer.from([0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0]))), ".webp")).toEqual(["EXIF"]);
  });

  it("detects PNG eXIf and XMP iTXt chunks", () => {
    expect(metadataIn(png(pngChunk("eXIf", Buffer.from("payload"))), ".png")).toEqual(["EXIF"]);
    expect(metadataIn(png(pngChunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>"))), ".png")).toEqual(["XMP"]);
  });

  it("detects a raw EXIF marker in other image formats", () => {
    expect(metadataIn(Buffer.from("RIFF Exif\0\0"), ".avif")).toEqual(["EXIF"]);
  });
});

describe("auditImages", () => {
  it("reports a dist image copied byte-for-byte from src", async () => {
    const original = jpeg();
    await writeFile(join(source, "photo.jpg"), original);
    await mkdir(join(dist, "_astro"), { recursive: true });
    await writeFile(join(dist, "_astro", "photo.webp"), original);

    await expect(auditImages(dist, [source])).resolves.toEqual(["_astro/photo.webp: copied original image from src"]);
  });

  it("accepts a clean, distinct image", async () => {
    await writeFile(join(source, "original.jpg"), jpeg());
    await mkdir(join(dist, "_astro"), { recursive: true });
    await writeFile(join(dist, "_astro", "optimized.webp"), webp(webpChunk("VP8 ", Buffer.from("encoded"))));

    await expect(auditImages(dist, [source])).resolves.toEqual([]);
  });
});
