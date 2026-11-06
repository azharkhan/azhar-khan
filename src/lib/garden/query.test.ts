import { describe, expect, it, vi } from "vitest";
import { buildGarden, type Garden } from "./build";
import { currently, entriesFor, statMetric, statSeries } from "./query";
import type { GardenEntry, Metric, Pursuit } from "./schema";
import type { FeedStatus } from "./feeds";
import { runFeeds } from "./feeds";
import { adapters } from "../feeds";

const now = new Date("2026-11-02T17:00:00Z");

function pursuit(id: string, currentlyAt?: number): Pursuit {
  return {
    id,
    title: id,
    icon: "book-open-text",
    colour: "none",
    since: 2020,
    blurb: `[placeholder: ${id} blurb]`,
    currently: currentlyAt,
  };
}

function entry(fields: Partial<GardenEntry> = {}): GardenEntry {
  return {
    id: "sample/entry",
    sources: ["hand"],
    kind: "note",
    title: "Sample entry",
    pursuits: ["films"],
    date: new Date("2026-10-20T12:00:00Z"),
    lastTouched: new Date("2026-10-20T12:00:00Z"),
    long: false,
    history: [],
    tags: [],
    connected: [],
    sample: true,
    ...fields,
  };
}

function boardGame(id: string, title: string, at: Date): GardenEntry {
  return entry({
    id: `bgg:${id}`,
    sources: ["bgg"],
    title,
    href: `https://boardgamegeek.com/boardgame/${id}`,
    pursuits: ["board-games"],
    date: at,
    lastTouched: at,
    history: [{ at, verb: "played" }],
  });
}

function garden(fields: Partial<Garden> = {}): Garden {
  return { now, pursuits: [pursuit("films", 1)], entries: [], feeds: [], shelf: [], ...fields };
}

function status(fields: Partial<FeedStatus> = {}): FeedStatus {
  return { adapter: "sample-films", pursuit: "films", mode: "fixture", dropped: 0, ...fields };
}

