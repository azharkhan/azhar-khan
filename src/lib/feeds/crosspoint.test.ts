import { describe, expect, it, vi } from "vitest";
import { crosspoint } from "./crosspoint";

const now = new Date("2026-11-02T17:00:00Z");
const env = { CROSSPOINT_USER: "u", CROSSPOINT_KEY: "k" };
const progress = { items: [] };
const activity = { books: [] };

describe("CrossPoint Sync adapter", () => {
  it("joins sample activity and progress and skips untitled documents", async () => {
    const output = crosspoint.parse(await crosspoint.fixture(), { now });
    const foundryside = output.things.find((thing) => thing.subject === "crosspoint:reading/0123456789abcdef0123456789abcdef");
    expect(foundryside).toMatchObject({
      title: "Foundryside",
      cover: "https://example.test/sample-foundryside-cover.jpg",
      metric: { kind: "progress", value: 43 },
      sample: true,
      history: [
        { at: new Date("2026-10-20T12:00:00Z"), verb: "started" },
        { at: new Date("2026-11-01T12:00:00Z"), verb: "progress", value: 43, unit: "%" },
      ],
    });
    const finished = output.things.find((thing) => thing.title === "Sample Finished Book");
    expect(finished).toMatchObject({
      metric: { kind: "progress", value: 100 },
      history: [
        { at: new Date("2026-09-01T12:00:00Z"), verb: "started" },
        { at: new Date("2026-09-20T12:00:00Z"), verb: "finished" },
      ],
    });
    expect(output.things).toHaveLength(2);
  });

  it("uses status timestamps for finished books and a timestamp for progress-only books", () => {
    const output = crosspoint.parse({
      sample: false,
      progress: { items: [
        { document: "reading/22222222222222222222222222222222", title: "Sample Status Finished Book", percentage: 0.6, timestamp: 1793534400, status: "finished", status_at: 1793000000 },
        { document: "reading/33333333333333333333333333333333", title: "Sample Progress Only Book", percentage: 0.23, timestamp: 1793534400, status: "reading" },
      ] },
      activity: { books: [
        { document: "reading/22222222222222222222222222222222", started_at: null, last_at: null, percentage: 0.6, finished_at: null },
      ] },
    }, { now });
    expect(output.things[0]).toMatchObject({
      metric: { kind: "progress", value: 100 },
      history: [{ at: new Date(1793000000 * 1000), verb: "finished" }],
    });
    expect(output.things[1]).toMatchObject({
      metric: { kind: "progress", value: 23 },
      history: [{ at: new Date("2026-11-01T12:00:00Z"), verb: "progress", value: 23, unit: "%" }],
    });
  });

  it("sends auth headers to the default and configured URLs", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify(String(input).includes("/progress?") ? progress : activity));
    }) as unknown as typeof globalThis.fetch;
    const signal = new AbortController().signal;
    const raw = await crosspoint.live({ env, now, fetch, signal });
    expect(raw.sample).toBe(false);
    expect(calls.map((call) => call.url)).toEqual([
      "https://sync.crosspointreader.com/api/v1/progress?limit=100",
      "https://sync.crosspointreader.com/api/v1/stats/activity?tz=0",
    ]);
    expect(calls.every(({ headers }) => headers.get("x-auth-user") === "u" && headers.get("x-auth-key") === "k")).toBe(true);

    calls.length = 0;
    await crosspoint.live({ env: { ...env, CROSSPOINT_URL: "https://example.test/" }, now, fetch, signal });
    expect(calls.map((call) => call.url)).toEqual([
      "https://example.test/api/v1/progress?limit=100",
      "https://example.test/api/v1/stats/activity?tz=0",
    ]);
  });

  it("does not expose the auth key in HTTP errors", async () => {
    const fetch = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof globalThis.fetch;
    await expect(crosspoint.live({ env, now, fetch, signal: new AbortController().signal }))
      .rejects.toThrow("HTTP 401 https://sync.crosspointreader.com/api/v1/progress");
  });
});
