import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "astro/zod";

const coverUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "cf.geekdo-images.com" && !url.username && !url.password;
});

export const bggCoversFileSchema = z.strictObject({
  source: z.literal("geekdo-images"),
  covers: z.record(z.string().regex(/^[1-9]\d*$/), coverUrl),
});

export type BggCovers = Record<string, string>;

export async function loadBggCovers(path = resolve("src/data/bgg-covers.json")): Promise<BggCovers> {
  try {
    const parsed = bggCoversFileSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data.covers : {};
  } catch {
    return {};
  }
}
