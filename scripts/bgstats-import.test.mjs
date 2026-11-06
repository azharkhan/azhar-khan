import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bggPlaysFileSchema } from "../src/lib/feeds/bgg-plays.ts";
import { importBgStats } from "./bgstats-import.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("BG Stats importer", () => {
  it("keeps only allowed play fields from a synthetic export with private fields", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bgstats-import-test-"));
    directories.push(directory);
    const input = join(directory, "export.json");
    const output = join(directory, "plays.json");
    const synthetic = {
      games: [
        { id: "base", bggId: 123, name: "Fallback Name", bggName: "BGG Name", isExpansion: false, urlThumb: "https://cf.geekdo-images.com/game.jpg", privateGameField: "do not copy" },
        { id: "expansion", bggId: 456, name: "Expansion", bggName: "Expansion", isExpansion: 1 },
        { id: "no-bgg-id", name: "No BGG ID", isExpansion: false },
      ],
      plays: [
        { gameRefId: "base", bggId: 119000001, playDate: "2026-11-03 19:30:00", playerScores: [{ name: "Synthetic Player", score: 42 }], metaData: { note: "private note" } },
        { gameRefId: "base", bggId: 119000002, playDate: "2026-11-01 19:30:00", playerScores: [{ name: "Other Synthetic Player", score: 17 }] },
        { gameRefId: "base", bggId: 123, playDate: "2026-11-04 19:30:00", ignored: true, playerScores: [{ name: "Ignored Synthetic Player", score: 1 }] },
        { gameRefId: "expansion", bggId: 456, playDate: "2026-11-02 19:30:00" },
        { gameRefId: "no-bgg-id", playDate: "2026-11-02 19:30:00" },
        { gameRefId: "missing", bggId: 789, playDate: "2026-11-02 19:30:00", location: "Private Location" },
      ],
      players: [{ name: "Synthetic Player" }],
      locations: [{ name: "Private Location" }],
      groups: [{ name: "Private Group" }],
    };
    await writeFile(input, JSON.stringify(synthetic));
    const exportedAt = new Date("2026-11-04T12:00:00Z");
    await utimes(input, exportedAt, exportedAt);

    const result = await importBgStats(input, output);
    const content = await readFile(output, "utf8");
    const parsed = JSON.parse(content);
    expect(bggPlaysFileSchema.parse(parsed)).toEqual({
      source: "bgstats-export",
      exportedAt: "2026-11-04",
      plays: [
        { id: "123", name: "BGG Name", date: "2026-11-03", thumb: "https://cf.geekdo-images.com/game.jpg" },
        { id: "123", name: "BGG Name", date: "2026-11-01", thumb: "https://cf.geekdo-images.com/game.jpg" },
      ],
    });
    expect(content).not.toMatch(/Synthetic Player|Private Location|Private Group|private note|playerScores|metaData|groups|players|locations/);
    expect(result).toEqual({
      written: 2,
      games: 1,
      skipped: { ignored: 1, expansions: 1, missingGame: 1, missingBggId: 1, invalidDate: 0, invalidRow: 0 },
    });
  });

  it("omits thumbnails that are not HTTPS URLs on cf.geekdo-images.com", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bgstats-import-thumb-test-"));
    directories.push(directory);
    const input = join(directory, "export.json");
    const output = join(directory, "plays.json");
    const source = {
      games: [
        { id: 1, bggId: 501, name: "Sample Game One", urlThumb: "https://cf.geekdo-images.com/game-one.jpg" },
        { id: 2, bggId: 502, name: "Sample Game Two", urlThumb: "http://cf.geekdo-images.com/game-two.jpg" },
        { id: 3, bggId: 503, name: "Sample Game Three", urlThumb: "https://sub.cf.geekdo-images.com/game-three.jpg" },
      ],
      plays: [
        { gameRefId: 1, playDate: "2026-10-01 12:00:00", playerName: "PRIVATE_PLAYER_SENTINEL", location: "PRIVATE_LOCATION_SENTINEL", score: 9 },
        { gameRefId: 2, playDate: "2026-10-02 12:00:00" },
        { gameRefId: 3, playDate: "2026-10-03 12:00:00" },
      ],
    };
    await writeFile(input, JSON.stringify(source), "utf8");
    const timestamp = new Date("2021-05-07T00:00:00.000Z");
    await utimes(input, timestamp, timestamp);

    const result = await importBgStats(input, output);
    const json = await readFile(output, "utf8");
    const payload = JSON.parse(json);

    expect(result.written).toBe(3);
    expect(payload).toEqual({
      source: "bgstats-export",
      exportedAt: "2021-05-07",
      plays: [
        { id: "503", name: "Sample Game Three", date: "2026-10-03" },
        { id: "502", name: "Sample Game Two", date: "2026-10-02" },
        { id: "501", name: "Sample Game One", date: "2026-10-01", thumb: "https://cf.geekdo-images.com/game-one.jpg" },
      ],
    });
    expect(json).not.toContain("PRIVATE_PLAYER_SENTINEL");
    expect(json).not.toContain("PRIVATE_LOCATION_SENTINEL");
    expect(Object.keys(payload).sort()).toEqual(["exportedAt", "plays", "source"]);
    expect(payload.plays.every((play) => Object.keys(play).every((key) => ["id", "name", "date", "thumb"].includes(key)))).toBe(true);
  });
});