describe("Currently queries", () => {
  it("orders Currently rows and excludes garden-only pursuits", () => {
    const result = currently(garden({
      pursuits: [pursuit("reading", 3), pursuit("fitness"), pursuit("films", 1), pursuit("board-games", 2)],
    }));
    expect(result.map((row) => row.pursuit.id)).toEqual(["films", "board-games", "reading"]);
  });

  it("returns a fresh entry with its feed metric", () => {
    const metric: Metric = { kind: "stars", value: 4.5 };
    const result = currently(garden({ entries: [entry({ metric, lastTouched: now })] }));
    expect(result[0]).toMatchObject({ state: "latest", metric, entry: { id: "sample/entry" } });
  });

  it("uses the latest single rather than a newer cubing average", () => {
    const single = entry({
      id: "solve/latest-single", kind: "stat", pursuits: ["cubing"],
      stat: { label: "Single", value: 110, unit: "s" },
      date: new Date("2026-11-01T12:00:00Z"), lastTouched: new Date("2026-11-01T12:00:00Z"),
    });
    const average = entry({
      id: "solve/newer-average", kind: "stat", pursuits: ["cubing"],
      stat: { label: "ao5", value: 21.9, unit: "s" }, date: now, lastTouched: now,
    });
    const result = currently(garden({ pursuits: [pursuit("cubing", 1)], entries: [single, average] }));
    expect(result[0]).toMatchObject({ state: "latest", entry: { id: "solve/latest-single" } });
  });

  it("keeps the latest entry visible regardless of age", () => {
    const fortyOneDaysAgo = new Date(now.getTime() - 41 * 86400000);
    const result = currently(garden({ entries: [entry({ lastTouched: fortyOneDaysAgo })] }));
    expect(result[0]).toMatchObject({ state: "latest", entry: { lastTouched: fortyOneDaysAgo } });
  });

  it("returns a blurb when there are no entries", () => {
    expect(currently(garden())[0]).toMatchObject({ state: "blurb", blurb: "[placeholder: films blurb]" });
  });

  it("shows an old entry even when its feed is off", () => {
    const fortyOneDaysAgo = new Date(now.getTime() - 41 * 86400000);
    const result = currently(garden({
      entries: [entry({ lastTouched: fortyOneDaysAgo })],
      feeds: [status({ mode: "off" })],
    }));
    expect(result[0]).toMatchObject({ state: "latest", entry: { lastTouched: fortyOneDaysAgo } });
  });

  it("omits an off or failed feed when it has no entries", () => {
    const result = currently(garden({ feeds: [status({ mode: "off", error: "feed off" })] }));
    expect(result).toEqual([]);
    const failed = currently(garden({ feeds: [status({ error: "live failed" })] }));
    expect(failed).toEqual([]);
  });

  it("lists games from the latest Toronto play date, newest first with a title tie-break, capped at three", () => {
    const at = new Date("2026-10-31T16:00:00Z");
    const entries = [
      boardGame("5", "Echo", new Date(at.getTime() - 3 * 60_000)),
      boardGame("4", "Delta", new Date(at.getTime() - 2 * 60_000)),
      boardGame("3", "Bravo", new Date(at.getTime() - 60_000)),
      boardGame("2", "Alpha", new Date(at.getTime() - 60_000)),
      boardGame("1", "Newest", at),
      boardGame("old", "Previous day", new Date("2026-10-30T16:00:00Z")),
    ];
    const result = currently(garden({
      pursuits: [pursuit("board-games", 1)],
      entries,
    }))[0]!;
    expect(result.state).toBe("latest");
    if (result.state !== "latest") return;
    expect(result.items).toEqual([
      { title: "Newest", id: "bgg:1", href: "https://boardgamegeek.com/boardgame/1" },
      { title: "Alpha", id: "bgg:2", href: "https://boardgamegeek.com/boardgame/2" },
      { title: "Bravo", id: "bgg:3", href: "https://boardgamegeek.com/boardgame/3" },
    ]);
    expect(result.entry.title).toBe("Newest");
    expect(result.detail).toBeUndefined();
  });

  it("groups 02:00Z with the prior UTC date in Toronto and ignores future plays", () => {
    const TorontoNow = new Date("2026-09-27T03:00:00Z");
    const result = currently(garden({
      now: TorontoNow,
      pursuits: [pursuit("board-games", 1)],
      entries: [
        boardGame("edge", "Toronto Sep 26", new Date("2026-09-27T02:00:00Z")),
        boardGame("utc-previous", "Previous UTC date", new Date("2026-09-26T23:00:00Z")),
        boardGame("local-previous", "Previous Toronto date", new Date("2026-09-26T03:30:00Z")),
        boardGame("future", "Future play", new Date("2026-09-27T03:01:00Z")),
      ],
    }))[0]!;
    expect(result.state).toBe("latest");
    if (result.state !== "latest") return;
    expect(result.items?.map((item) => item.title)).toEqual(["Toronto Sep 26", "Previous UTC date"]);
  });

  it("shows the board-games blurb when BGG is off but a shelf exists", () => {
    const shelf = [{ id: "1", name: "Sample game", minPlayers: 1, maxPlayers: 4, minutes: 30, plays: 0 }];
    const off = status({ adapter: "bgg", pursuit: "board-games", mode: "off" });
    const pursuits = [pursuit("board-games", 1)];
    expect(currently(garden({ pursuits, feeds: [off], shelf })).map((row) => row.state)).toEqual(["blurb"]);
    expect(currently(garden({ pursuits, feeds: [status({ adapter: "bgg", pursuit: "board-games", error: "live failed" })], shelf }))
      .map((row) => row.state)).toEqual(["blurb"]);
    expect(currently(garden({ pursuits, feeds: [off] }))).toEqual([]);
  });

  it("shows one shared entry in each Currently pursuit", () => {
    const result = currently(garden({
      pursuits: [pursuit("films", 1), pursuit("reading", 2)],
      entries: [entry({ pursuits: ["films", "reading"], lastTouched: now })],
    }));
    expect(result.map((row) => row.state === "latest" ? row.entry.id : undefined)).toEqual(["sample/entry", "sample/entry"]);
  });

  it("derives stat metrics with a change and without one for the first point", () => {
    const first = entry({ id: "sample/first", kind: "stat", pursuits: ["cubing"], stat: { label: "ao5", value: 22.8, unit: "s" }, date: new Date("2026-10-20"), lastTouched: new Date("2026-10-20") });
    const latest = entry({ id: "sample/latest", kind: "stat", pursuits: ["cubing"], stat: { label: "ao5", value: 21.9, unit: "s" }, date: new Date("2026-10-28"), lastTouched: new Date("2026-10-28") });
    const gardenValue = garden({ pursuits: [pursuit("cubing", 1)], entries: [first, latest] });
    expect(statMetric(gardenValue, first, "cubing")).toEqual({ kind: "stat", label: "ao5", value: 22.8, unit: "s", change: undefined });
    expect(statMetric(gardenValue, latest, "cubing")).toEqual({ kind: "stat", label: "ao5", value: 21.9, unit: "s", change: -0.9 });
  });

  it("returns stat series only at the minimum and orders points by date", () => {
    const points = [
      entry({ id: "sample/3", kind: "stat", pursuits: ["cubing"], date: new Date("2026-10-30"), stat: { label: "ao5", value: 21, unit: "s" } }),
      entry({ id: "sample/1", kind: "stat", pursuits: ["cubing"], date: new Date("2026-10-20"), stat: { label: "ao5", value: 24, unit: "s" } }),
      entry({ id: "sample/2", kind: "stat", pursuits: ["cubing"], date: new Date("2026-10-25"), stat: { label: "ao5", value: 22, unit: "s" } }),
    ];
    const result = garden({ entries: points });
    expect(statSeries(garden({ entries: points.slice(0, 2) }), "cubing")).toEqual([]);
    expect(statSeries(result, "cubing")[0]?.points.map((point) => point.entryId)).toEqual([
      "sample/1", "sample/2", "sample/3",
    ]);
  });

  it("throws when a stat label has mismatched units", () => {
    const result = garden({ entries: [
      entry({ id: "sample/1", kind: "stat", pursuits: ["cubing"], stat: { label: "ao5", value: 24, unit: "s" } }),
      entry({ id: "sample/2", kind: "stat", pursuits: ["cubing"], stat: { label: "ao5", value: 22, unit: "ms" } }),
    ] });
    expect(() => statSeries(result, "cubing", 3)).toThrow("stat unit mismatch for cubing/ao5");
  });

  it("returns entries sorted by last touch", () => {
    const result = garden({ entries: [entry({ id: "sample/old" }), entry({ id: "sample/new", lastTouched: now })] });
    expect(entriesFor(result, "films").map((item) => item.id)).toEqual(["sample/new", "sample/old"]);
  });
});

