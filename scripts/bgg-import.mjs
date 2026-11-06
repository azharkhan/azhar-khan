import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shelfGameSchema } from "../src/lib/garden/schema.ts";

const defaultInput = "private/bgg-collection.csv";
const defaultOutput = "src/data/bgg-shelf.json";
const source = "bgg-csv-export";

function parseCsv(input) {
  const csv = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;

  const endField = () => {
    row.push(field);
    field = "";
    afterQuote = false;
  };
  const endRow = () => {
    endField();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  };

  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ",") endField();
      else if (character === "\n") endRow();
      else if (character === "\r") {
        if (csv[index + 1] === "\n") index++;
        endRow();
      } else if (character !== " " && character !== "\t") {
        throw new Error("Malformed CSV quoting");
      }
      continue;
    }

    if (character === ",") endField();
    else if (character === "\n") endRow();
    else if (character === "\r") {
      if (csv[index + 1] === "\n") index++;
      endRow();
    } else if (character === '"') {
      if (field !== "") throw new Error("Malformed CSV quoting");
      quoted = true;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("Unclosed quoted CSV field");
  if (field !== "" || row.length > 0 || afterQuote) endRow();
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one row");

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const columns = new Map(headers.map((header, index) => [header, index]));
  if (!columns.has("objectid") || !columns.has("objectname") || !columns.has("own")
    || !["objecttype", "itemtype"].some((header) => columns.has(header))) {
    throw new Error("CSV is missing required collection columns");
  }

  return rows.slice(1).map((values) => ({ values, columns }));
}

function valueOf(row, name) {
  const index = row.columns.get(name);
  return index === undefined ? "" : (row.values[index] ?? "").trim();
}

function integer(value, minimum = 0) {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : undefined;
}

function positiveInteger(value) {
  return integer(value, 1);
}

function inferredGameType(rows) {
  // Some BGG exports use "thing" for all objects; infer the sole non-expansion type only in that unambiguous case.
  const owned = rows.filter((row) => valueOf(row, "own") === "1");
  const objectTypes = new Set(owned.map((row) => valueOf(row, "objecttype").toLowerCase()));
  const itemTypes = new Set(owned.map((row) => valueOf(row, "itemtype").toLowerCase()).filter(Boolean));
  const hasExplicitGameType = [...objectTypes, ...itemTypes]
    .some((type) => type === "boardgame" || type === "board game");
  const expansionTypes = [...itemTypes].filter((type) => type.includes("expansion"));
  const gameTypes = [...itemTypes].filter((type) => !type.includes("expansion"));
  if (!hasExplicitGameType && objectTypes.size === 1 && objectTypes.has("thing")
    && expansionTypes.length === 1 && gameTypes.length === 1) {
    return gameTypes[0];
  }
  return undefined;
}

function classify(row, inferredType) {
  const types = ["objecttype", "itemtype", "subtype", "type"]
    .map((column) => valueOf(row, column).toLowerCase())
    .filter(Boolean);
  if (types.some((type) => type.includes("expansion"))) return "expansion";
  if (types.some((type) => type === "boardgame" || type === "board game")) return "boardGame";
  if (inferredType && valueOf(row, "itemtype").toLowerCase() === inferredType) return "boardGame";
  return "notBoardGame";
}

function gameFrom(row) {
  const id = valueOf(row, "objectid");
  const name = valueOf(row, "objectname");
  if (!/^\d+$/.test(id) || !/[1-9]/.test(id) || !name) return { reason: "invalidIdentity" };

  const minPlayers = positiveInteger(valueOf(row, "minplayers"));
  const maxPlayers = positiveInteger(valueOf(row, "maxplayers"));
  if (minPlayers === undefined || maxPlayers === undefined) return { reason: "invalidPlayers" };

  const minutes = positiveInteger(valueOf(row, "playingtime"))
    ?? positiveInteger(valueOf(row, "maxplaytime"))
    ?? positiveInteger(valueOf(row, "minplaytime"));
  if (minutes === undefined) return { reason: "noMinutes" };

  const playsRaw = valueOf(row, "numplays");
  const plays = playsRaw === "" ? 0 : integer(playsRaw);
  if (plays === undefined) return { reason: "invalidPlays" };

  const year = positiveInteger(valueOf(row, "yearpublished"));
  const ratingRaw = valueOf(row, "rating");
  const ratingValue = ratingRaw === "" ? Number.NaN : Number(ratingRaw);
  const rating = Number.isFinite(ratingValue) && ratingValue >= 0 && ratingValue <= 10
    ? ratingValue
    : undefined;

  const game = {
    id,
    name,
    ...(year === undefined ? {} : { year }),
    minPlayers,
    maxPlayers,
    minutes,
    plays,
    ...(rating === undefined ? {} : { rating }),
    href: `https://boardgamegeek.com/boardgame/${id}`,
  };
  const validated = shelfGameSchema.safeParse(game);
  return validated.success ? { game: validated.data } : { reason: "invalidGame" };
}

function skippedCounts() {
  return {
    notOwned: 0,
    expansions: 0,
    notBoardGame: 0,
    invalidIdentity: 0,
    invalidPlayers: 0,
    noMinutes: 0,
    invalidPlays: 0,
    invalidGame: 0,
  };
}

export async function importBggCsv(inputPath = defaultInput, outputPath = defaultOutput) {
  const inputFile = resolve(inputPath);
  const outputFile = resolve(outputPath);
  const [csv, metadata] = await Promise.all([readFile(inputFile, "utf8"), stat(inputFile)]);
  const rows = parseCsv(csv);
  const skipped = skippedCounts();
  const games = [];
  const inferredType = inferredGameType(rows);

  for (const row of rows) {
    if (valueOf(row, "own") !== "1") {
      skipped.notOwned++;
      continue;
    }
    const classification = classify(row, inferredType);
    if (classification === "expansion") {
      skipped.expansions++;
      continue;
    }
    if (classification !== "boardGame") {
      skipped.notBoardGame++;
      continue;
    }
    const result = gameFrom(row);
    if (result.reason) {
      skipped[result.reason]++;
      continue;
    }
    games.push(result.game);
  }

  games.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })
    || a.name.localeCompare(b.name, "en")
    || a.id.localeCompare(b.id));

  const output = {
    source,
    exportedAt: metadata.mtime.toISOString().slice(0, 10),
    games,
  };
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return { written: games.length, skipped };
}

function printSummary(result) {
  const skipped = Object.entries(result.skipped).filter(([, count]) => count > 0);
  const detail = skipped.length ? `; skipped ${skipped.map(([reason, count]) => `${reason}=${count}`).join(", ")}` : "; skipped 0";
  console.log(`Wrote ${result.written} games${detail}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  importBggCsv(process.argv[2] ?? defaultInput)
    .then(printSummary)
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "BGG import failed");
      process.exitCode = 1;
    });
}
