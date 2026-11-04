// @ts-check
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import { auditImages } from "./src/lib/build/image-audit.mjs";
import { pruneUnreferencedImages } from "./src/lib/build/prune-images.mjs";
import { paper } from "./src/lib/build/shiki-paper.mjs";

/** @param {{ dir: URL }} event */
async function onBuildDone({ dir }) {
  const dist = fileURLToPath(dir);
  await pruneUnreferencedImages(dist);
  const problems = await auditImages(dist, ["src"]);
  if (problems.length > 0) throw new Error(`image audit failed:\n${problems.join("\n")}`);
}

const pruneUnreferencedContentImages = {
  name: "prune-unreferenced-content-images",
  hooks: { "astro:build:done": onBuildDone },
};

export default defineConfig({
  site: "https://azharkhan.net",
  output: "static",
  compressHTML: true,
  markdown: { shikiConfig: { theme: paper } },
  integrations: [pruneUnreferencedContentImages],
});
