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
    kit: [],
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
    growth: "seedling",
    long: false,
    history: [],
    tags: [],
    connected: [],
    sample: true,
    ...fields,
  };
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

  it("treats exactly 30 days as fresh and 30 days plus one millisecond as stale", () => {
    const exactlyThirtyDays = new Date(now.getTime() - 30 * 86400000);
    const oneMillisecondTooOld = new Date(exactlyThirtyDays.getTime() - 1);
    expect(currently(garden({ entries: [entry({ lastTouched: exactlyThirtyDays })] }))[0]?.state).toBe("latest");
    expect(currently(garden({ entries: [entry({ lastTouched: oneMillisecondTooOld })] }))[0]?.state).toBe("blurb");
  });

  it("returns a blurb when there are no entries", () => {
    expect(currently(garden())[0]).toMatchObject({ state: "blurb", blurb: "[placeholder: films blurb]" });
  });

  it("omits an off feed with no fresh entry but keeps a fresh hand entry", () => {
    const result = currently(garden({
      pursuits: [pursuit("films", 1), pursuit("reading", 2)],
      entries: [entry({ pursuits: ["reading"], lastTouched: now })],
      feeds: [status({ mode: "off" }), status({ adapter: "sample-reading", pursuit: "reading", mode: "off" })],
    }));
    expect(result.map((row) => row.pursuit.id)).toEqual(["reading"]);
    expect(result[0]?.state).toBe("latest");
  });

  it("omits a failed feed when it has no feed entries", () => {
    const result = currently(garden({
      entries: [entry({ lastTouched: new Date("2026-09-01T12:00:00Z") })],
      feeds: [status({ error: "live failed" })],
    }));
    expect(result).toEqual([]);
  });

  it("shows one shared entry in each Currently pursuit", () => {
    const result = currently(garden({
      pursuits: [pursuit("films", 1), pursuit("reading", 2)],
      entries: [entry({ pursuits: ["films", "reading"], lastTouched: now })],
    }));
    expect(result.map((row) => row.entry?.id)).toEqual(["sample/entry", "sample/entry"]);
  });

  it("derives stat metrics with a change and without one for the first point", () => {
    const first = entry({ id: "sample/first", kind: "stat", pursuits: ["cubing"], stat: { label: "ao5", value: 22.8, unit: "s" }, date: new Date("2026-10-20"), lastTouched: new Date("2026-10-20") });
    const latest = entry({ id: "sample/latest", kind: "stat", pursuits: ["cubing"], stat: { label: "ao5", value: 21.9, unit: "s" }, date: new Date("2026-10-28"), lastTouched: new Date("2026-10-28") });
    const gardenValue = garden({ pursuits: [pursuit("cubing", 1)], entries: [first, latest] });
    expect(statMetric(gardenValue, first, "cubing")).toEqual({ kind: "stat", label: "ao5", value: 22.8, unit: "s", change: undefined });
    expect(statMetric(gardenValue, latest, "cubing")).toEqual({ kind: "stat", label: "ao5", value: 21.9, unit: "s", change: -0.9 });
  });

  it("lets opts.now override garden.now", () => {
    const result = garden({ entries: [entry({ lastTouched: new Date("2026-10-20T12:00:00Z") })] });
    expect(currently(result)[0]?.state).toBe("latest");
    expect(currently(result, { now: new Date("2026-12-01T12:00:00Z") })[0]?.state).toBe("blurb");
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
    const feeds = await runFeeds(adapters, { env: {}, dev: true, now, fetch });
    const result = buildGarden({ pursuits, hand: [], feeds, now, samples: true });
    const rows = currently(result, { now: new Date("2026-11-02T17:00:00Z") });
    expect(rows.map((row) => [row.pursuit.id, row.state])).toEqual([
      ["films", "blurb"],
      ["board-games", "latest"],
      ["reading", "latest"],
      ["gaming", "latest"],
      ["music", "latest"],
      ["cubing", "blurb"],
    ]);
    expect(result.entries.find((entry) => entry.subject === "letterboxd:project-hail-mary")?.metric)
      .toEqual({ kind: "stars", value: 4.5 });
    expect(result.entries.find((entry) => entry.subject === "retroachievements:1")?.title).toBe("Super Metroid");
    expect(result.entries.find((entry) => entry.subject === "crosspoint:reading/0123456789abcdef0123456789abcdef")?.metric)
      .toEqual({ kind: "progress", value: 43 });
    expect(result.entries.find((entry) => entry.subject === "lastfm:sample-artist/sample-album")?.metric)
      .toEqual({ kind: "count", value: 31, unit: "plays" });
    expect(rows.map((row) => row.state === "latest" ? row.metric : undefined)).toEqual([
      undefined,
      { kind: "times", value: 2 },
      { kind: "progress", value: 43 },
      { kind: "count", value: 4, unit: "new" },
      { kind: "count", value: 31, unit: "plays" },
      undefined,
    ]);
  });
});
