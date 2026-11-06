import { describe, expect, it } from "vitest";
import { z } from "astro/zod";
import { longDate } from "../dates";
import { buildGarden } from "./build";
import { entrySchema, type FeedThing, type HandEntry, type Pursuit } from "./schema";
import type { FeedResult } from "./feeds";

const now = new Date("2026-11-02T17:00:00Z");
const testEntrySchema = entrySchema(z.string());

function pursuit(id: string, currently?: number): Pursuit {
  return {
    id,
    title: id,
    icon: "book-open-text",
    colour: "none",
    since: 2020,
    blurb: `[placeholder: ${id} blurb]`,
    currently,
  };
}

function hand(id: string, fields: Record<string, unknown> = {}, body?: string): HandEntry {
  return {
    id,
    body,
    data: testEntrySchema.parse({
      title: "Sample hand entry",
      kind: "note",
      pursuits: ["films"],
      date: "2026-10-01T00:00:00Z",
      ...fields,
    }),
  };
}

function thing(fields: Partial<FeedThing> = {}): FeedThing {
  return {
    subject: "sample:film",
    kind: "note",
    title: "Sample film",
    history: [{ at: new Date("2026-10-20T12:00:00Z"), verb: "watched" }],
    sample: true,
    ...fields,
  };
}

function feed(things: FeedThing[], fields: Partial<FeedResult> = {}): FeedResult {
  return {
    adapter: "sample-films",
    pursuit: "films",
    mode: "fixture",
    dropped: 0,
    things,
    ...fields,
  };
}