describe("fixture adapter integration", () => {
  it("builds the fixture garden through the registry and Currently queries", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch;
    const pursuits = [
      pursuit("films", 1),
      pursuit("board-games", 2),
      pursuit("reading", 3),
      pursuit("gaming", 4),
      pursuit("music", 5),
      pursuit("cubing", 6),
      pursuit("3d-printing"),
      pursuit("fitness"),
    ];
    const feeds = await runFeeds(adapters, { env: { FEEDS: "fixtures" }, dev: true, now, fetch });
    const result = buildGarden({ pursuits, hand: [], feeds, now, samples: true });
    const rows = currently(result);
    expect(rows.map((row) => [row.pursuit.id, row.state])).toEqual([
      ["films", "latest"],
      ["board-games", "latest"],
      ["reading", "latest"],
      ["gaming", "latest"],
      ["music", "latest"],
      ["cubing", "blurb"],
    ]);
    expect(result.entries.find((entry) => entry.subject === "letterboxd:project-hail-mary")?.metric)
      .toEqual({ kind: "stars", value: 4.5 });
    expect(result.entries.find((entry) => entry.subject === "retroachievements:1")?.title).toBe("Super Metroid");
    expect(result.entries.find((entry) => entry.subject === "hardcover:710001")?.metric)
      .toEqual({ kind: "progress", value: 43 });
    expect(result.entries.find((entry) => entry.subject === "listenbrainz:artist:dddddddd-dddd-4ddd-8ddd-dddddddddddd")?.metric)
      .toBeUndefined();
    expect(rows.map((row) => row.state === "latest" ? row.metric : undefined)).toEqual([
      { kind: "stars", value: 4.5 },
      { kind: "times", value: 2 },
      { kind: "progress", value: 43 },
      { kind: "count", value: 4, unit: "new" },
      undefined,
      undefined,
    ]);
  });
});
