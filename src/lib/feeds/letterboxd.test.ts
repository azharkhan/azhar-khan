import { describe, expect, it, vi } from "vitest";
import { runFeeds } from "../garden/feeds";
import { letterboxd } from "./letterboxd";

const now = new Date("2026-11-02T17:00:00Z");

function item(fields: {
  link: string;
  title?: string;
  watchedDate?: string;
  rating?: string;
  rewatch?: string;
  description?: string;
}) {
  return `<item>
    <title>Sample feed item</title>
    ${fields.title ? `<letterboxd:filmTitle>${fields.title}</letterboxd:filmTitle>` : ""}
    <link>${fields.link}</link>
    ${fields.watchedDate ? `<letterboxd:watchedDate>${fields.watchedDate}</letterboxd:watchedDate>` : ""}
    ${fields.rating ? `<letterboxd:memberRating>${fields.rating}</letterboxd:memberRating>` : ""}
    ${fields.rewatch ? `<letterboxd:rewatch>${fields.rewatch}</letterboxd:rewatch>` : ""}
    <pubDate>Thu, 01 Jan 2026 12:00:00 +0000</pubDate>
    <description><![CDATA[${fields.description ?? ""}]]></description>
  </item>`;
}

function rss(...items: string[]) {
  return `<rss><channel>${items.join("")}</channel></rss>`;
}

function parse(raw: string) {
  return letterboxd.parse(raw, { now });
}

describe("Letterboxd adapter", () => {
  it("parses the real RSS snapshot into unique film things and skips list items", async () => {
    const things = parse(await letterboxd.fixture()).things;
    const subjects = things.map((thing) => thing.subject);
    expect(things.length).toBeGreaterThanOrEqual(20);
    expect(subjects.every((subject) => subject.startsWith("letterboxd:"))).toBe(true);
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(things.every((thing) => thing.sample === false)).toBe(true);
  });

  it("maps Project Hail Mary and its reviewed watch", async () => {
    const thing = parse(await letterboxd.fixture()).things.find((candidate) => candidate.subject === "letterboxd:project-hail-mary");
    expect(thing).toMatchObject({
      title: "Project Hail Mary",
      metric: { kind: "stars", value: 4.5 },
      href: "https://letterboxd.com/azhark/film/project-hail-mary/",
    });
    expect(thing?.history).toHaveLength(1);
    expect(thing?.history[0]).toMatchObject({ at: new Date("2026-03-23T12:00:00Z"), verb: "watched" });
    expect(thing?.cover).toMatch(/^https:\/\/a\.ltrbxd\.com\//);
    expect(thing?.thought).toBeTruthy();
    expect(thing?.thought).not.toMatch(/<|&#/);
    expect(thing?.thought?.split("\n\n").length).toBeGreaterThanOrEqual(2);
  });

  it("removes the spoiler notice from Luca's review", async () => {
    const thing = parse(await letterboxd.fixture()).things.find((candidate) => candidate.subject === "letterboxd:luca-2021");
    expect(thing?.thought).toBeTruthy();
    expect(thing?.thought).not.toContain("This review may contain spoilers");
  });

  it("groups rewatches, picks the newest rating, and strips boilerplate and HTML", () => {
    const raw = rss(
      item({
        title: "Sample Film X",
        link: "https://letterboxd.com/azhark/film/x/",
        watchedDate: "2026-10-01",
        rating: "3",
      }),
      item({
        title: "Sample Film X",
        link: "https://letterboxd.com/azhark/film/x/1/",
        watchedDate: "2026-10-02",
        rating: "4.5",
        rewatch: "Yes",
      }),
      item({
        title: "Sample Poster Film",
        link: "https://letterboxd.com/azhark/film/poster-only/",
        watchedDate: "2026-01-01",
        description: '<p><img src="https://example.test/poster.jpg" /></p><p>Watched on Thursday, January 1, 2026.</p>',
      }),
      item({
        title: "Sample Unrated Film",
        link: "https://letterboxd.com/azhark/film/unrated/",
        watchedDate: "2026-01-02",
        description: "<p>It's &amp; &quot;fine&quot; &#039;enough&#039;.</p><p>Second paragraph.</p>",
      }),
      item({ link: "https://letterboxd.com/azhark/list/sample-list/" }),
    );
    const things = parse(raw).things;
    const rewatched = things.find((thing) => thing.subject === "letterboxd:x");
    expect(rewatched?.history.map((event) => event.verb)).toEqual(["watched", "rewatched"]);
    expect(rewatched?.metric).toEqual({ kind: "stars", value: 4.5 });
    expect(rewatched?.href).toBe("https://letterboxd.com/azhark/film/x/");

    const poster = things.find((thing) => thing.subject === "letterboxd:poster-only");
    expect(poster?.cover).toBe("https://example.test/poster.jpg");
    expect(poster?.thought).toBeUndefined();
    expect(poster?.history[0]?.text).toBeUndefined();
    expect(poster?.metric).toBeUndefined();

    const unrated = things.find((thing) => thing.subject === "letterboxd:unrated");
    expect(unrated?.metric).toBeUndefined();
    expect(unrated?.thought).toBe("It's & \"fine\" 'enough'.\n\nSecond paragraph.");
    expect(things.some((thing) => thing.subject.includes("sample-list"))).toBe(false);
  });

  it("keeps a real review whose first paragraph starts with Watched on", () => {
    const thing = parse(rss(item({
      title: "Sample Film With Review",
      link: "https://letterboxd.com/azhark/film/sample-film-with-review/",
      description: "<p>Watched on a plane.</p><p>Second paragraph.</p>",
    }))).things[0];
    expect(thing?.thought).toBe(["Watched on a plane.", "Second paragraph."].join("\n\n"));
    expect(thing?.history[0]?.text).toBe(["Watched on a plane.", "Second paragraph."].join("\n\n"));
  });

  it("rejects RSS without a channel", () => {
    expect(() => parse("<rss><other /></rss>")).toThrow("not a Letterboxd RSS feed");
  });

  it("requests the public RSS with its user agent and signal", async () => {
    const controller = new AbortController();
    const fixture = await letterboxd.fixture();
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(fixture)) as unknown as typeof globalThis.fetch;
    const raw = await letterboxd.live({ env: {}, now, fetch, signal: controller.signal });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://letterboxd.com/azhark/rss/");
    expect(new Headers(init?.headers).get("User-Agent")).toBe("azharkhan.net build");
    expect(init?.signal).toBe(controller.signal);
    expect(parse(raw).things.length).toBeGreaterThanOrEqual(20);
  });

  it("falls back to the real snapshot when live fails in production", async () => {
    const fetch = vi.fn(async () => { throw new Error("network disabled in test"); }) as unknown as typeof globalThis.fetch;
    const [result] = await runFeeds([letterboxd], { env: {}, dev: false, now, fetch, log: vi.fn() });
    expect(result?.mode).toBe("fixture");
    expect(result?.error).toContain("request failed");
    expect(result?.things.length).toBeGreaterThan(0);
  });
});
