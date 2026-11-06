import { describe, expect, it, vi } from "vitest";
import { buildGarden } from "../garden/build";
import { currently } from "../garden/query";
import type { FeedResult, LiveContext } from "../garden/feeds";
import type { Pursuit } from "../garden/schema";
import { ledgerRow } from "../home/ledger";
import { listenbrainz, LISTENBRAINZ_THRESHOLDS, MUSICBRAINZ_SEARCH_MIN_SCORE } from "./listenbrainz";

const now = new Date("2026-11-02T17:00:00Z");
const nowSeconds = Math.floor(now.getTime() / 1000);
const sampleNow = new Date("2026-12-01T00:00:00Z");
const groupId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const artistId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type ListenOptions = {
  recording?: number;
  releaseGroup?: string;
  release?: string;
  lastfmRelease?: string;
  artistMbid?: string;
  artistCreditName?: string;
  artist?: string;
  track?: string;
};

function id(value: number): string {
  return `${value.toString(16).padStart(8, "0")}-2222-4222-8222-222222222222`;
}

function listen(at: number, options: ListenOptions = {}) {
  const artist = options.artist ?? "SAMPLE Artist";
  const track = options.track ?? "SAMPLE Track";
  const mapping = {
    ...(options.releaseGroup ? { release_group_mbid: options.releaseGroup } : {}),
    ...(options.release ? { release_mbid: options.release } : {}),
    ...(options.recording !== undefined ? { recording_mbid: id(options.recording) } : {}),
    ...(options.artistMbid ? { artist_mbids: [options.artistMbid] } : {}),
    ...(options.artistCreditName ? { artists: [{ artist_credit_name: options.artistCreditName }] } : {}),
  };
  return {
    listened_at: at,
    recording_msid: `sample-${at}-${track}`,
    track_metadata: {
      artist_name: artist,
      track_name: track,
      ...(Object.keys(mapping).length ? { mbid_mapping: mapping } : {}),
      ...(options.lastfmRelease ? { additional_info: { lastfm_release_mbid: options.lastfmRelease } } : {}),
    },
  };
}

function tracks(count: number, track: string, start: number, options: ListenOptions = {}) {
  return Array.from({ length: count }, (_, index) => listen(start - index * 60, { ...options, track }));
}

function albumListens(options: {
  group?: string;
  albumPlays?: number;
  artistPlays?: number;
  recordings?: number;
  artist?: string;
  artistMbid?: string;
  start?: number;
} = {}) {
  const group = options.group ?? groupId;
  const albumPlays = options.albumPlays ?? 8;
  const artistPlays = options.artistPlays ?? 16;
  const recordings = options.recordings ?? 3;
  const artist = options.artist ?? "SAMPLE Album Artist";
  const artistMbid = options.artistMbid ?? artistId;
  const start = options.start ?? nowSeconds - 30;
  const result = Array.from({ length: albumPlays }, (_, index) => listen(start - index * 60, {
    artist,
    artistMbid,
    track: `SAMPLE Album Track ${index + 1}`,
    releaseGroup: group,
    recording: index % recordings + 1,
  }));
  for (let index = albumPlays; index < artistPlays; index++) {
    result.push(listen(start - index * 60, {
      artist,
      artistMbid,
      track: `SAMPLE Other Track ${index + 1}`,
    }));
  }
  return result;
}

function raw(listens: unknown[], releaseGroups: Record<string, unknown> = {}) {
  return { sample: false, listens, releaseGroups };
}

function releaseGroup(title = "SAMPLE Album") {
  return { title };
}

function musicPursuit(): Pursuit {
  return {
    id: "music",
    title: "Music",
    verb: "Listening",
    icon: "vinyl-record",
    colour: "blue",
    since: 2020,
    blurb: "[placeholder: Music blurb]",
    currently: 1,
  };
}

