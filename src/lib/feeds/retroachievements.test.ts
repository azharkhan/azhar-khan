import { describe, expect, it, vi } from "vitest";
import { retroachievements } from "./retroachievements";

const now = new Date("2026-11-02T17:00:00Z");

describe("RetroAchievements adapter", () => {
  it("groups sample unlocks by UTC day, adds awards, and ignores points awards", async () => {
    const raw = await retroachievements.fixture();
    const output = retroachievements.parse(raw, { now });
    const superMetroid = output.things.find((thing) => thing.subject === "retroachievements:1");
    expect(superMetroid).toMatchObject({
      title: "Super Metroid",
      href: "https://retroachievements.org/game/1",
      cover: "https://media.retroachievements.org/Images/000001.png",
      metric: { kind: "count", value: 4, unit: "new" },
      sample: true,
      history: [
        { at: new Date("2026-10-29T19:12:00Z"), verb: "unlocked", value: 1, unit: "achievements" },
        { at: new Date("2026-10-30T20:24:00Z"), verb: "unlocked", value: 1, unit: "achievements" },
        { at: new Date("2026-10-31T21:36:00Z"), verb: "unlocked", value: 1, unit: "achievements" },
        { at: new Date("2026-11-01T22:48:00Z"), verb: "unlocked", value: 1, unit: "achievements" },
        { at: new Date("2026-11-01T22:50:00Z"), verb: "beaten" },
      ],
    });
    const awardOnly = output.things.find((thing) => thing.subject === "retroachievements:2");
    expect(awardOnly).toMatchObject({ title: "Sample RA Game", history: [{ verb: "mastered" }] });
    expect(awardOnly?.metric).toBeUndefined();
    expect(output.things).toHaveLength(2);
  });

  it("aggregates multiple unlocks on the same UTC day", () => {
    const output = retroachievements.parse({
      sample: false,
      recent: [
        { Date: "2026-11-01 20:00:00", GameID: 8, GameTitle: "Sample RA Game", GameIcon: "/Images/000008.png", ConsoleName: "Sample console", Title: "Sample achievement one" },
        { Date: "2026-11-01 22:00:00", GameID: 8, GameTitle: "Sample RA Game", GameIcon: "/Images/000008.png", ConsoleName: "Sample console", Title: "Sample achievement two" },
      ],
      awards: { VisibleUserAwards: [] },
    }, { now });
    expect(output.things[0]).toMatchObject({
      metric: { kind: "count", value: 2, unit: "new" },
      history: [{ at: new Date("2026-11-01T22:00:00Z"), verb: "unlocked", value: 2, unit: "achievements" }],
    });
  });

  it("maps completion awards with no mastery to completed", () => {
    const output = retroachievements.parse({
      sample: false,
      recent: [],
      awards: { VisibleUserAwards: [
        { AwardType: "Mastery/Completion", AwardData: 9, AwardDataExtra: 0, AwardedAt: "2026-09-01T12:00:00+00:00", Title: "Sample Completed Game", ImageIcon: "/Images/000009.png" },
      ] },
    }, { now });
    expect(output.things[0]).toMatchObject({ subject: "retroachievements:9", history: [{ verb: "completed" }] });
  });

  it("filters non-game awards before validating nullable metadata and honors ISO offsets", () => {
    const output = retroachievements.parse({
      sample: false,
      recent: [],
      awards: { VisibleUserAwards: [
        { AwardType: "Site Award", AwardData: 8, AwardedAt: "invalid", Title: null, ImageIcon: null },
        { AwardType: "Mastery/Completion", AwardData: 9, AwardDataExtra: 0, AwardedAt: "2026-09-01T14:00:00+02:00", Title: "Sample Completed Game", ImageIcon: null },
      ] },
    }, { now });
    expect(output.things).toHaveLength(1);
    expect(output.things[0]).toMatchObject({
      subject: "retroachievements:9",
      title: "Sample Completed Game",
      history: [{ at: new Date("2026-09-01T12:00:00Z"), verb: "completed" }],
    });
    expect(output.things[0]?.cover).toBeUndefined();
  });

  it("requests recent achievements and awards with the configured query parameters", async () => {
    const calls: URL[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const url = new URL(String(input));
      calls.push(url);
      return new Response(JSON.stringify(url.pathname.endsWith("RecentAchievements.php") ? [] : { VisibleUserAwards: [] }));
    }) as unknown as typeof globalThis.fetch;
    const raw = await retroachievements.live({ env: { RA_USER: "u", RA_KEY: "k" }, now, fetch, signal: new AbortController().signal });
    expect(raw.sample).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls.map((url) => url.pathname)).toEqual([
      "/API/API_GetUserRecentAchievements.php",
      "/API/API_GetUserAwards.php",
    ]);
    expect(calls.map((url) => Object.fromEntries(url.searchParams))).toEqual([
      { u: "u", y: "k", m: "43200" },
      { u: "u", y: "k" },
    ]);
  });

  it("rejects a non-array recent response", () => {
    expect(() => retroachievements.parse({ sample: false, recent: { message: "Sample error" }, awards: { VisibleUserAwards: [] } }, { now }))
      .toThrow("unexpected RetroAchievements response");
  });
});
