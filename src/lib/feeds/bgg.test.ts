import { describe, expect, it, vi } from "vitest";
import { createBggAdapter } from "./bgg";
import type { ShelfGame } from "../garden/schema";

const now = new Date("2026-11-02T17:00:00Z");
const bgg = createBggAdapter({ retryDelayMs: 0 });

function parse(raw: Parameters<typeof bgg.parse>[0]) {
  return bgg.parse(raw, { now });
}

const emptyCollection = '<items totalitems="0" />';

function playsXml(rows: string[], total = rows.length) {
  return `<plays username="sample" total="${total}" page="1">${rows.join("")}</plays>`;
}

describe("BoardGameGeek adapter", () => {
  it("parses the sample shelf, owned history, and played games", async () => {
    const output = parse(await bgg.fixture());
    const shelf = output.shelf as ShelfGame[];
    const things = output.things;
    expect(shelf).toHaveLength(7);
    expect(shelf[0]).toMatchObject({
      id: "224517",
      name: "Brass: Birmingham",
      minPlayers: 2,
      maxPlayers: 4,
      minutes: 120,
      plays: 0,
      href: "https://boardgamegeek.com/boardgame/224517",
    });
    expect(shelf.find((game) => game.name === "Sample Game A")?.rating).toBe(7.5);

    const cascadia = things.find((thing) => thing.subject === "bgg:295947");
    expect(cascadia).toMatchObject({
      title: "Cascadia",
      metric: { kind: "times", value: 2 },
      thought: "[placeholder: sample play comment]",
      history: [
        { verb: "added", at: new Date("2026-06-01T12:00:00Z") },
        { verb: "played", at: new Date("2026-10-30T12:00:00Z"), value: 1 },
        { verb: "played", at: new Date("2026-10-31T12:00:00Z"), value: 1, text: "[placeholder: sample play comment]" },
      ],
    });
    const borrowed = things.find((thing) => thing.subject === "bgg:900008");
    expect(borrowed?.title).toBe("Sample Borrowed Game");
    expect(borrowed?.history.some((event) => event.verb === "added")).toBe(false);
    expect(shelf.some((game) => game.name === "Sample Borrowed Game")).toBe(false);

    const unplayed = things.find((thing) => thing.subject === "bgg:224517");
    expect(unplayed?.history.map((event) => event.verb)).toEqual(["added"]);
    expect(unplayed?.metric).toBeUndefined();
  });

  it("turns imported BG Stats plays into shared BGG history with counts and shelf covers", () => {
    const output = parse({
      sample: false,
      collection: "",
      plays: [],
      fallback: {
        plays: [
          { id: "123", name: "Imported Game", date: "2026-10-01", thumb: "https://cf.geekdo-images.com/imported-game.jpg" },
          { id: "123", name: "Imported Game", date: "2026-10-01" },
          { id: "123", name: "Imported Game", date: "2026-10-02" },
          { id: "456", name: "Other Imported Game", date: "2026-10-03" },
        ],
        shelf: [{
          id: "123", name: "Shelf Game Name", minPlayers: 1, maxPlayers: 4, minutes: 30, plays: 0,
          cover: "https://covers.example.test/imported-game.jpg",
        }],
      },
    });

    expect(output.shelf).toHaveLength(1);
    expect(output.things).toHaveLength(2);
    expect(output.things[0]).toMatchObject({
      subject: "bgg:123",
      title: "Imported Game",
      href: "https://boardgamegeek.com/boardgame/123",
      cover: "https://cf.geekdo-images.com/imported-game.jpg",
      metric: { kind: "times", value: 3 },
      sample: false,
      history: [
        { at: new Date("2026-10-01T12:00:00Z"), verb: "played", value: 2 },
        { at: new Date("2026-10-02T12:00:00Z"), verb: "played", value: 1 },
      ],
    });
    expect(output.things[1]).toMatchObject({
      subject: "bgg:456",
      title: "Other Imported Game",
      metric: { kind: "times", value: 1 },
      history: [{ at: new Date("2026-10-03T12:00:00Z"), verb: "played", value: 1 }],
    });
    expect(output.things.every((thing) => !thing.history.some((event) => event.verb === "added"))).toBe(true);
  });

  it("combines plays on the same date and joins non-empty comments", () => {
    const raw = {
      sample: true,
      collection: emptyCollection,
      plays: [playsXml([
        '<play date="2026-10-01" quantity="1"><item name="Sample Test Game" objectid="999" /><comments>Sample comment one</comments></play>',
        '<play date="2026-10-01" quantity="1"><item name="Sample Test Game" objectid="999" /><comments>Sample comment two</comments></play>',
      ])],
    };
    const thing = parse(raw).things[0];
    expect(thing?.history).toEqual([{
      at: new Date("2026-10-01T12:00:00Z"),
      verb: "played",
      value: 2,
      text: "Sample comment one\nSample comment two",
    }]);
    expect(thing?.thought).toBe("Sample comment one\nSample comment two");
  });

  it("prefers resolved medium covers, including for unowned played games", () => {
    const cover = "https://cf.geekdo-images.com/x__medium/img/y=/fit-in/500x500/pic1.jpg";
    const raw = {
      sample: true,
      collection: emptyCollection,
      plays: [playsXml(['<play date="2026-10-01" quantity="1"><item name="Sample Test Game" objectid="999" /></play>'])],
      covers: { "999": cover },
    };
    expect(parse(raw).things[0]?.cover).toBe(cover);
  });

  it("retries queued collection responses and fetches only the needed play pages", async () => {
    let collectionCalls = 0;
    const pageOne = playsXml(Array.from({ length: 100 }, (_, index) =>
      `<play date="2026-10-01" quantity="1"><item name="Sample Game ${index}" objectid="${index}" /></play>`), 150);
    const pageTwo = playsXml([], 150);
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer t");
      const url = String(input);
      if (url.includes("/collection?")) {
        collectionCalls++;
        if (collectionCalls < 3) return new Response("queued", { status: 202 });
        return new Response(emptyCollection);
      }
      if (url.endsWith("page=1")) return new Response(pageOne);
      if (url.endsWith("page=2")) return new Response(pageTwo);
      throw new Error("unexpected BGG URL");
    }) as unknown as typeof globalThis.fetch;
    const adapter = createBggAdapter({ retryDelayMs: 0 });
    const raw = await adapter.live({ env: { BGG_TOKEN: "t" }, now, fetch, signal: new AbortController().signal });
    expect(collectionCalls).toBe(3);
    expect(raw.plays).toEqual([pageOne, pageTwo]);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      "https://boardgamegeek.com/xmlapi2/collection?username=azharkhan&own=1&stats=1&subtype=boardgame&excludesubtype=boardgameexpansion",
      "https://boardgamegeek.com/xmlapi2/collection?username=azharkhan&own=1&stats=1&subtype=boardgame&excludesubtype=boardgameexpansion",
      "https://boardgamegeek.com/xmlapi2/collection?username=azharkhan&own=1&stats=1&subtype=boardgame&excludesubtype=boardgameexpansion",
      "https://boardgamegeek.com/xmlapi2/plays?username=azharkhan&type=thing&subtype=boardgame&page=1",
      "https://boardgamegeek.com/xmlapi2/plays?username=azharkhan&type=thing&subtype=boardgame&page=2",
    ]);
  });

  it("stops after six queued attempts", async () => {
    const fetch = vi.fn(async () => new Response("queued", { status: 202 })) as unknown as typeof globalThis.fetch;
    const adapter = createBggAdapter({ retryDelayMs: 0 });
    await expect(adapter.live({ env: { BGG_TOKEN: "t" }, now, fetch, signal: new AbortController().signal }))
      .rejects.toThrow("still queued after 6 attempts");
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("aborts promptly while waiting to retry", async () => {
    const controller = new AbortController();
    const reason = new Error("aborted");
    const fetch = vi.fn(async () => new Response("queued", { status: 202 })) as unknown as typeof globalThis.fetch;
    const adapter = createBggAdapter({ retryDelayMs: 1000 });
    const pending = adapter.live({ env: { BGG_TOKEN: "t" }, now, fetch, signal: controller.signal });
    setTimeout(() => controller.abort(reason), 10);
    await expect(pending).rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("sanitizes HTTP errors and throws BGG XML error messages", async () => {
    const token = "sample-secret-token";
    const fetch = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof globalThis.fetch;
    const adapter = createBggAdapter({ retryDelayMs: 0 });
    await expect(adapter.live({ env: { BGG_TOKEN: token }, now, fetch, signal: new AbortController().signal }))
      .rejects.not.toThrow(token);

    expect(() => parse({
      sample: true,
      collection: "<errors><error><message>Invalid username specified</message></error></errors>",
      plays: [],
    })).toThrow("Invalid username specified");
  });
});
