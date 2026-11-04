import { describe, expect, it } from "vitest";
import { ledgerRow, metricView, reviewLine, stars } from "./ledger";
import type { CurrentlyRow } from "../garden/query";
import type { GardenEntry, Pursuit } from "../garden/schema";

const lastTouched = new Date("2026-10-31T12:00:00Z");

function pursuit(id: string, fields: Partial<Pursuit> = {}): Pursuit {
  return { id, title: id === "cubing" ? "Cubing" : id, icon: "cube", colour: "none", since: 2020, blurb: `[placeholder: ${id} blurb]`, kit: [], ...fields };
}

function entry(fields: Partial<GardenEntry> = {}): GardenEntry {
  return {
    id: "sample/entry", sources: ["sample"], kind: "note", title: "Sample title", pursuits: ["films"],
    date: lastTouched, lastTouched, growth: "budding", long: false, history: [], tags: [], connected: [], sample: true,
    ...fields,
  };
}

function latest(rowFields: Partial<Extract<CurrentlyRow, { state: "latest" }>> = {}): CurrentlyRow {
  return {
    pursuit: pursuit("films", { title: "Films", verb: "Watched", colour: "red" }),
    state: "latest",
    entry: entry(),
    ...rowFields,
  };
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
      key: "films", label: "Watched", title: "Project Hail Mary", italic: true,
      metric: { kind: "stars", text: "★★★★½", label: "4.5 stars" },
      stub: { title: "Project Hail Mary", line: "[placeholder: review first line]", date: "31 Oct 2026", iso: "2026-10-31T12:00:00.000Z" },
    });
  });

  it("omits a ticket when stars have no review text", () => {
    const row = ledgerRow(latest({ metric: { kind: "stars", value: 3 } }));
    expect(row.metric).toEqual({ kind: "stars", text: "★★★", label: "3 stars" });
    expect(row.stub).toBeUndefined();
  });

  it("labels stale blurbs with the pursuit title", () => {
    const row = ledgerRow({
      pursuit: pursuit("films", { title: "Films", verb: "Watched" }),
      state: "blurb",
      blurb: "[placeholder: Films blurb]",
    });
    expect(row).toMatchObject({ key: "films", label: "Films", blurb: "[placeholder: Films blurb]" });
    expect(row.title).toBeUndefined();
    expect(row.metric).toBeUndefined();
  });

  it("uses the pursuit title when there is no verb and only italics designated pursuits", () => {
    const cubing = ledgerRow({ pursuit: pursuit("cubing"), state: "blurb", blurb: "[placeholder: Cubing blurb]" });
    const boardGames = ledgerRow({ pursuit: pursuit("board-games", { title: "Board games" }), state: "blurb", blurb: "[placeholder: Board games blurb]" });
    expect(cubing).toMatchObject({ key: "cubing", label: "Cubing", icon: "cube", colour: "none", italic: false });
    expect(boardGames.italic).toBe(false);
  });

  it("passes entry links through", () => {
    const row = ledgerRow(latest({ entry: entry({ href: "https://example.com" }) }));
    expect(row.href).toBe("https://example.com");
  });
});
