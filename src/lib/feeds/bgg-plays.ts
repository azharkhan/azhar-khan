import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "astro/zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const thumbUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "cf.geekdo-images.com" && !url.username && !url.password;
});

export const bggPlaysFileSchema = z.strictObject({
  source: z.literal("bgstats-export"),
  exportedAt: dateOnly,
  plays: z.array(z.strictObject({
    id: z.string().regex(/^[1-9]\d*$/),
    name: z.string().min(1),
    date: dateOnly,
    thumb: thumbUrl.optional(),
  })),
});

export type BggPlay = z.infer<typeof bggPlaysFileSchema>["plays"][number];
export type BggPlaysFile = z.infer<typeof bggPlaysFileSchema>;

export async function loadBggPlays(path = resolve("src/data/bgg-plays.json")): Promise<BggPlaysFile | undefined> {
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
  const parsed = bggPlaysFileSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}
