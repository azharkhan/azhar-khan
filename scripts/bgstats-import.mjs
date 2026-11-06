import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "astro/zod";
import { bggPlaysFileSchema } from "../src/lib/feeds/bgg-plays.ts";

const defaultInput = "private/BGStatsExport.json";
const defaultOutput = "src/data/bgg-plays.json";
const sourceId = z.union([z.string().min(1), z.number().int()]).transform(String);
const gameSchema = z.object({
  id: sourceId,
  bggId: sourceId.nullable().optional(),
  name: z.string().nullable().optional(),
  bggName: z.string().nullable().optional(),
  urlThumb: z.string().nullable().optional(),
  isExpansion: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullable().optional(),
}).loose();
const playSchema = z.object({
  gameRefId: sourceId.nullable().optional(),
  bggId: sourceId.nullable().optional(),
  ignored: z.boolean().nullable().optional(),
  playDate: z.string(),
}).loose();
const dateTimePattern = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function validDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value;
}

function playDate(value) {
  const match = dateTimePattern.exec(value);
  if (!match || !validDate(match[1])) return undefined;
  const [, date, hour, minute, second] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return undefined;
  return date;
}

function bggId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  return undefined;
}

function gameName(game) {
  const bggName = game.bggName?.trim();
  return bggName || game.name?.trim() || undefined;
}

function publicThumb(value) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cf.geekdo-images.com" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export async function importBgStats(inputPath = defaultInput, outputPath = defaultOutput) {
  const inputFile = resolve(inputPath);
  const outputFile = resolve(outputPath);
  const [content, metadata] = await Promise.all([readFile(inputFile, "utf8"), stat(inputFile)]);
  let input;
  try {
    input = JSON.parse(content);
  } catch {
    throw new Error("Invalid BG Stats export JSON");
  }
  if (!input || typeof input !== "object" || !Array.isArray(input.games) || !Array.isArray(input.plays)) {
    throw new Error("Invalid BG Stats export shape");
  }

  const games = new Map();
  for (const value of input.games) {
    const parsed = gameSchema.safeParse(value);
    if (parsed.success) games.set(parsed.data.id, parsed.data);
  }

  const skipped = { ignored: 0, expansions: 0, missingGame: 0, missingBggId: 0, invalidDate: 0, invalidRow: 0 };
  const plays = [];
  for (const value of input.plays) {
    const parsed = playSchema.safeParse(value);
    if (!parsed.success) {
      skipped.invalidRow++;
      continue;
    }
    const play = parsed.data;
    if (play.ignored === true) {
      skipped.ignored++;
      continue;
    }
    const game = play.gameRefId ? games.get(play.gameRefId) : undefined;
    if (!game) {
      skipped.missingGame++;
      continue;
    }
    if (game.isExpansion === true || game.isExpansion === 1) {
      skipped.expansions++;
      continue;
    }
    const id = bggId(game.bggId);
    if (!id) {
      skipped.missingBggId++;
      continue;
    }
    const name = gameName(game);
    const date = playDate(play.playDate);
    if (!date) {
      skipped.invalidDate++;
      continue;
    }
    if (!name) {
      skipped.invalidRow++;
      continue;
    }
    const thumb = publicThumb(game.urlThumb);
    plays.push({ id, name, date, ...(thumb ? { thumb } : {}), sortKey: play.playDate });
  }

  plays.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  const output = bggPlaysFileSchema.safeParse({
    source: "bgstats-export",
    exportedAt: metadata.mtime.toISOString().slice(0, 10),
    plays: plays.slice(0, 100).map(({ id, name, date, thumb }) => ({ id, name, date, ...(thumb ? { thumb } : {}) })),
  });
  if (!output.success) throw new Error("BG Stats import produced invalid output");

  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(output.data, null, 2)}\n`, "utf8");
  return { written: output.data.plays.length, games: new Set(output.data.plays.map((play) => play.id)).size, skipped };
}

function printSummary(result) {
  const skipped = Object.entries(result.skipped).filter(([, count]) => count > 0);
  const details = skipped.length ? `; skipped ${skipped.map(([reason, count]) => `${reason}=${count}`).join(", ")}` : "; skipped 0";
  console.log(`Wrote ${result.written} plays across ${result.games} games${details}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  importBgStats(process.argv[2] ?? defaultInput)
    .then(printSummary)
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "BG Stats import failed");
      process.exitCode = 1;
    });
}
