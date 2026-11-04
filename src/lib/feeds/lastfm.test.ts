import { describe, expect, it, vi } from "vitest";
import { lastfm, MIN_ALBUM_PLAYS, WEEKS } from "./lastfm";

const now = new Date("2026-11-02T17:00:00Z");

describe("Last.fm adapter", () => {
  it("groups qualifying top albums and parses a single album object", async () => {
    const output = lastfm.parse(await lastfm.fixture(), { now });
    const sampleAlbum = output.things.find((thing) => thing.subject === "lastfm:sample-artist/sample-album");
    expect(sampleAlbum).toMatchObject({
      title: "Sample Album",
      href: "https://www.last.fm/music/Sample+Artist/_/Sample+Album",
      cover: "https://example.test/sample-album-large.jpg",
      metric: { kind: "count", value: 31, unit: "plays" },
      sample: true,
      history: [
        { at: new Date("2026-10-18T12:00:00Z"), verb: "top-album-week", value: 23, unit: "plays", text: "Sample Artist" },
        { at: new Date("2026-11-01T12:00:00Z"), verb: "top-album-week", value: 31, unit: "plays", text: "Sample Artist" },
      ],
    });
    expect(output.things.find((thing) => thing.title === "Sample Single Album")?.history).toHaveLength(1);
    expect(output.things.some((thing) => thing.title === "Sample Low Play Album")).toBe(false);
    expect(MIN_ALBUM_PLAYS).toBe(10);
    expect(WEEKS).toBe(4);
  });

  it("requests the last four completed weekly album charts and skips a future range", async () => {
    const ranges = [1791115200, 1791720000, 1792324800, 1792929600, 1793534400, 1794139200];
    const calls: URL[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const url = new URL(String(input));
      calls.push(url);
      if (url.searchParams.get("method") === "user.getweeklychartlist") {
        return new Response(JSON.stringify({ weeklychartlist: { chart: ranges.map((to) => ({ from: to - 604800, to })) } }));
      }
      return new Response(JSON.stringify({ weeklyalbumchart: { album: [] } }));
    }) as unknown as typeof globalThis.fetch;
    const raw = await lastfm.live({ env: { LASTFM_USER: "u", LASTFM_API_KEY: "k" }, now, fetch, signal: new AbortController().signal });
    expect(raw.weeks.map((week) => week.to)).toEqual(ranges.slice(1, 5));
    expect(calls).toHaveLength(5);
    expect(Object.fromEntries(calls[0]!.searchParams)).toMatchObject({
      method: "user.getweeklychartlist", user: "u", api_key: "k", format: "json",
    });
    expect(calls.slice(1).map((url) => url.searchParams.get("to"))).toEqual(ranges.slice(1, 5).map(String));
  });

  it("surfaces Last.fm API errors", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 10, message: "Sample API error" }))) as unknown as typeof globalThis.fetch;
    await expect(lastfm.live({ env: { LASTFM_USER: "u", LASTFM_API_KEY: "k" }, now, fetch, signal: new AbortController().signal }))
      .rejects.toThrow("Last.fm error 10: Sample API error");
  });
});