function mockFetch(
  listens: unknown[],
  musicBrainzResponse: Response | ((url: URL) => Response) = new Response(JSON.stringify(releaseGroup())),
) {
  const calls: { url: URL; init?: RequestInit; at: number }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init, at: Date.now() });
    if (url.hostname === "api.listenbrainz.org") {
      return new Response(JSON.stringify({ payload: { listens } }));
    }
    if (url.hostname === "musicbrainz.org") {
      return typeof musicBrainzResponse === "function" ? musicBrainzResponse(url) : musicBrainzResponse.clone();
    }
    throw new Error(`unexpected test URL: ${url.origin}`);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

async function live(fetch: typeof globalThis.fetch, at = now): Promise<Awaited<ReturnType<typeof listenbrainz.live>>> {
  const ctx: LiveContext = {
    env: { LISTENBRAINZ_USER: "sample-user" },
    now: at,
    fetch,
    signal: new AbortController().signal,
  };
  return listenbrainz.live(ctx);
}

function parse(listens: unknown[], at = now, releaseGroups: Record<string, unknown> = {}) {
  return listenbrainz.parse(raw(listens, releaseGroups), { now: at }).things;
}

describe("ListenBrainz latest obsession adapter", () => {
  it("uses one exported threshold object for each rung", () => {
    expect(LISTENBRAINZ_THRESHOLDS).toEqual({
      track: { minPlays: 5, leadRatio: 1.5 },
      album: { minPlays: 8, minRecordings: 3, minArtistShare: 0.5 },
      artist: { minPlays: 5 },
      musicBrainzLookups: 24,
    });
  });

  it("builds sample-labelled monthly things for all three rungs and skips a quiet month", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("fixture parsing must stay offline");
    }) as unknown as typeof globalThis.fetch;
    const fixture = await listenbrainz.fixture();
    const output = listenbrainz.parse(fixture, { now: sampleNow });
    const track = output.things.find((thing) => thing.subject === "listenbrainz:track:sample-artist-one/sample-repeat-song");
    const album = output.things.find((thing) => thing.subject === `listenbrainz:album:${groupId}`);
    const artist = output.things.find((thing) => thing.subject === `listenbrainz:artist:dddddddd-dddd-4ddd-8ddd-dddddddddddd`);

    expect(track).toMatchObject({
      title: "SAMPLE Repeat Song",
      href: "https://musicbrainz.org/recording/11111111-1111-4111-8111-111111111111",
      sample: true,
      history: [{ at: new Date("2026-08-31T23:59:59.999Z"), verb: "top track", text: "SAMPLE Artist One" }],
    });
    expect(album).toMatchObject({
      title: "SAMPLE Release Group",
      href: `https://musicbrainz.org/release-group/${groupId}`,
      cover: `https://coverartarchive.org/release-group/${groupId}/front-250`,
      history: [{ at: new Date("2026-09-30T23:59:59.999Z"), verb: "top album", text: "SAMPLE Artist Two" }],
    });
    expect(artist).toMatchObject({
      title: "SAMPLE Artist Three",
      href: "https://musicbrainz.org/artist/dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      history: [{ at: new Date("2026-10-31T23:59:59.999Z"), verb: "top artist" }],
    });
    expect(output.things).toHaveLength(3);
    expect(output.things.every((thing) => !thing.metric)).toBe(true);
    expect(output.things.flatMap((thing) => thing.history).every((event) => event.value === undefined && event.unit === undefined)).toBe(true);
    expect(JSON.stringify(output).toLowerCase()).not.toContain("plays");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the most common spelling and accepts the five-play and exact 1.5x boundaries", () => {
    const listens = [
      ...tracks(4, "SAMPLE Repeat", nowSeconds - 1, { artist: "SAMPLE Artist", recording: 5 }),
      listen(nowSeconds, { artist: "sample artist", track: "sample repeat", recording: 5 }),
      ...tracks(3, "SAMPLE Runner-up", nowSeconds - 500),
    ];
    const thing = parse(listens).find((candidate) => candidate.subject.startsWith("listenbrainz:track:"));
    expect(thing).toMatchObject({
      subject: "listenbrainz:track:sample-artist/sample-repeat",
      title: "SAMPLE Repeat",
      href: "https://musicbrainz.org/recording/00000005-2222-4222-8222-222222222222",
      history: [{ verb: "top track", text: "SAMPLE Artist" }],
    });
  });

  it("uses the recording artist credit while keeping the listen title", async () => {
    const listens = tracks(5, "SAMPLE Listen Title", nowSeconds, { artist: "Hamza malik", recording: 301, lastfmRelease: id(305) });
    const credit = [
      { name: "Hamza Malik", joinphrase: ", " },
      { name: "Zain Zohaib", joinphrase: " & " },
      { name: "Nayab Midha", joinphrase: "" },
    ];
    const { fetch, calls } = mockFetch(listens, () => new Response(JSON.stringify({ title: "MusicBrainz Title", "artist-credit": credit })));
    const result = await live(fetch);
    const thing = listenbrainz.parse(result, { now }).things[0];

    expect(thing).toMatchObject({
      title: "SAMPLE Listen Title",
      history: [{ verb: "top track", text: "Hamza Malik, Zain Zohaib & Nayab Midha" }],
    });
    expect(calls.filter((call) => call.url.hostname === "musicbrainz.org")).toHaveLength(1);
    expect(calls[1]?.url.pathname).toBe("/ws/2/recording/0000012d-2222-4222-8222-222222222222");
  });

  it("matches release tracks with a suffix and uses their artist credit", async () => {
    const listens = tracks(5, "Alfaaz", nowSeconds, { artist: "Hamza malik", lastfmRelease: id(302) });
    const release = {
      media: [{ tracks: [
        { title: "Other Track", "artist-credit": [{ name: "Wrong Artist", joinphrase: "" }] },
        { title: "Alfaaz - Acoustic", "artist-credit": [{ name: "Hamza Malik", joinphrase: " feat. " }, { name: "Zain Zohaib", joinphrase: "" }] },
      ] }],
    };
    const { fetch, calls } = mockFetch(listens, () => new Response(JSON.stringify(release)));
    const result = await live(fetch);
    const thing = listenbrainz.parse(result, { now }).things[0];

    expect(thing).toMatchObject({
      title: "Alfaaz",
      history: [{ verb: "top track", text: "Hamza Malik feat. Zain Zohaib" }],
    });
    expect(calls[1]?.url.toString()).toBe(`https://musicbrainz.org/ws/2/release/${id(302)}?inc=artist-credits+recordings&fmt=json`);
  });

  it("uses a release ID from any listen of the winning track", async () => {
    const listens = [
      listen(nowSeconds - 40 * 86400, { artist: "Hamza malik", track: "Alfaaz", lastfmRelease: id(306) }),
      ...tracks(5, "ALFAAZ", nowSeconds, { artist: "Hamza Malik" }),
    ];
    const release = {
      media: [{ tracks: [{
        title: "Alfaaz - Acoustic",
        "artist-credit": [{ name: "Hamza Malik", joinphrase: " & " }, { name: "Zain Zohaib", joinphrase: "" }],
      }] }],
    };
    const { fetch, calls } = mockFetch(listens, () => new Response(JSON.stringify(release)));
    const result = await live(fetch);

    expect(listenbrainz.parse(result, { now }).things.find((thing) => thing.title === "ALFAAZ")?.history.at(-1)?.text)
      .toBe("Hamza Malik & Zain Zohaib");
    expect(calls.filter((call) => call.url.hostname === "musicbrainz.org")).toHaveLength(1);
    expect(calls[1]?.url.pathname).toBe(`/ws/2/release/${id(306)}`);
  });

  it("falls back to a matched release track's recording credit", async () => {
    const listens = tracks(5, "Alfaaz", nowSeconds, { artist: "Hamza malik", release: id(303) });
    const release = {
      media: [{ tracks: [{
        title: "Alfaaz (Acoustic)",
        recording: { "artist-credit": [{ name: "Hamza Malik", joinphrase: " & " }, { name: "Zain Zohaib", joinphrase: "" }] },
      }] }],
    };
    const { fetch } = mockFetch(listens, () => new Response(JSON.stringify(release)));
    const result = await live(fetch);

    expect(listenbrainz.parse(result, { now }).things[0]?.history[0]?.text).toBe("Hamza Malik & Zain Zohaib");
  });

  it("searches MusicBrainz once for an unmapped track and keeps the common spelling without an exact match", async () => {
    const listens = [
      ...tracks(4, "sample track", nowSeconds, { artist: "Hamza malik" }),
      listen(nowSeconds - 500, { artist: "Hamza Malik", track: "SAMPLE TRACK" }),
    ];
    const { fetch, calls } = mockFetch(listens, new Response(JSON.stringify({ recordings: [] })));
    const result = await live(fetch);
    const thing = listenbrainz.parse(result, { now }).things[0];

    expect(thing?.history[0]?.text).toBe("Hamza malik");
    const searches = calls.filter((call) => call.url.hostname === "musicbrainz.org");
    expect(searches).toHaveLength(1);
    expect(searches[0]?.url.pathname).toBe("/ws/2/recording");
    expect(searches[0]?.url.searchParams.get("query")).toBe('recording:"sample track" AND artist:"Hamza malik"');
  });

  it("falls back to the common spelling when a MusicBrainz lookup fails", async () => {
    const listens = tracks(5, "SAMPLE Track", nowSeconds, { artist: "Hamza Malik", recording: 304 });
    const { fetch, calls } = mockFetch(listens, new Response("unavailable", { status: 503 }));
    const result = await live(fetch);

    expect(listenbrainz.parse(result, { now }).things[0]?.history[0]?.text).toBe("Hamza Malik");
    expect(calls.filter((call) => call.url.hostname === "musicbrainz.org")).toHaveLength(1);
  });

  it("uses the canonical artist credit name already present in listens without another lookup", async () => {
    const listens = Array.from({ length: 5 }, (_, index) => listen(nowSeconds - index * 60, {
      artist: "hamza malik",
      artistMbid: artistId,
      artistCreditName: "Hamza Malik",
      track: `SAMPLE Unique ${index}`,
    }));
    const { fetch, calls } = mockFetch(listens);
    const result = await live(fetch);
    const thing = listenbrainz.parse(result, { now }).things[0];

    expect(thing).toMatchObject({
      subject: `listenbrainz:artist:${artistId}`,
      title: "Hamza Malik",
    });
    expect(calls.filter((call) => call.url.hostname === "musicbrainz.org")).toHaveLength(0);
  });

  it("uses the release-group artist credit for album winners", async () => {
    const listens = albumListens({ artist: "Hamza malik" });
    const response = { ...releaseGroup("SAMPLE Album"), "artist-credit": [{ name: "Hamza Malik", joinphrase: " & " }, { name: "Zain Zohaib", joinphrase: "" }] };
    const { fetch, calls } = mockFetch(listens, () => new Response(JSON.stringify(response)));
    const result = await live(fetch);

    expect(listenbrainz.parse(result, { now }).things[0]?.history[0]?.text).toBe("Hamza Malik & Zain Zohaib");
    expect(calls.filter((call) => call.url.hostname === "musicbrainz.org")).toHaveLength(1);
    expect(calls[1]?.url.searchParams.get("inc")).toBe("artist-credits");
  });

  it("omits MusicBrainz hrefs when a winning item has no MBID", () => {
    const thing = parse(tracks(5, "SAMPLE Track Without Mapping", nowSeconds))[0];
    expect(thing?.subject).toBe("listenbrainz:track:sample-artist/sample-track-without-mapping");
    expect(thing).not.toHaveProperty("href");
  });

  it("falls through the track rung when the leader is below 1.5x the runner-up", () => {
    const listens = [
      ...tracks(5, "SAMPLE Leader", nowSeconds - 1, { artist: "SAMPLE Artist" }),
      ...tracks(4, "SAMPLE Runner-up", nowSeconds - 500, { artist: "SAMPLE Artist" }),
    ];
    const things = parse(listens);
    expect(things).toHaveLength(1);
    expect(things[0]).toMatchObject({ subject: "listenbrainz:artist:sample-artist", title: "SAMPLE Artist", history: [{ verb: "top artist" }] });
  });

  it("requires five artist plays and returns nothing below the artist boundary", () => {
    const uniqueTracks = (count: number) => Array.from({ length: count }, (_, index) => listen(nowSeconds - index * 60, { track: `SAMPLE Unique ${index}` }));
    const artist = parse(uniqueTracks(5))[0];
    expect(artist?.subject).toBe("listenbrainz:artist:sample-artist");
    expect(artist).not.toHaveProperty("href");
    expect(parse(uniqueTracks(4))).toEqual([]);
  });

  it("selects a qualifying album at the 8-play, 3-recording and 50-percent boundaries", () => {
    const listens = albumListens();
    const things = parse(listens, now, { [groupId]: releaseGroup() });
    expect(things).toHaveLength(1);
    expect(things[0]).toMatchObject({
      subject: `listenbrainz:album:${groupId}`,
      title: "SAMPLE Album",
      history: [{ verb: "top album", text: "SAMPLE Album Artist" }],
    });
  });

  it.each([
    { albumPlays: 7, artistPlays: 16, recordings: 3 },
    { albumPlays: 8, artistPlays: 16, recordings: 2 },
    { albumPlays: 8, artistPlays: 17, recordings: 3 },
  ])("falls through to artist when an album condition misses its boundary: $albumPlays/$artistPlays plays, $recordings recordings", (options) => {
    const things = parse(albumListens(options), now, { [groupId]: releaseGroup() });
    expect(things).toHaveLength(1);
    expect(things[0]?.subject).toBe(`listenbrainz:artist:${artistId}`);
    expect(things[0]?.history[0]?.verb).toBe("top artist");
  });

  it("breaks album and artist ties by the most recent listen", () => {
    const olderGroup = id(101);
    const newerGroup = id(102);
    const albumTies = [
      ...albumListens({ group: olderGroup, artist: "SAMPLE Older Artist", artistMbid: id(201), start: nowSeconds - 10000 }),
      ...albumListens({ group: newerGroup, artist: "SAMPLE Newer Artist", artistMbid: id(202), start: nowSeconds - 1000 }),
    ];
    const albumThings = parse(albumTies, now, { [olderGroup]: releaseGroup("SAMPLE Older Album"), [newerGroup]: releaseGroup("SAMPLE Newer Album") });
    expect(albumThings).toHaveLength(1);
    expect(albumThings[0]?.subject).toBe(`listenbrainz:album:${newerGroup}`);

    const artistTies = [
      ...tracks(5, "SAMPLE Older Song", nowSeconds - 10000, { artist: "SAMPLE Older Artist", artistMbid: id(201) }),
      ...tracks(5, "SAMPLE Newer Song", nowSeconds - 1000, { artist: "SAMPLE Newer Artist", artistMbid: id(202) }),
    ];
    const artistThings = parse(artistTies);
    expect(artistThings).toHaveLength(1);
    expect(artistThings[0]?.subject).toBe(`listenbrainz:artist:${id(202)}`);
  });

  it("uses injected fetch with the User-Agent for public paging and MusicBrainz lookups", async () => {
    const fixture = await listenbrainz.fixture();
    const { fetch, calls } = mockFetch(fixture.listens);
    const result = await live(fetch, sampleNow);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.url.pathname).toBe("/1/user/sample-user/listens");
    expect(calls[0]?.url.searchParams.get("count")).toBe("1000");
    expect(calls[0]?.url.searchParams.get("max_ts")).toBe(String(Math.floor(sampleNow.getTime() / 1000)));
    expect(calls[0]?.init?.headers).toEqual({ "User-Agent": "azharkhan.net/0.0.0 (https://azharkhan.net)" });
    expect(calls[1]?.url.toString()).toBe(`https://musicbrainz.org/ws/2/release-group/${groupId}?inc=artist-credits&fmt=json`);
    expect(calls[1]?.init?.headers).toEqual({ "User-Agent": "azharkhan.net/0.0.0 (https://azharkhan.net)" });
    expect(calls[2]?.url.toString()).toBe("https://musicbrainz.org/ws/2/recording/11111111-1111-4111-8111-111111111111?inc=artist-credits&fmt=json");
    expect(calls[2]?.init?.headers).toEqual({ "User-Agent": "azharkhan.net/0.0.0 (https://azharkhan.net)" });
    expect(result.releaseGroups?.[groupId]).toEqual({ title: "SAMPLE Album" });
  });

  it("caches one MusicBrainz lookup when the same album wins multiple months", async () => {
    const firstMonth = Math.floor(Date.UTC(2026, 7, 10, 12) / 1000);
    const secondMonth = Math.floor(Date.UTC(2026, 8, 10, 12) / 1000);
    const listens = [
      ...albumListens({ start: firstMonth }),
      ...albumListens({ start: secondMonth }),
    ];
    const { fetch, calls } = mockFetch(listens);
    const result = await live(fetch, sampleNow);
    const albumCalls = calls.filter((call) => call.url.hostname === "musicbrainz.org");
    expect(albumCalls).toHaveLength(1);
    expect(listenbrainz.parse(result, { now: sampleNow }).things.find((thing) => thing.subject === `listenbrainz:album:${groupId}`)?.history)
      .toHaveLength(2);
  });

  it("falls from album to artist when a MusicBrainz lookup fails", async () => {
    const listens = albumListens();
    const { fetch, calls } = mockFetch(listens, new Response("unavailable", { status: 503 }));
    const result = await live(fetch);
    const things = listenbrainz.parse(result, { now }).things;
    expect(calls.filter((call) => call.url.hostname === "musicbrainz.org")).toHaveLength(1);
    expect(things).toHaveLength(1);
    expect(things[0]).toMatchObject({
      subject: `listenbrainz:artist:${artistId}`,
      title: "SAMPLE Album Artist",
      history: [{ verb: "top artist" }],
    });
  });

  it("paginates with a one-second pause, removes overlaps and stops at its 10-page limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const pageListens = Array.from({ length: 1000 }, (_, index) => listen(nowSeconds - index, { track: `SAMPLE Page One ${index}` }));
      const calls: { url: URL; at: number }[] = [];
      const fetch = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        calls.push({ url, at: Date.now() });
        const page = calls.length === 1 ? pageListens : [pageListens.at(-1)!, listen(nowSeconds - 1200, { track: "SAMPLE Older Listen" })];
        return new Response(JSON.stringify({ payload: { listens: page } }));
      }) as unknown as typeof globalThis.fetch;
      const promise = live(fetch);
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(calls).toHaveLength(2);
      expect(calls[0]?.url.searchParams.get("max_ts")).toBe(String(nowSeconds));
      expect(calls[1]?.url.searchParams.get("max_ts")).toBe(String(nowSeconds - 998));
      expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(1000);
      expect(result.listens).toHaveLength(1001);

      calls.length = 0;
      const fullPagesFetch = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        calls.push({ url, at: Date.now() });
        const pageIndex = calls.length - 1;
        const page = Array.from({ length: 1000 }, (_, index) => listen(nowSeconds - pageIndex * 1000 - index, { track: `SAMPLE ${pageIndex}-${index}` }));
        return new Response(JSON.stringify({ payload: { listens: page } }));
      }) as unknown as typeof globalThis.fetch;
      const cappedPromise = live(fullPagesFetch);
      await vi.runAllTimersAsync();
      const capped = await cappedPromise;
      expect(calls).toHaveLength(10);
      expect(capped.listens).toHaveLength(10000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caches release-group lookups by MBID and keeps only the newest 24 distinct album winners", async () => {
    vi.useFakeTimers();
    const lookupNow = new Date("2026-12-01T00:00:00Z");
    vi.setSystemTime(lookupNow);
    try {
      const listens: unknown[] = [];
      const groups: string[] = [];
      for (let month = 0; month < 30; month++) {
        const date = new Date(Date.UTC(2024, month, 10, 12));
        const group = id(1000 + month);
        groups.push(group);
        listens.push(...albumListens({ group, start: Math.floor(date.getTime() / 1000), artist: "SAMPLE Many Albums", artistMbid: artistId }));
      }
      const calls: { url: URL; init?: RequestInit; at: number }[] = [];
      const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({ url, init, at: Date.now() });
        if (url.hostname === "api.listenbrainz.org") return new Response(JSON.stringify({ payload: { listens } }));
        return new Response(JSON.stringify({ title: "SAMPLE Looked Up Album" }));
      }) as unknown as typeof globalThis.fetch;
      const promise = live(fetch, lookupNow);
      await vi.runAllTimersAsync();
      const result = await promise;
      const albumCalls = calls.filter((call) => call.url.hostname === "musicbrainz.org");
      expect(albumCalls).toHaveLength(LISTENBRAINZ_THRESHOLDS.musicBrainzLookups);
      expect(albumCalls.map((call) => call.url.pathname.split("/").at(-1))).toEqual(groups.slice(-24).reverse());
      expect(albumCalls.every((call) => call.init?.headers !== undefined)).toBe(true);
      for (let index = 1; index < albumCalls.length; index++) {
        expect(albumCalls[index]!.at - albumCalls[index - 1]!.at).toBeGreaterThanOrEqual(1000);
      }
      const things = listenbrainz.parse(result, { now: lookupNow }).things;
      expect(things.some((thing) => thing.subject === `listenbrainz:album:${groups[0]}`)).toBe(false);
      expect(things.find((thing) => thing.subject === `listenbrainz:artist:${artistId}`)?.history[0]?.verb).toBe("top artist");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares one capped, cached, rate-limited queue across recordings, releases, and release groups", async () => {
    vi.useFakeTimers();
    const lookupNow = new Date("2026-12-01T00:00:00Z");
    vi.setSystemTime(lookupNow);
    try {
      const listens: unknown[] = [];
      const groups: string[] = [];
      for (let month = 0; month < 26; month++) {
        const date = new Date(Date.UTC(2024, month, 10, 12));
        const group = month === 1 ? groups[0]! : month === 25 ? id(1024) : id(1000 + month);
        groups.push(group);
        listens.push(...albumListens({ group, start: Math.floor(date.getTime() / 1000), artist: "SAMPLE Mixed Artist", artistMbid: artistId }));
      }
      listens.push(...tracks(5, "SAMPLE Recording Winner", Math.floor(Date.UTC(2026, 9, 10, 12) / 1000), {
        artist: "SAMPLE Mixed Artist",
        recording: 9001,
      }));
      listens.push(...tracks(5, "SAMPLE Release Winner", Math.floor(Date.UTC(2026, 8, 10, 12) / 1000), {
        artist: "SAMPLE Mixed Artist",
        release: id(9002),
      }));
      const calls: { url: URL; init?: RequestInit; at: number }[] = [];
      const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({ url, init, at: Date.now() });
        if (url.hostname === "api.listenbrainz.org") return new Response(JSON.stringify({ payload: { listens } }));
        return new Response(JSON.stringify({ title: "SAMPLE Looked Up Album" }));
      }) as unknown as typeof globalThis.fetch;
      const promise = live(fetch, lookupNow);
      await vi.runAllTimersAsync();
      await promise;

      const lookups = calls.filter((call) => call.url.hostname === "musicbrainz.org");
      expect(lookups).toHaveLength(LISTENBRAINZ_THRESHOLDS.musicBrainzLookups);
      expect(lookups.filter((call) => call.url.pathname.includes("/recording/")).length).toBe(1);
      expect(lookups.filter((call) => call.url.pathname.includes("/release/")).length).toBe(1);
      const groupLookups = lookups.filter((call) => call.url.pathname.includes("/release-group/"));
      expect(groupLookups).toHaveLength(22);
      expect(groupLookups.some((call) => call.url.pathname.endsWith(`/${groups[0]}`))).toBe(false);
      expect(groupLookups.some((call) => call.url.pathname.endsWith(`/${groups[2]}`))).toBe(false);
      expect(groupLookups.filter((call) => call.url.pathname.endsWith(`/${id(1024)}`))).toHaveLength(1);
      expect(new Set(lookups.map((call) => call.url.toString())).size).toBe(lookups.length);
      for (let index = 1; index < lookups.length; index++) {
        expect(lookups[index]!.at - lookups[index - 1]!.at).toBeGreaterThanOrEqual(1000);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("bumps the trailing-30-day winner so Currently selects it, with no metric", () => {
    const currentListens = [
      ...tracks(6, "SAMPLE Current Obsession", nowSeconds - 12 * 86400, { artist: "SAMPLE New Artist", recording: 901 }),
      ...tracks(4, "SAMPLE Other Current Track", nowSeconds - 11 * 86400, { artist: "SAMPLE New Artist" }),
      ...tracks(5, "SAMPLE Older Song", nowSeconds - 32 * 86400, { artist: "SAMPLE Old Artist" }),
    ];
    const things = parse(currentListens);
    const feed: FeedResult = { adapter: "listenbrainz", pursuit: "music", mode: "live", dropped: 0, things };
    const garden = buildGarden({ pursuits: [musicPursuit()], hand: [], feeds: [feed], now, samples: true });
    const row = currently(garden)[0];
    expect(row?.state).toBe("latest");
    if (!row || row.state !== "latest") throw new Error("expected a current music thing");
    expect(row.entry.subject).toBe("listenbrainz:track:sample-new-artist/sample-current-obsession");
    expect(row.entry.lastTouched).toEqual(new Date((nowSeconds - 11 * 86400) * 1000));
    expect(row.metric).toBeUndefined();
    expect(ledgerRow(row)).toMatchObject({
      label: "Listening",
      title: "SAMPLE Current Obsession",
      href: row.entry.href,
      external: true,
      detail: "SAMPLE New Artist",
    });

    const albumThing = {
      id: "music/album",
      sources: ["listenbrainz"],
      subject: `listenbrainz:album:${groupId}`,
      kind: "note" as const,
      title: "SAMPLE Album",
      pursuits: ["music"],
      date: now,
      lastTouched: now,
      long: false,
      history: [{ at: now, verb: "top album", text: "SAMPLE Album Artist" }],
      tags: [],
      connected: [],
      sample: true,
    };
    const albumRow = ledgerRow({ pursuit: musicPursuit(), state: "latest", entry: albumThing });
    expect(albumRow).toMatchObject({ label: "Listening", href: "/garden/music/", external: false, detail: "SAMPLE Album Artist" });
  });
  it("credits an unmapped track winner from an exact, high-scoring MusicBrainz search", () => {
    const listens = tracks(6, "SAMPLE Unmapped", nowSeconds, { artist: "sample artist" });
    const credit = [{ name: "SAMPLE Artist", joinphrase: " & " }, { name: "SAMPLE Guest", joinphrase: "" }];
    const searchFor = (recordings: unknown[]) => listenbrainz.parse(
      { sample: false, listens, releaseGroups: {}, searches: { "sample artist\u0000sample unmapped": { recordings } } },
      { now },
    ).things.find((thing) => thing.subject.startsWith("listenbrainz:track:"));
    expect(searchFor([{ score: 100, title: "SAMPLE Unmapped", "artist-credit": credit }])?.history.at(-1)?.text)
      .toBe("SAMPLE Artist & SAMPLE Guest");
    expect(searchFor([{ score: MUSICBRAINZ_SEARCH_MIN_SCORE - 1, title: "SAMPLE Unmapped", "artist-credit": credit }])?.history.at(-1)?.text)
      .toBe("sample artist");
    expect(searchFor([{ score: 100, title: "SAMPLE Unmapped - Acoustic", "artist-credit": credit }])?.history.at(-1)?.text)
      .toBe("sample artist");
  });

});
