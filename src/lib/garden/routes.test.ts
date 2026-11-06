import { describe, expect, it } from "vitest";
import type { GardenEntry } from "./schema";
import { entryPath, entryPaths, pursuitPath } from "./routes";

function entry(id: string, pursuits: string[]): GardenEntry {
  return {
    id,
    sources: [],
    kind: "note",
    title: id,
    pursuits,
    date: new Date("2026-01-01T00:00:00Z"),
    lastTouched: new Date("2026-01-01T00:00:00Z"),
    long: false,
    history: [],
    tags: [],
    connected: [],
    sample: false,
  };
}

const pathsFor = (...entries: GardenEntry[]) => entryPaths({ entries });

describe("garden routes", () => {
  it("builds pursuit and primary-pursuit entry paths", () => {
    expect(pursuitPath("films")).toBe("/garden/films/");
    const paths = pathsFor(entry("films/project-hail-mary", ["films"]), entry("sample/sample-long-form", ["board-games", "3d-printing"]));
    expect(entryPath(paths, "films/project-hail-mary")).toBe("/garden/films/project-hail-mary/");
    expect(entryPath(paths, "sample/sample-long-form")).toBe("/garden/board-games/sample-long-form/");
  });

  it("resolves same-pursuit slug collisions by sorted id, regardless of input order", () => {
    const entries = [entry("z/x", ["board-games"]), entry("a/x", ["board-games"])];
    const first = pathsFor(...entries);
    const second = pathsFor(...entries.reverse());
    expect(entryPath(first, "a/x")).toBe("/garden/board-games/x/");
    expect(entryPath(first, "z/x")).toBe("/garden/board-games/x-2/");
    expect([...first]).toEqual([...second]);
  });

  it("allows the same slug in different pursuits", () => {
    const paths = pathsFor(entry("films/x", ["films"]), entry("reading/x", ["reading"]));
    expect(entryPath(paths, "films/x")).toBe("/garden/films/x/");
    expect(entryPath(paths, "reading/x")).toBe("/garden/reading/x/");
  });

  it("throws when asked for an unknown entry", () => {
    expect(() => entryPath(pathsFor(), "missing/x")).toThrow("unknown garden entry: missing/x");
  });
});