describe("buildGarden", () => {
  it("normalizes date-only hand dates to noon", () => {
    const garden = buildGarden({
      pursuits: [pursuit("films")],
      hand: [hand("sample/date", { date: "2026-10-24", updated: "2026-10-25" })],
      feeds: [],
      now,
      samples: true,
    });
    const entry = garden.entries[0]!;
    expect(entry.date.toISOString()).toBe("2026-10-24T12:00:00.000Z");
    expect(longDate(entry.date)).toBe("24 October 2026");
    expect(entry.lastTouched.toISOString()).toBe("2026-10-25T12:00:00.000Z");
  });

  it("merges a hand entry by subject with feed history and last touch", () => {
    const garden = buildGarden({
      pursuits: [pursuit("films")],
      hand: [hand("sample/thought", { title: "My hand title", subject: "sample:film", dek: "[placeholder: dek]" }, "  [placeholder: longer thought]  ")],
      feeds: [feed([thing()])],
      now,
      samples: true,
    });
    expect(garden.entries).toHaveLength(1);
    expect(garden.entries[0]).toMatchObject({
      id: "sample/thought",
      title: "My hand title",
      sources: ["hand", "sample-films"],
      history: [{ verb: "watched" }],
      lastTouched: new Date("2026-10-20T12:00:00Z"),
      body: "[placeholder: longer thought]",
      dek: "[placeholder: dek]",
    });
  });

  it("detects a long feed thought as long-form", () => {
    const thought = Array.from({ length: 400 }, () => "review").join(" ");
    const garden = buildGarden({
      pursuits: [pursuit("films")],
      hand: [],
      feeds: [feed([thing({ thought })])],
      now,
      samples: true,
    });
    expect(garden.entries[0]).toMatchObject({ long: true, thought });
  });

  it("preserves feed stats when a hand override has no stat", () => {
    const stat = { label: "score", value: 4 };
    const garden = buildGarden({
      pursuits: [pursuit("films")],
      hand: [hand("sample/thought", { subject: "sample:film" })],
      feeds: [feed([thing({ stat })])],
      now,
      samples: true,
    });
    expect(garden.entries[0]?.stat).toEqual(stat);
  });

  it("appends unique repeat events for things with the same adapter and subject", () => {
    const garden = buildGarden({
      pursuits: [pursuit("films")],
      hand: [],
      feeds: [feed([
        thing(),
        thing({
          title: "Sample film updated",
          history: [
            { at: new Date("2026-10-20T12:00:00Z"), verb: "watched" },
            { at: new Date("2026-10-25T12:00:00Z"), verb: "watched" },
          ],
        }),
      ])],
      now,
      samples: true,
    });
    expect(garden.entries).toHaveLength(1);
    expect(garden.entries[0]?.title).toBe("Sample film updated");
    expect(garden.entries[0]?.history.map((event) => event.at.toISOString())).toEqual([
      "2026-10-20T12:00:00.000Z",
      "2026-10-25T12:00:00.000Z",
    ]);
  });

  it("removes hidden hand entries, including a hidden subject override", () => {
    const garden = buildGarden({
      pursuits: [pursuit("films")],
      hand: [
        hand("sample/hidden", { hidden: true }),
        hand("sample/hidden-film", { hidden: true, subject: "sample:film" }),
      ],
      feeds: [feed([thing()])],
      now,
      samples: true,
    });
    expect(garden.entries).toEqual([]);
  });

  it("excludes sample hand entries, feed things and sample shelves when samples are disabled", () => {
    const sampleShelf = { id: "sample-game", name: "Sample game", minPlayers: 1, maxPlayers: 2, minutes: 30, plays: 0 };
    const input = {
      pursuits: [pursuit("films")],
      hand: [hand("sample/hand", { sample: true })],
      feeds: [feed([thing()], { adapter: "bgg", shelf: [sampleShelf] })],
      now,
    };
    const withoutSamples = buildGarden({ ...input, samples: false });
    const withSamples = buildGarden({ ...input, samples: true });
    expect(withoutSamples.entries).toEqual([]);
    expect(withoutSamples.shelf).toEqual([]);
    expect(withSamples.shelf).toEqual([sampleShelf]);
  });

  it("throws for an unknown pursuit in an entry", () => {
    expect(() => buildGarden({
      pursuits: [pursuit("films")],
      hand: [hand("sample/entry", { pursuits: ["unknown"] })],
      feeds: [],
      now,
      samples: true,
    })).toThrow("entry sample/entry: unknown pursuit unknown");
  });

  it("throws when two hand entries share a subject", () => {
    expect(() => buildGarden({
      pursuits: [pursuit("films")],
      hand: [hand("sample/one", { subject: "sample:film" }), hand("sample/two", { subject: "sample:film" })],
      feeds: [],
      now,
      samples: true,
    })).toThrow("duplicate hand subject: sample:film");
  });

  it("throws for duplicate Currently positions", () => {
    expect(() => buildGarden({
      pursuits: [pursuit("films", 1), pursuit("reading", 1)],
      hand: [],
      feeds: [],
      now,
      samples: true,
    })).toThrow("duplicate currently value: 1");
  });

  it("keeps an entry in both pursuits", () => {
    const garden = buildGarden({
      pursuits: [pursuit("films"), pursuit("reading")],
      hand: [hand("sample/multi", { pursuits: ["films", "reading"] })],
      feeds: [],
      now,
      samples: true,
    });
    expect(garden.entries[0]?.pursuits).toEqual(["films", "reading"]);
  });

  it("suffixes colliding feed ids", () => {
    const garden = buildGarden({
      pursuits: [pursuit("films")],
      hand: [hand("films/film")],
      feeds: [feed([thing()])],
      now,
      samples: true,
    });
    expect(garden.entries.map((entry) => entry.id).sort()).toEqual(["films/film", "films/film-2"]);
  });

  it("uses a stable hash id when the subject slug has no ASCII characters", () => {
    const input = {
      pursuits: [pursuit("films")],
      hand: [],
      feeds: [feed([thing({ subject: "sample:東京" })])],
      now,
      samples: true,
    };
    const first = buildGarden(input).entries[0]?.id;
    const second = buildGarden(input).entries[0]?.id;
    expect(first).toMatch(/^films\/item-[0-9a-f]{8}$/);
    expect(second).toBe(first);
  });

  it("sorts entries by last touch descending and then id", () => {
    const garden = buildGarden({
      pursuits: [pursuit("films")],
      hand: [
        hand("sample/z", { date: "2026-10-10T00:00:00Z" }),
        hand("sample/b", { date: "2026-10-20T00:00:00Z" }),
        hand("sample/a", { date: "2026-10-20T00:00:00Z" }),
      ],
      feeds: [],
      now,
      samples: true,
    });
    expect(garden.entries.map((entry) => entry.id)).toEqual(["sample/a", "sample/b", "sample/z"]);
  });
});
