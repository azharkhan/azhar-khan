import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "astro/zod";
import { shelfGameSchema, type ShelfGame } from "../garden/schema";

const shelfFileSchema = z.strictObject({
  source: z.literal("bgg-csv-export"),
  exportedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
  games: z.array(shelfGameSchema),
});

export async function loadBggShelf(path = resolve("src/data/bgg-shelf.json")): Promise<ShelfGame[] | undefined> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return undefined;
    throw cause;
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return undefined;
  }
  const parsed = shelfFileSchema.safeParse(data);
  return parsed.success ? parsed.data.games : undefined;
}
