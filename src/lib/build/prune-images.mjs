// @ts-check
import { readdir, readFile, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".heic"]);
const binaryExtensions = new Set([
  ...imageExtensions,
  ".apng",
  ".bmp",
  ".dib",
  ".ico",
  ".j2c",
  ".j2k",
  ".jp2",
  ".jxl",
  ".tif",
  ".tiff",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".dfont",
  ".fon",
]);

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function filesUnder(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true, recursive: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** @param {string} distDirectory */
export async function pruneUnreferencedImages(distDirectory) {
  const [allFiles, assets] = await Promise.all([
    filesUnder(distDirectory),
    filesUnder(join(distDirectory, "_astro")),
  ]);
  const documents = await Promise.all(allFiles
    .filter((file) => !binaryExtensions.has(extname(file).toLowerCase()))
    .map((file) => readFile(file, "utf8")));
  const references = documents.join("\n");
  const unreferenced = assets.filter((file) => {
    if (!imageExtensions.has(extname(file).toLowerCase())) return false;
    const name = basename(file);
    return ![name, encodeURI(name), encodeURIComponent(name)].some((candidate) => references.includes(candidate));
  });
  await Promise.all(unreferenced.map((file) => rm(file)));
}
