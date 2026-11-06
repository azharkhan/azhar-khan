import { describe, expect, it } from "vitest";
import { ledgerRow, metricView, reviewLine, stars } from "./ledger";
import { currently, type CurrentlyRow } from "../garden/query";
import type { Garden } from "../garden/build";
import type { GardenEntry, Pursuit } from "../garden/schema";

const lastTouched = new Date("2026-10-31T12:00:00Z");

function pursuit(id: string, fields: Partial<Pursuit> = {}): Pursuit {
  return { id, title: id === "cubing" ? "Cubing" : id, icon: "cube", colour: "none", since: 2020, blurb: `[placeholder: ${id} blurb]`, ...fields };
}

function entry(fields: Partial<GardenEntry> = {}): GardenEntry {
  return {
    id: "sample/entry", sources: ["sample"], kind: "note", title: "Sample title", pursuits: ["films"],
    date: lastTouched, lastTouched, long: false, history: [], tags: [], connected: [], sample: true,
    ...fields,
  };
}

function latest(rowFields: Partial<Extract<CurrentlyRow, { state: "latest" }>> = {}): CurrentlyRow {
  return {
    pursuit: pursuit("films", { title: "Films", verb: "Watching", colour: "red" }),
    state: "latest",
    entry: entry(),
    ...rowFields,
  };
}

function boardGame(id: string, title: string, plays: { at: Date; value?: number }[]): GardenEntry {
  return entry({
    id,
    sources: ["bgg"],
    kind: "note",
    title,
    href: `https://boardgamegeek.com/boardgame/${id.replace(/^bgg:/, "")}`,
    pursuits: ["board-games"],
    history: plays.map(({ at, value }) => ({ at, verb: "played", value })),
    lastTouched: plays.at(-1)?.at ?? lastTouched,
  });
}

function boardGamesRow(entries: GardenEntry[]) {
  const garden: Garden = {
    now: lastTouched,
    pursuits: [pursuit("board-games", { title: "Board games", verb: "Gaming", currently: 1 })],
    entries,
    feeds: [],
    shelf: [],
  };
  return ledgerRow(currently(garden)[0]!);
}

describe("star formatting", () => {
  it("renders full and half stars", () => {
    expect(stars(4.5)).toBe("★★★★½");
    expect(stars(3)).toBe("★★★");
    expect(stars(1)).toBe("★");
    expect(metricView({ kind: "stars", value: 4.5 })).toEqual({ kind: "stars", text: "★★★★½", label: "4.5 stars" });
    expect(metricView({ kind: "stars", value: 1 })).toEqual({ kind: "stars", text: "★", label: "1 star" });
  });
});

describe("metric views", () => {
  it("formats text metrics", () => {
    expect(metricView({ kind: "times", value: 2 })).toEqual({ kind: "text", text: "×2" });
    expect(metricView({ kind: "count", value: 4, unit: "new" })).toEqual({ kind: "text", text: "4 new" });
    expect(metricView({ kind: "count", value: 23, unit: "/80" })).toEqual({ kind: "text", text: "23/80" });
  });

  it("rounds and clamps progress", () => {
    expect(metricView({ kind: "progress", value: 43 })).toEqual({ kind: "progress", value: 43, text: "43%" });
    expect(metricView({ kind: "progress", value: 120 })).toEqual({ kind: "progress", value: 100, text: "100%" });
  });

  it("formats stats and changes", () => {
    const view = (change?: number) => metricView({ kind: "stat", label: "ao5", value: 21.9, unit: "s", change });
    expect(view(-0.9)).toEqual({ kind: "stat", text: "ao5 21.9s", change: "−0.9" });
    expect(view(0.4)).toEqual({ kind: "stat", text: "ao5 21.9s", change: "+0.4" });
    expect(view(0)).toEqual({ kind: "stat", text: "ao5 21.9s", change: "±0" });
    expect(view()).toEqual({ kind: "stat", text: "ao5 21.9s" });
  });
});

describe("review lines", () => {
  it("prefers the latest history text and takes its first line", () => {
    const result = reviewLine(entry({ history: [
      { at: new Date("2026-10-20T12:00:00Z"), verb: "watched", text: "Older review" },
      { at: lastTouched, verb: "watched", text: "Latest review\nSecond line" },
    ], thought: "fallback" }));
    expect(result).toEqual({ line: "Latest review", at: lastTouched });
  });

  it("falls back to the thought and returns undefined when empty", () => {
    expect(reviewLine(entry({ thought: "Thought line\nSecond line" }))).toEqual({ line: "Thought line", at: lastTouched });
    expect(reviewLine(entry({ thought: "  \n" }))).toBeUndefined();
  });
});

