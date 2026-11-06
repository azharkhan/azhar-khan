import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBggShelf } from "./bgg-shelf";
import { runFeeds, type Adapter } from "../garden/feeds";
import type { FeedThing, ShelfGame } from "../garden/schema";

const now = new Date("2026-11-02T17:00:00Z");
const fileGame: ShelfGame = {
  id: "123",
  name: "Committed Shelf Sample",
  minPlayers: 1,
  maxPlayers: 4,
  minutes: 45,
  plays: 0,
  href: "https://boardgamegeek.com/boardgame/123",
  cover: "https://covers.example.test/committed-shelf-sample.jpg",
};
const liveGame: ShelfGame = { ...fileGame, id: "456", name: "Live Shelf Sample" };
const fixtureGame: ShelfGame = { ...fileGame, id: "789", name: "Fixture Shelf Sample" };
const sampleThing: FeedThing = {
  subject: "bgg:789",
  title: "Fixture Sample",
  history: [{ at: now, verb: "added" }],
  sample: true,
  kind: "note",
};
const liveThing: FeedThing = {
  subject: "bgg:456",
  title: "Live Sample",
  history: [{ at: now, verb: "played" }],
  sample: false,
  kind: "note",
};
const fallbackThing: FeedThing = {
  subject: "bgg:123",
  title: "Imported Sample",
  history: [{ at: now, verb: "played" }],
  sample: false,
  kind: "note",
};

type Raw = { source: "live" | "fixture" | "fallback" };

function makeAdapter(overrides: Partial<Adapter<Raw>> = {}): Adapter<Raw> {
  return {
    id: "bgg",
    pursuit: "board-games",
    env: ["BGG_TOKEN"],
    live: vi.fn(async () => ({ source: "live" as const })),
    fixture: vi.fn(async () => ({ source: "fixture" as const })),
    parse: vi.fn((raw) => raw.source === "live"
      ? { things: [liveThing], shelf: [liveGame] }
      : raw.source === "fallback"
        ? { things: [fallbackThing], shelf: [fileGame] }
        : { things: [sampleThing], shelf: [fixtureGame] }),
    ...overrides,
  };
}

function options(env: Record<string, string | undefined> = {}, dev = false, bggShelf?: ShelfGame[]) {
  return { env, dev, now, bggShelf, log: vi.fn() };
}

let directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function shelfFile() {
  const directory = await mkdtemp(join(tmpdir(), "bgg-shelf-test-"));
  directories.push(directory);
  const path = join(directory, "src", "data", "bgg-shelf.json");
  await mkdir(join(directory, "src", "data"), { recursive: true });
  await writeFile(path, JSON.stringify({ source: "bgg-csv-export", exportedAt: "2026-11-01", games: [fileGame] }));
  return path;
}

describe("committed BGG shelf fallback", () => {
  for (const dev of [true, false]) {
    it(`uses the static shelf with no token in ${dev ? "development" : "production"}`, async () => {
      const shelf = await loadBggShelf(await shelfFile());
      const adapter = makeAdapter();
      const [result] = await runFeeds([adapter], options({}, dev, shelf));

      expect(result).toMatchObject({ things: [], shelf: [fileGame] });
      expect(adapter.fixture).not.toHaveBeenCalled();
      expect(adapter.live).not.toHaveBeenCalled();
    });

    it(`uses the static shelf after a live failure in ${dev ? "development" : "production"}`, async () => {
      const shelf = await loadBggShelf(await shelfFile());
      const adapter = makeAdapter({ live: vi.fn(async () => { throw new Error("live unavailable"); }) });
      const [result] = await runFeeds([adapter], options({ BGG_TOKEN: "set" }, dev, shelf));

      expect(result).toMatchObject({ things: [], shelf: [fileGame], error: "live unavailable" });
      expect(adapter.fixture).not.toHaveBeenCalled();
    });
  }

  it("uses the live shelf when live succeeds", async () => {
    const shelf = await loadBggShelf(await shelfFile());
    const adapter = makeAdapter();
    const [result] = await runFeeds([adapter], options({ BGG_TOKEN: "set" }, false, shelf));

    expect(result).toMatchObject({ mode: "live", things: [liveThing], shelf: [liveGame] });
    expect(adapter.live).toHaveBeenCalledOnce();
  });

  it("uses a real committed-play fallback in production without a token", async () => {
    const shelf = await loadBggShelf(await shelfFile());
    const fallback = vi.fn(async () => ({ source: "fallback" as const }));
    const adapter = makeAdapter({ realFixture: true, realFallback: fallback });
    const [result] = await runFeeds([adapter], options({}, false, shelf));

    expect(result).toMatchObject({ mode: "fixture", things: [fallbackThing] });
    expect(fallback).toHaveBeenCalledOnce();
    expect(adapter.fixture).not.toHaveBeenCalled();
  });

  it("uses the real fallback after live failure but keeps successful live data", async () => {
    const shelf = await loadBggShelf(await shelfFile());
    const fallback = vi.fn(async () => ({ source: "fallback" as const }));
    const failed = makeAdapter({
      realFixture: true,
      realFallback: fallback,
      live: vi.fn(async () => { throw new Error("live unavailable"); }),
    });
    const [failedResult] = await runFeeds([failed], options({ BGG_TOKEN: "set" }, false, shelf));
    expect(failedResult).toMatchObject({ mode: "fixture", error: "live unavailable", things: [fallbackThing] });
    expect(fallback).toHaveBeenCalledOnce();

    const liveFallback = vi.fn(async () => ({ source: "fallback" as const }));
    const live = makeAdapter({ realFixture: true, realFallback: liveFallback });
    const [liveResult] = await runFeeds([live], options({ BGG_TOKEN: "set" }, false, shelf));
    expect(liveResult).toMatchObject({ mode: "live", things: [liveThing] });
    expect(liveFallback).not.toHaveBeenCalled();
  });

  it("keeps current behavior when the shelf file is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bgg-shelf-missing-"));
    directories.push(directory);
    const shelf = await loadBggShelf(join(directory, "missing.json"));
    const devAdapter = makeAdapter();
    const [devResult] = await runFeeds([devAdapter], options({}, true, shelf));
    const prodAdapter = makeAdapter();
    const [prodResult] = await runFeeds([prodAdapter], options({}, false, shelf));

    expect(shelf).toBeUndefined();
    expect(devResult).toMatchObject({ mode: "fixture", things: [sampleThing], shelf: [fixtureGame] });
    expect(devAdapter.fixture).toHaveBeenCalledOnce();
    expect(prodResult).toMatchObject({ mode: "off", things: [] });
    expect(prodResult?.shelf).toBeUndefined();
    expect(prodAdapter.fixture).not.toHaveBeenCalled();
  });
});
