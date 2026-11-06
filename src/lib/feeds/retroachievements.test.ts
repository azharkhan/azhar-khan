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
        { at: new Date("2026-11-01T22:49:00Z"), verb: "played" },
        { at: new Date("2026-11-01T22:50:00Z"), verb: "beaten" },
      ],
    });
    const awardOnly = output.things.find((thing) => thing.subject === "retroachievements:2");
    expect(awardOnly).toMatchObject({ title: "Sample RA Game", history: [{ verb: "mastered" }] });
    expect(awardOnly?.metric).toBeUndefined();
    const olderProgress = output.things.find((thing) => thing.subject === "retroachievements:4");
    expect(olderProgress).toMatchObject({
      title: "Sample Older Progress Game",
      metric: { kind: "count", value: 23, unit: "/80" },
      history: [{ at: new Date("2026-10-10T09:15:00Z"), verb: "played" }],
    });
    const noAchievements = output.things.find((thing) => thing.subject === "retroachievements:5");
    expect(noAchievements).toMatchObject({ title: "Sample No-Achievements Game", history: [{ verb: "played" }] });
    expect(noAchievements?.metric).toBeUndefined();
    const nullFields = output.things.find((thing) => thing.subject === "retroachievements:6");
    expect(nullFields).toMatchObject({ title: "Sample Null-Fields Game", history: [{ verb: "played" }] });
    expect(nullFields?.cover).toBeUndefined();
    expect(nullFields?.metric).toBeUndefined();
    expect(output.things).toHaveLength(5);
  });

  it("aggregates multiple unlocks on the same UTC day", () => {
    const output = retroachievements.parse({
      sample: false,
      recent: [
        { Date: "2026-11-01 20:00:00", GameID: 8, GameTitle: "Sample RA Game", GameIcon: "/Images/000008.png", ConsoleName: "Sample console", Title: "Sample achievement one" },
        { Date: "2026-11-01 22:00:00", GameID: 8, GameTitle: "Sample RA Game", GameIcon: "/Images/000008.png", ConsoleName: "Sample console", Title: "Sample achievement two" },
      ],
      played: [],
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
      played: [],
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
      played: [],
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

  it("skips recently-played rows without an ID, title, or usable timestamp", () => {
    const output = retroachievements.parse({
      sample: false,
      recent: [],
      played: [
        { GameID: null, Title: "Sample Missing ID", LastPlayed: "2026-11-01 12:00:00" },
        { GameID: 10, Title: null, LastPlayed: "2026-11-01 12:00:00" },
        { GameID: 11, Title: "Sample Missing Date", LastPlayed: null },
        { GameID: 12, Title: "Sample ISO Date", LastPlayed: "2026-11-01T12:00:00Z", NumPossibleAchievements: "10", NumAchieved: "3" },
      ],
      awards: { VisibleUserAwards: [] },
    }, { now });
    expect(output.things).toMatchObject([{
      subject: "retroachievements:12",
      title: "Sample ISO Date",
      metric: { kind: "count", value: 3, unit: "/10" },
      history: [{ at: new Date("2026-11-01T12:00:00Z"), verb: "played" }],
    }]);
  });

  it("requests recent achievements, awards, and recently played games with the configured query parameters", async () => {
    const calls: URL[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).get("User-Agent")).toBe("azharkhan.net/0.0.0 (https://azharkhan.net)");
      const url = new URL(String(input));
      calls.push(url);
      const body = url.pathname.endsWith("RecentAchievements.php")
        ? []
        : url.pathname.endsWith("UserAwards.php")
          ? { VisibleUserAwards: [] }
          : [];
      return new Response(JSON.stringify(body));
    }) as unknown as typeof globalThis.fetch;
    const raw = await retroachievements.live({ env: { RA_USER: "u", RA_KEY: "k" }, now, fetch, signal: new AbortController().signal });
    expect(raw.sample).toBe(false);
    expect(calls).toHaveLength(3);
    expect(calls.map((url) => url.pathname)).toEqual([
      "/API/API_GetUserRecentAchievements.php",
      "/API/API_GetUserAwards.php",
      "/API/API_GetUserRecentlyPlayedGames.php",
    ]);
    expect(calls.map((url) => Object.fromEntries(url.searchParams))).toEqual([
      { u: "u", y: "k", m: "43200" },
      { u: "u", y: "k" },
      { u: "u", y: "k", c: "50" },
    ]);
  });

  it("rejects a non-array recent response", () => {
    expect(() => retroachievements.parse({ sample: false, recent: { message: "Sample error" }, played: [], awards: { VisibleUserAwards: [] } }, { now }))
      .toThrow("unexpected RetroAchievements response");
  });
});