describe("ledger rows", () => {
  it("builds a film row and ticket stub with a UTC date", () => {
    const row = ledgerRow(latest({
      metric: { kind: "stars", value: 4.5 },
      entry: entry({ title: "Project Hail Mary", history: [{ at: lastTouched, verb: "watched", text: "[placeholder: review first line]" }] }),
    }));
    expect(row).toMatchObject({
      key: "films", label: "Watching", title: "Project Hail Mary", italic: true,
      metric: { kind: "stars", text: "★★★★½", label: "4.5 stars" },
      stub: { title: "Project Hail Mary", line: "[placeholder: review first line]", date: "31 Oct 2026", iso: "2026-10-31T12:00:00.000Z" },
    });
  });

  it("renders a cubing solve as minutes and seconds with its same-label change", () => {
    const previous = entry({
      id: "hand/previous-solve",
      kind: "stat",
      title: "Previous single",
      pursuits: ["cubing"],
      date: new Date("2026-10-20T12:00:00Z"),
      lastTouched: new Date("2026-10-20T12:00:00Z"),
      stat: { label: "single", value: 130, unit: "s" },
    });
    const current = entry({
      id: "hand/current-solve",
      kind: "stat",
      title: "Single",
      pursuits: ["cubing"],
      date: lastTouched,
      lastTouched,
      stat: { label: "single", value: 118, unit: "s" },
    });
    const garden: Garden = {
      now: lastTouched,
      pursuits: [pursuit("cubing", { title: "Cubing", currently: 1 })],
      entries: [previous, current],
      feeds: [],
      shelf: [],
    };
    const row = ledgerRow(currently(garden)[0]!);
    expect(row).toMatchObject({
      key: "cubing", label: "Solving", title: "3×3 Rubik’s Cube", href: "/garden/cubing/", external: false,
      metric: { kind: "stat", text: "1:58", change: "↓0:12" },
    });
    expect(row.detail).toBeUndefined();
  });

  it("formats cubing times in the metadata column and leaves other pursuit rows alone", () => {
    const solve = entry({
      kind: "stat",
      title: "Single",
      pursuits: ["cubing"],
      stat: { label: "single", value: 48.3, unit: "s" },
    });
    const garden: Garden = {
      now: lastTouched,
      pursuits: [pursuit("cubing", { title: "Cubing", currently: 1 })],
      entries: [solve],
      feeds: [],
      shelf: [],
    };
    expect(ledgerRow(currently(garden)[0]!)).toMatchObject({
      title: "3×3 Rubik’s Cube", metric: { kind: "stat", text: "48.3s" }, detail: undefined,
    });
    expect(ledgerRow(latest({ metric: { kind: "stat", label: "ao5", value: 21.9, unit: "s" } })))
      .toMatchObject({ label: "Watching", title: "Sample title", metric: { kind: "stat", text: "ao5 21.9s" } });
  });

  it("omits a ticket when stars have no review text", () => {
    const row = ledgerRow(latest({ metric: { kind: "stars", value: 3 } }));
    expect(row.metric).toEqual({ kind: "stars", text: "★★★", label: "3 stars" });
    expect(row.stub).toBeUndefined();
  });

  it.each([1, 3, 5])("shows up to three linked games from one game night (%i games)", (count) => {
    const games = Array.from({ length: count }, (_, index) => boardGame(
      `bgg:${index + 1}`,
      `Game ${index + 1}`,
      [{ at: new Date(lastTouched.getTime() - index * 1000) }],
    ));
    const row = boardGamesRow(games);
    const shown = Math.min(count, 3);
    expect(row.items).toEqual(games.slice(0, shown).map((game) => ({ title: game.title, href: game.href })));
    expect(row.title).toBeUndefined();
    expect(row.detail).toBeUndefined();
    expect(row.metric).toBeUndefined();
  });

  it("trims board-game titles before comma separation", () => {
    const row = ledgerRow(latest({
      pursuit: pursuit("board-games", { title: "Board games", verb: "Gaming" }),
      items: [
        { id: "one", title: "DECKO " },
        { id: "two", title: " Draft & Write Records " },
        { id: "three", title: " Sea Salt & Paper" },
      ],
    }));
    expect(row.items?.map((item) => item.title)).toEqual(["DECKO", "Draft & Write Records", "Sea Salt & Paper"]);
  });

  it("does not invent a link for a game-night item without an external URL", () => {
    const game = { ...boardGame("bgg:missing", "Unlinked game", [{ at: lastTouched }]), href: undefined };
    expect(boardGamesRow([game]).items).toEqual([{ title: "Unlinked game", href: undefined }]);
  });

  it("uses the pursuit label for no-entry blurbs", () => {
    const row = ledgerRow({
      pursuit: pursuit("films", { title: "Films", verb: "Watching" }),
      state: "blurb",
      blurb: "[placeholder: Films blurb]",
    });
    expect(row).toMatchObject({ key: "films", label: "Watching", blurb: "[placeholder: Films blurb]" });
    expect(row.title).toBeUndefined();
    expect(row.metric).toBeUndefined();
  });

  it("uses the pursuit title when there is no verb and only italics designated pursuits", () => {
    const cubing = ledgerRow({ pursuit: pursuit("cubing"), state: "blurb", blurb: "[placeholder: Cubing blurb]" });
    const boardGames = ledgerRow({ pursuit: pursuit("board-games", { title: "Board games" }), state: "blurb", blurb: "[placeholder: Board games blurb]" });
    expect(cubing).toMatchObject({ key: "cubing", label: "Cubing", icon: "cube", colour: "none", italic: false });
    expect(boardGames.italic).toBe(false);
  });

  it("links rows with an external source to that URL", () => {
    const href = "https://letterboxd.com/film/project-hail-mary/";
    const row = ledgerRow(latest({ entry: entry({ href }) }));
    expect(row).toMatchObject({ href, external: true });
  });

  it("links rows without an external source to their pursuit page", () => {
    const row = ledgerRow(latest({ entry: entry() }));
    expect(row).toMatchObject({ title: "Sample title", href: "/garden/films/", external: false });
  });
});
