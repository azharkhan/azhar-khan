// @ts-check
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const imageExtensions = new Set([
  ".avif", ".bmp", ".dib", ".gif", ".heic", ".ico", ".j2c", ".j2k", ".jfif", ".jp2", ".jpe", ".jpeg", ".jpg", ".jxl", ".png", ".svg", ".tif", ".tiff", ".webp",
]);
const sourceImageExtensions = new Set([...imageExtensions].filter((extension) => extension !== ".svg"));
const exifTag = Buffer.from("Exif\0\0", "ascii");
const xmpTag = Buffer.from("http://ns.adobe.com/xap/1.0/", "ascii");

/** @param {Buffer} buffer @param {string} marker */
function has(buffer, marker) {
  return buffer.includes(Buffer.from(marker, "ascii"));
}

/** @param {Buffer} buffer @returns {string[]} */
function jpegMetadata(buffer) {
  const found = new Set();
  let offset = 2;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === undefined || marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (marker === 0xe1) {
      const payload = buffer.subarray(offset + 2, offset + length);
      if (payload.subarray(0, exifTag.length).equals(exifTag)) found.add("EXIF");
      if (payload.includes(xmpTag) || has(payload, "ns.adobe.com/xap")) found.add("XMP");
    }
    offset += length;
  }
  return [...found];
}

/** @param {Buffer} buffer @returns {string[]} */
function webpMetadata(buffer) {
  const found = new Set();
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const name = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) break;
    if (name === "EXIF") found.add("EXIF");
    if (name === "XMP ") found.add("XMP");
    if (name === "VP8X" && length > 0) {
      const flags = buffer[start];
      if (flags !== undefined && (flags & 0x08) !== 0) found.add("EXIF");
      if (flags !== undefined && (flags & 0x04) !== 0) found.add("XMP");
    }
    offset = end + (length % 2);
  }
  return [...found];
}

/** @param {Buffer} buffer @returns {string[]} */
function pngMetadata(buffer) {
  const found = new Set();
  if (buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) break;
    if (type === "eXIf") found.add("EXIF");
    if (type === "iTXt") {
      const data = buffer.subarray(start, end);
      const keywordEnd = data.indexOf(0);
      const keyword = keywordEnd < 0 ? "" : data.toString("utf8", 0, keywordEnd);
      if (keyword.toLowerCase() === "xml:com.adobe.xmp" || has(data, "ns.adobe.com/xap")) found.add("XMP");
    }
    offset = end + 4;
  }
  return [...found];
}

/** @param {Buffer} buffer @param {string} extension @returns {string[]} */
export function metadataIn(buffer, extension) {
  const ext = extension.toLowerCase();
  if ([".jpg", ".jpeg", ".jpe", ".jfif"].includes(ext)) return jpegMetadata(buffer);
  if (ext === ".webp") return webpMetadata(buffer);
  if (ext === ".png") return pngMetadata(buffer);
  return buffer.includes(exifTag) ? ["EXIF"] : [];
}

/** @param {string} directory @returns {Promise<string[]>} */
async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  }));
  return nested.flat();
}

/** @param {Buffer} buffer */
function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * @param {string} distDirectory
 * @param {string[]} sourceDirectories
 * @returns {Promise<string[]>} one message per problem, paths relative to dist
 */
export async function auditImages(distDirectory, sourceDirectories) {
  const sourceImages = (await Promise.all(sourceDirectories.map((directory) => filesUnder(resolve(directory)))))
    .flat()
    .filter((path) => sourceImageExtensions.has(extname(path).toLowerCase()));
  const sourceHashes = new Set(await Promise.all(sourceImages.map(async (path) => sha256(await readFile(path)))));
  const problems = [];

  for (const path of await filesUnder(resolve(distDirectory))) {
    const buffer = await readFile(path);
    const extension = extname(path).toLowerCase();
    const relativePath = relative(distDirectory, path).split(sep).join("/");
    if (imageExtensions.has(extension)) {
      for (const metadata of metadataIn(buffer, extension)) {
        problems.push(`${relativePath}: contains ${metadata} metadata`);
      }
    }
    if (sourceHashes.has(sha256(buffer))) problems.push(`${relativePath}: copied original image from src`);
  }

  return problems;
}
