import { describe, expect, it, vi } from "vitest";
import { runFeeds, type Adapter } from "./feeds";
import type { FeedThing } from "./schema";

const now = new Date("2026-11-02T17:00:00Z");
const thing: FeedThing = {
  subject: "sample:film",
  title: "Sample film",
  history: [{ at: new Date("2026-10-31T12:00:00Z"), verb: "watched" }],
  sample: true,
  kind: "note",
};
const failingFetch = vi.fn(async () => {
  throw new Error("network disabled in test");
}) as unknown as typeof fetch;

function makeAdapter(overrides: Partial<Adapter> = {}): Adapter {
  return {
    id: "sample-films",
    pursuit: "films",
    env: ["TOKEN"],
    live: vi.fn(async () => ({ source: "live" })),
    fixture: vi.fn(async () => ({ source: "fixture" })),
    parse: vi.fn(() => ({ things: [thing] })),
    ...overrides,
  };
}

function options(env: Record<string, string | undefined> = {}, dev = true) {
  return { env, dev, now, fetch: failingFetch, log: vi.fn() };
}

describe("runFeeds", () => {
  it("uses a fixture in dev when env is missing", async () => {
    const adapter = makeAdapter();
    const [result] = await runFeeds([adapter], options());
    expect(result).toMatchObject({ mode: "fixture", things: [thing] });
    expect(adapter.fixture).toHaveBeenCalledOnce();
    expect(adapter.live).not.toHaveBeenCalled();
  });

  it("is off in production when env is missing", async () => {
    const adapter = makeAdapter();
    const [result] = await runFeeds([adapter], options({}, false));
    expect(result).toMatchObject({ mode: "off", error: "missing env vars: TOKEN", things: [] });
    expect(adapter.fixture).not.toHaveBeenCalled();
    expect(adapter.live).not.toHaveBeenCalled();
  });

  it("uses live data when env is present", async () => {
    const adapter = makeAdapter();
    const [result] = await runFeeds([adapter], options({ TOKEN: "set" }, false));
    expect(result).toMatchObject({ mode: "live", things: [thing] });
    expect(adapter.live).toHaveBeenCalledOnce();
    expect(adapter.parse).toHaveBeenCalledOnce();
    expect(vi.mocked(adapter.live).mock.calls[0]?.[0].fetch).toBe(failingFetch);
  });

  it("falls off in production when live fails", async () => {
    const adapter = makeAdapter({ live: vi.fn(async () => { throw new Error("live unavailable"); }) });
    const [result] = await runFeeds([adapter], options({ TOKEN: "set" }, false));
    expect(result).toMatchObject({ mode: "off", error: "live unavailable", things: [] });
    expect(adapter.fixture).not.toHaveBeenCalled();
  });

  it("falls back to a fixture in dev when live fails", async () => {
    const adapter = makeAdapter({ live: vi.fn(async () => { throw new Error("live unavailable"); }) });
    const [result] = await runFeeds([adapter], options({ TOKEN: "set" }, true));
    expect(result).toMatchObject({ mode: "fixture", error: "live unavailable", things: [thing] });
    expect(adapter.fixture).toHaveBeenCalledOnce();
  });

  it("uses a real fixture in production when env is missing", async () => {
    const adapter = makeAdapter({ realFixture: true });
    const [result] = await runFeeds([adapter], options({}, false));
    expect(result).toMatchObject({ mode: "fixture", things: [thing] });
    expect(adapter.live).not.toHaveBeenCalled();
    expect(adapter.fixture).toHaveBeenCalledOnce();
  });

  it("drops invalid things and keeps valid ones", async () => {
    const adapter = makeAdapter({
      parse: vi.fn(() => ({ things: [thing, { subject: "invalid" } as FeedThing] })),
    });
    const [result] = await runFeeds([adapter], options());
    expect(result).toMatchObject({ dropped: 1, things: [thing] });
  });

  it("turns off when the fixture throws", async () => {
    const adapter = makeAdapter({ fixture: vi.fn(async () => { throw new Error("fixture unavailable"); }) });
    const [result] = await runFeeds([adapter], options());
    expect(result).toMatchObject({ mode: "off", error: "fixture unavailable", things: [] });
  });

  it("forces fixtures in production when FEEDS=fixtures", async () => {
    const adapter = makeAdapter();
    const [result] = await runFeeds([adapter], options({ FEEDS: "fixtures" }, false));
    expect(result).toMatchObject({ mode: "fixture", things: [thing] });
    expect(adapter.live).not.toHaveBeenCalled();
  });

  for (const [label, malformed] of [
    ["missing things", {}],
    ["non-array shelf", { things: [thing], shelf: {} }],
  ] as const) {
    it(`falls back when live parse output has ${label}`, async () => {
      const parse = vi.fn((_raw: unknown) => ({ things: [thing] }));
      parse.mockReturnValueOnce(malformed as never);
      const adapter = makeAdapter({ parse });
      const [result] = await runFeeds([adapter], options({ TOKEN: "set" }, true));
      expect(result).toMatchObject({ mode: "fixture", things: [thing] });
      expect(result?.error).toContain(label === "missing things" ? "things" : "shelf");
      expect(parse).toHaveBeenCalledTimes(2);
    });

    it(`resolves off in production when live parse output has ${label}`, async () => {
      const parse = vi.fn((_raw: unknown) => malformed as never);
      const adapter = makeAdapter({ parse });
      const [result] = await runFeeds([adapter], options({ TOKEN: "set" }, false));
      expect(result).toMatchObject({
        mode: "off",
        error: expect.stringContaining(label === "missing things" ? "things" : "shelf"),
      });
    });
  }

  it("turns off when fixture parse output has an invalid shape", async () => {
    const adapter = makeAdapter({ parse: vi.fn(() => ({} as never)) });
    const [result] = await runFeeds([adapter], options({ FEEDS: "fixtures" }, false));
    expect(result).toMatchObject({ mode: "off", things: [] });
    expect(result?.error).toContain("things");
  });

  it("enforces the timeout when a live adapter ignores its signal", async () => {
    const adapter = makeAdapter({ live: vi.fn(() => new Promise(() => {})) });
    const [result] = await runFeeds([adapter], { ...options({ TOKEN: "set" }, true), timeoutMs: 10 });
    expect(result).toMatchObject({ mode: "fixture", things: [thing] });
    expect(result?.error).toMatch(/timeout/i);
  });

  it("redacts configured secrets and their URL-encoded forms from errors and logs", async () => {
    const secret = "t+/=";
    const encoded = encodeURIComponent(secret);
    const opts = options({ TOKEN: secret }, false);
    const adapter = makeAdapter({ live: vi.fn(async () => { throw new Error(`HTTP 403 api_key=${secret} query=${encoded}`); }) });
    const [result] = await runFeeds([adapter], opts);
    expect(result?.error).toContain("***");
    expect(result?.error).not.toContain(secret);
    expect(result?.error).not.toContain(encoded);
    expect(opts.log).toHaveBeenCalledWith(expect.stringContaining("***"));
    expect(opts.log).not.toHaveBeenCalledWith(expect.stringContaining(encoded));
  });
});
