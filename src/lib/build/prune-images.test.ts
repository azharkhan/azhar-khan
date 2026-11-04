import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneUnreferencedImages } from "./prune-images.mjs";

let tempDirectory = "";
let distDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "prune-images-"));
  distDirectory = join(tempDirectory, "dist");
  await mkdir(join(distDirectory, "_astro"), { recursive: true });
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

async function addImage(name: string): Promise<string> {
  const path = join(distDirectory, "_astro", name);
  await writeFile(path, "image");
  return path;
}

async function addDocument(name: string, contents: string): Promise<void> {
  await writeFile(join(distDirectory, name), contents);
}

describe("pruneUnreferencedImages", () => {
  it("deletes an unreferenced image", async () => {
    const image = await addImage("orphan.webp");

    await pruneUnreferencedImages(distDirectory);

    await expect(readFile(image, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps an image referenced by its raw name", async () => {
    const name = "raw photo.webp";
    const image = await addImage(name);
    await addDocument("index.html", `<img src="/_astro/${name}">`);

    await pruneUnreferencedImages(distDirectory);

    await expect(readFile(image, "utf8")).resolves.toBe("image");
  });

  it("keeps an image referenced by its encoded name", async () => {
    const name = "IMG 你好.webp";
    const image = await addImage(name);
    await addDocument("index.html", `<img src="/_astro/${encodeURI(name)}">`);

    await pruneUnreferencedImages(distDirectory);

    await expect(readFile(image, "utf8")).resolves.toBe("image");
  });

  it("keeps an image referenced only from an XML file", async () => {
    const name = "rss-photo.webp";
    const image = await addImage(name);
    await addDocument("feed.xml", `<enclosure url="/_astro/${name}"/>`);

    await pruneUnreferencedImages(distDirectory);

    await expect(readFile(image, "utf8")).resolves.toBe("image");
  });

  it("keeps an image referenced only from a web manifest", async () => {
    const name = "manifest-photo.webp";
    const image = await addImage(name);
    await addDocument("site.webmanifest", JSON.stringify({ icons: [{ src: `/_astro/${name}` }] }));

    await pruneUnreferencedImages(distDirectory);

    await expect(readFile(image, "utf8")).resolves.toBe("image");
  });

  it("does not throw when the _astro directory is missing", async () => {
    await rm(join(distDirectory, "_astro"), { recursive: true, force: true });

    await expect(pruneUnreferencedImages(distDirectory)).resolves.toBeUndefined();
  });
});
