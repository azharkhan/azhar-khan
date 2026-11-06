import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importBggCsv } from "./bgg-import.mjs";

const tempDirs = [];

function csvField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values) {
  return values.map(csvField).join(",");
}

function row(fields) {
  return [
    fields.objecttype,
    fields.itemtype,
    fields.objectid,
    fields.objectname,
    fields.yearpublished,
    fields.minplayers,
    fields.maxplayers,
    fields.playingtime,
    fields.maxplaytime,
    fields.minplaytime,
    fields.own,
    fields.numplays,
    fields.rating,
    "PRIVATE_PRICE_SENTINEL",
    "PRIVATE_COMMENT_SENTINEL",
    "PRIVATE_ACQUIRED_SENTINEL",
    "PRIVATE_LOCATION_SENTINEL",
  ];
}

const headers = [
  "objecttype", "itemtype", "objectid", "objectname", "yearpublished",
  "minplayers", "maxplayers", "playingtime", "maxplaytime", "minplaytime",
  "own", "numplays", "rating", "pricepaid", "privatecomment", "acquiredfrom", "invlocation",
];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("BGG CSV importer", () => {
  it("strips private columns, handles BOM and CSV quoting, and filters rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bgg-import-test-"));
    tempDirs.push(directory);
    const input = join(directory, "collection.csv");
    const output = join(directory, "shelf.json");
    const csv = [
      csvRow(headers),
      csvRow(row({ objecttype: "thing", itemtype: "boardgame", objectid: "501", objectname: 'Board, "Quoted" Game', yearpublished: "2024", minplayers: "2", maxplayers: "5", playingtime: "45", maxplaytime: "60", minplaytime: "30", own: "1", numplays: "3", rating: "8.5" })),
      csvRow(row({ objecttype: "boardgame", itemtype: "boardgame", objectid: "502", objectname: "Fallback Game", yearpublished: "not-a-year", minplayers: "1", maxplayers: "4", playingtime: "0", maxplaytime: "25", minplaytime: "10", own: "1", numplays: "", rating: "not-a-rating" })),
      csvRow(row({ objecttype: "boardgame", itemtype: "boardgameexpansion", objectid: "503", objectname: "Excluded Expansion", yearpublished: "2020", minplayers: "1", maxplayers: "4", playingtime: "30", maxplaytime: "30", minplaytime: "30", own: "1", numplays: "0", rating: "" })),
      csvRow(row({ objecttype: "boardgame", itemtype: "boardgame", objectid: "504", objectname: "Not Owned", yearpublished: "2020", minplayers: "1", maxplayers: "4", playingtime: "30", maxplaytime: "30", minplaytime: "30", own: "0", numplays: "0", rating: "" })),
      csvRow(row({ objecttype: "boardgame", itemtype: "boardgame", objectid: "505", objectname: "No Duration", yearpublished: "2020", minplayers: "1", maxplayers: "4", playingtime: "0", maxplaytime: "0", minplaytime: "0", own: "1", numplays: "0", rating: "" })),
      csvRow(row({ objecttype: "thing", itemtype: "rpg", objectid: "506", objectname: "Not A Board Game", yearpublished: "2020", minplayers: "1", maxplayers: "4", playingtime: "30", maxplaytime: "30", minplaytime: "30", own: "1", numplays: "0", rating: "" })),
    ].join("\r\n");
    await writeFile(input, `\uFEFF${csv}\r\n`, "utf8");
    const timestamp = new Date("2021-05-07T00:00:00.000Z");
    await utimes(input, timestamp, timestamp);

    const result = await importBggCsv(input, output);
    const json = await readFile(output, "utf8");
    const payload = JSON.parse(json);

    expect(result.written).toBe(2);
    expect(result.skipped).toMatchObject({ notOwned: 1, expansions: 1, noMinutes: 1, notBoardGame: 1 });
    expect(payload).toEqual({
      source: "bgg-csv-export",
      exportedAt: "2021-05-07",
      games: [
        {
          id: "501",
          name: 'Board, "Quoted" Game',
          year: 2024,
          minPlayers: 2,
          maxPlayers: 5,
          minutes: 45,
          plays: 3,
          rating: 8.5,
          href: "https://boardgamegeek.com/boardgame/501",
        },
        {
          id: "502",
          name: "Fallback Game",
          minPlayers: 1,
          maxPlayers: 4,
          minutes: 25,
          plays: 0,
          href: "https://boardgamegeek.com/boardgame/502",
        },
      ],
    });
    expect(json).not.toContain("PRIVATE_PRICE_SENTINEL");
    expect(json).not.toContain("PRIVATE_COMMENT_SENTINEL");
    expect(json).not.toContain("PRIVATE_ACQUIRED_SENTINEL");
    expect(json).not.toContain("PRIVATE_LOCATION_SENTINEL");
    expect(Object.keys(payload).sort()).toEqual(["exportedAt", "games", "source"]);
    expect(payload.games.every((game) => Object.keys(game).every((key) => [
      "id", "name", "year", "minPlayers", "maxPlayers", "minutes", "plays", "rating", "href",
    ].includes(key)))).toBe(true);
  });
});
