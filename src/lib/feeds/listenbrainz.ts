import { z } from "astro/zod";
import type { Adapter, LiveContext } from "../garden/feeds";
import type { FeedThing, HistoryEvent } from "../garden/schema";
import { getJson, sleep } from "./http";

const apiUrl = "https://api.listenbrainz.org/1";
const listensPerPage = 1000;
const maxPages = 10;
const userAgent = "azharkhan.net/0.0.0 (https://azharkhan.net)";
const thirtyDays = 30 * 24 * 60 * 60 * 1000;
const listenSchema = z.looseObject({
  listened_at: z.number().int().nonnegative(),
  recording_msid: z.string().nullish(),
  track_metadata: z.looseObject({
    artist_name: z.string().nullish(),
    track_name: z.string().nullish(),
    additional_info: z.looseObject({ lastfm_release_mbid: z.string().nullish() }).nullish(),
    mbid_mapping: z.looseObject({
      release_group_mbid: z.string().nullish(),
      release_mbid: z.string().nullish(),
      recording_mbid: z.string().nullish(),
      artist_mbids: z.array(z.string()).nullish(),
      artists: z.array(z.looseObject({
        artist_mbid: z.string().nullish(),
        artist_credit_name: z.string().nullish(),
      })).nullish(),
    }).nullish(),
  }),
});
const responseSchema = z.looseObject({ payload: z.looseObject({ listens: z.array(z.unknown()) }) });
const releaseGroupSchema = z.looseObject({ title: z.string(), "artist-credit": z.unknown().optional() });
const recordingSchema = z.looseObject({ "artist-credit": z.unknown().optional() });
const artistCreditItemSchema = z.union([
  z.string(),
  z.looseObject({
    name: z.string().nullish(),
    joinphrase: z.string().nullish(),
    artist: z.looseObject({ name: z.string().nullish() }).nullish(),
  }),
]);
const artistCreditSchema = z.array(artistCreditItemSchema);
const releaseTrackSchema = z.looseObject({
  title: z.string().nullish(),
  "artist-credit": z.unknown().optional(),
  recording: recordingSchema.nullish(),
});
const releaseSchema = z.looseObject({
  media: z.array(z.looseObject({ tracks: z.array(releaseTrackSchema).nullish() })).nullish(),
});

export const MUSICBRAINZ_SEARCH_MIN_SCORE = 95;

export const LISTENBRAINZ_THRESHOLDS = {
  track: { minPlays: 5, leadRatio: 1.5 },
  album: { minPlays: 8, minRecordings: 3, minArtistShare: 0.5 },
  artist: { minPlays: 5 },
  musicBrainzLookups: 24,
} as const;

type Raw = {
  sample: boolean;
  listens: unknown[];
  releaseGroups?: Record<string, unknown>;
  recordings?: Record<string, unknown>;
  releases?: Record<string, unknown>;
  searches?: Record<string, unknown>;
};
type Listen = {
  at: number;
  artist: string;
  artistKey: string;
  artistMbid?: string;
  artistCreditName?: string;
  track?: string;
  trackKey?: string;
  recordingMbid?: string;
  releaseMbid?: string;
  releaseGroupMbid?: string;
  sequence: number;
};
type Counted = { key: string; listens: Listen[]; latest: Listen };
type ArtistChoice = { kind: "artist"; subject: string; title: string; href?: string; latestAt: number };
type TrackChoice = {
  kind: "track";
  subject: string;
  title: string;
  artist: string;
  recordingMbid?: string;
  releaseMbid?: string;
  href?: string;
  latestAt: number;
};
type AlbumChoice = { kind: "album"; subject: string; releaseGroupMbid: string; artist: string; latestAt: number };
type MusicBrainzLookup = { kind: "recording" | "release" | "release-group" | "search"; mbid: string; at: number; title?: string; artist?: string };
type Choice = TrackChoice | AlbumChoice | ArtistChoice;
type Window = { listens: Listen[]; at: Date; choice?: Choice; artist?: ArtistChoice; monthKey?: string; current?: boolean };

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function subjectName(value: string): string {
  return normalizeName(value).replace(/\s+/g, "-");
}

function uuid(value: string | null | undefined): string | undefined {
  const result = z.uuid().safeParse(value);
  return result.success ? result.data.toLowerCase() : undefined;
}

function parseListens(values: unknown[], now: Date): Listen[] {
  const latest = Math.floor(now.getTime() / 1000);
  return values.flatMap((value, sequence) => {
    const parsed = listenSchema.safeParse(value);
    if (!parsed.success || parsed.data.listened_at > latest) return [];
    const metadata = parsed.data.track_metadata;
    const artist = metadata.artist_name?.trim();
    if (!artist) return [];
    const artistKey = normalizeName(artist);
    const track = metadata.track_name?.trim() || undefined;
    const mapping = metadata.mbid_mapping;
    const artistMbids = mapping?.artist_mbids?.map((mbid) => uuid(mbid));
    const artistMbid = artistMbids?.[0];
    const artistCreditName = artistMbid
      ? mapping?.artists?.find((item, index) => (uuid(item.artist_mbid) ?? artistMbids[index]) === artistMbid)?.artist_credit_name?.trim() || undefined
      : undefined;
    return [{
      at: parsed.data.listened_at,
      artist,
      artistKey,
      artistMbid,
      artistCreditName,
      track,
      trackKey: track ? normalizeName(track) : undefined,
      recordingMbid: uuid(mapping?.recording_mbid),
      releaseMbid: uuid(mapping?.release_mbid) ?? uuid(metadata.additional_info?.lastfm_release_mbid),
      releaseGroupMbid: uuid(mapping?.release_group_mbid),
      sequence,
    }];
  });
}

function latestListen(listens: Listen[]): Listen {
  return [...listens].sort((a, b) => b.at - a.at || b.sequence - a.sequence)[0]!;
}

function counted(listens: Listen[], keyOf: (listen: Listen) => string | undefined): Counted[] {
  const groups = new Map<string, Counted>();
  for (const listen of listens) {
    const key = keyOf(listen);
    if (!key) continue;
    const group = groups.get(key);
    if (group) {
      group.listens.push(listen);
      if (listen.at > group.latest.at || (listen.at === group.latest.at && listen.sequence > group.latest.sequence)) group.latest = listen;
    } else groups.set(key, { key, listens: [listen], latest: listen });
  }
  return [...groups.values()];
}

function commonSpelling(listens: Listen[], pick: (listen: Listen) => string | undefined): string {
  const counts = new Map<string, { count: number; latest: Listen }>();
  for (const listen of listens) {
    const value = pick(listen);
    if (!value) continue;
    const entry = counts.get(value);
    if (!entry) counts.set(value, { count: 1, latest: listen });
    else {
      entry.count += 1;
      if (listen.at > entry.latest.at || (listen.at === entry.latest.at && listen.sequence > entry.latest.sequence)) entry.latest = listen;
    }
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => b.count - a.count || b.latest.at - a.latest.at || b.latest.sequence - a.latest.sequence)[0]![0];
}

function compareCounted(a: Counted, b: Counted): number {
  return b.listens.length - a.listens.length || b.latest.at - a.latest.at || a.key.localeCompare(b.key);
}

function artistChoice(listens: Listen[], allListens: Listen[] = listens): ArtistChoice | undefined {
  const top = counted(listens, (listen) => listen.artistKey).sort(compareCounted)[0];
  if (!top || top.listens.length < LISTENBRAINZ_THRESHOLDS.artist.minPlays) return undefined;
  const latest = top.latest;
  const artistMbid = [...top.listens]
    .sort((a, b) => b.at - a.at || b.sequence - a.sequence)
    .find((listen) => listen.artistMbid)?.artistMbid;
  const artistIdentity = artistMbid ?? subjectName(latest.artist);
  const canonicalListens = allListens.filter((listen) => listen.artistMbid === artistMbid && listen.artistCreditName);
  const canonicalName = canonicalListens.length > 0
    ? commonSpelling(canonicalListens, (listen) => listen.artistCreditName)
    : undefined;
  return {
    kind: "artist",
    subject: `listenbrainz:artist:${artistIdentity}`,
    title: canonicalName ?? commonSpelling(top.listens, (listen) => listen.artist),
    href: artistMbid ? `https://musicbrainz.org/artist/${artistMbid}` : undefined,
    latestAt: latest.at,
  };
}

function trackChoice(listens: Listen[], allListens: Listen[] = listens): TrackChoice | undefined {
  const tracks = counted(listens, (listen) => listen.trackKey ? `${listen.artistKey}\u0000${listen.trackKey}` : undefined)
    .sort(compareCounted);
  const top = tracks[0];
  if (!top || top.listens.length < LISTENBRAINZ_THRESHOLDS.track.minPlays) return undefined;
  const secondPlays = tracks[1]?.listens.length ?? 0;
  if (top.listens.length < secondPlays * LISTENBRAINZ_THRESHOLDS.track.leadRatio) return undefined;
  const latest = top.latest;
  const matchingListens = allListens.filter((listen) => listen.artistKey === latest.artistKey && listen.trackKey === latest.trackKey);
  const mostRecentFirst = [...matchingListens].sort((a, b) => b.at - a.at || b.sequence - a.sequence);
  const recordingMbid = mostRecentFirst.find((listen) => listen.recordingMbid)?.recordingMbid;
  const releaseMbid = recordingMbid ? undefined : mostRecentFirst.find((listen) => listen.releaseMbid)?.releaseMbid;
  return {
    kind: "track",
    subject: `listenbrainz:track:${subjectName(latest.artist)}/${subjectName(latest.track!)}`,
    title: commonSpelling(top.listens, (listen) => listen.track),
    artist: commonSpelling(top.listens, (listen) => listen.artist),
    recordingMbid,
    releaseMbid,
    href: recordingMbid ? `https://musicbrainz.org/recording/${recordingMbid}` : undefined,
    latestAt: latest.at,
  };
}

function albumChoice(listens: Listen[]): AlbumChoice | undefined {
  const albums = counted(listens, (listen) => listen.releaseGroupMbid).sort(compareCounted);
  const top = albums[0];
  if (!top) return undefined;
  const artists = counted(top.listens, (listen) => listen.artistKey).sort(compareCounted);
  const albumArtist = artists[0];
  if (!albumArtist) return undefined;
  const artistPlays = listens.filter((listen) => listen.artistKey === albumArtist.key).length;
  const recordings = new Set(top.listens.flatMap((listen) => listen.recordingMbid ? [listen.recordingMbid] : []));
  if (top.listens.length < LISTENBRAINZ_THRESHOLDS.album.minPlays
    || recordings.size < LISTENBRAINZ_THRESHOLDS.album.minRecordings
    || top.listens.length < artistPlays * LISTENBRAINZ_THRESHOLDS.album.minArtistShare) return undefined;
  return {
    kind: "album",
    subject: `listenbrainz:album:${top.key}`,
    releaseGroupMbid: top.key,
    artist: commonSpelling(albumArtist.listens, (listen) => listen.artist),
    latestAt: top.latest.at,
  };
}

function choose(listens: Listen[], allListens: Listen[] = listens): Window["choice"] {
  return trackChoice(listens, allListens) ?? albumChoice(listens) ?? artistChoice(listens, allListens);
}

function monthKey(listen: Listen): string {
  const date = new Date(listen.at * 1000);
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

function monthlyWindows(listens: Listen[], now: Date, allListens: Listen[] = listens): Window[] {
  const months = new Map<string, Listen[]>();
  for (const listen of listens) {
    const key = monthKey(listen);
    const month = months.get(key) ?? [];
    month.push(listen);
    months.set(key, month);
  }
  return [...months.entries()]
    .map(([key, monthListens]) => {
      const latest = latestListen(monthListens);
      const date = new Date(latest.at * 1000);
      const isCurrentMonth = date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth();
      const at = isCurrentMonth
        ? date
        : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      return { listens: monthListens, at, choice: choose(monthListens, allListens), artist: artistChoice(monthListens, allListens), monthKey: key };
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function buildWindows(listens: Listen[], now: Date): Window[] {
  const months = monthlyWindows(listens, now, listens);
  const currentStart = (now.getTime() - thirtyDays) / 1000;
  const currentListens = listens.filter((listen) => listen.at >= currentStart && listen.at <= now.getTime() / 1000);
  if (currentListens.length > 0) {
    const latest = latestListen(currentListens);
    months.push({
      listens: currentListens,
      at: new Date(latest.at * 1000),
      choice: choose(currentListens, listens),
      artist: artistChoice(currentListens, listens),
      current: true,
    });
  }
  return months;
}

function lookupKey(lookup: Pick<MusicBrainzLookup, "kind" | "mbid">): string {
  return `${lookup.kind}:${lookup.mbid}`;
}

function musicBrainzLookups(windows: Window[]): MusicBrainzLookup[] {
  const lookups = new Map<string, MusicBrainzLookup>();
  const add = (kind: MusicBrainzLookup["kind"], mbid: string, at: number) => {
    const lookup = { kind, mbid, at };
    const key = lookupKey(lookup);
    const existing = lookups.get(key);
    if (!existing || at > existing.at) lookups.set(key, lookup);
  };
  for (const window of windows) {
    const choice = window.choice;
    if (choice?.kind === "track") {
      if (choice.recordingMbid) add("recording", choice.recordingMbid, choice.latestAt);
      else if (choice.releaseMbid) add("release", choice.releaseMbid, choice.latestAt);
      else lookups.set(lookupKey({ kind: "search", mbid: searchKey(choice) }), { kind: "search", mbid: searchKey(choice), at: choice.latestAt, title: choice.title, artist: choice.artist });
    } else if (choice?.kind === "album") {
      add("release-group", choice.releaseGroupMbid, choice.latestAt);
    }
  }
  return [...lookups.values()]
    .sort((a, b) => b.at - a.at || lookupKey(a).localeCompare(lookupKey(b)))
    .slice(0, LISTENBRAINZ_THRESHOLDS.musicBrainzLookups);
}

function artistCreditString(value: unknown): string | undefined {
  const parsed = artistCreditSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const credit = parsed.data.map((item) => {
    if (typeof item === "string") return item;
    const name = item.name?.trim() || item.artist?.name?.trim() || "";
    return `${name}${item.joinphrase ?? ""}`;
  }).join("").trim();
  return credit || undefined;
}

function releaseGroupTitle(raw: Raw, mbid: string): string | undefined {
  const parsed = releaseGroupSchema.safeParse(raw.releaseGroups?.[mbid]);
  const title = parsed.success ? parsed.data.title.trim() : "";
  return title || undefined;
}

function releaseGroupArtistCredit(raw: Raw, mbid: string): string | undefined {
  const parsed = releaseGroupSchema.safeParse(raw.releaseGroups?.[mbid]);
  return parsed.success ? artistCreditString(parsed.data["artist-credit"]) : undefined;
}

function recordingArtistCredit(raw: Raw, mbid: string): string | undefined {
  const parsed = recordingSchema.safeParse(raw.recordings?.[mbid]);
  return parsed.success ? artistCreditString(parsed.data["artist-credit"]) : undefined;
}

function releaseTrackArtistCredit(raw: Raw, choice: TrackChoice): string | undefined {
  if (!choice.releaseMbid) return undefined;
  const parsed = releaseSchema.safeParse(raw.releases?.[choice.releaseMbid]);
  if (!parsed.success) return undefined;
  const wanted = normalizeName(choice.title);
  for (const medium of parsed.data.media ?? []) {
    for (const track of medium.tracks ?? []) {
      const title = track.title ? normalizeName(track.title) : "";
      if (title !== wanted && !title.startsWith(`${wanted} - `) && !title.startsWith(`${wanted} (`)) continue;
      const credit = artistCreditString(track["artist-credit"])
        ?? artistCreditString(track.recording?.["artist-credit"]);
      if (credit) return credit;
    }
  }
  return undefined;
}

function searchKey(choice: Pick<TrackChoice, "title" | "artist">): string {
  return `${normalizeName(choice.artist)}\u0000${normalizeName(choice.title)}`;
}

const searchSchema = z.looseObject({
  recordings: z.array(z.looseObject({ score: z.number().nullish(), title: z.string().nullish(), "artist-credit": z.unknown().optional() })).nullish(),
});

function searchArtistCredit(raw: Raw, choice: TrackChoice): string | undefined {
  const parsed = searchSchema.safeParse(raw.searches?.[searchKey(choice)]);
  if (!parsed.success) return undefined;
  const wanted = normalizeName(choice.title);
  const match = (parsed.data.recordings ?? []).find((recording) =>
    (recording.score ?? 0) >= MUSICBRAINZ_SEARCH_MIN_SCORE && recording.title && normalizeName(recording.title) === wanted);
  return match ? artistCreditString(match["artist-credit"]) : undefined;
}

function trackArtistCredit(raw: Raw, choice: TrackChoice): string | undefined {
  if (choice.recordingMbid) return recordingArtistCredit(raw, choice.recordingMbid);
  if (choice.releaseMbid) return releaseTrackArtistCredit(raw, choice);
  return searchArtistCredit(raw, choice);
}

function resolvedChoice(window: Window, raw: Raw): Choice | undefined {
  return window.choice?.kind === "album" && !releaseGroupTitle(raw, window.choice.releaseGroupMbid)
    ? window.artist
    : window.choice;
}

function thingFor(choice: Choice, at: Date, sample: boolean, raw: Raw): FeedThing | undefined {
  let title: string;
  let href: string | undefined;
  let cover: string | undefined;
  let detail: string | undefined;
  if (choice.kind === "album") {
    const albumTitle = releaseGroupTitle(raw, choice.releaseGroupMbid);
    if (!albumTitle) return undefined;
    title = albumTitle;
    href = `https://musicbrainz.org/release-group/${choice.releaseGroupMbid}`;
    cover = `https://coverartarchive.org/release-group/${choice.releaseGroupMbid}/front-250`;
    detail = releaseGroupArtistCredit(raw, choice.releaseGroupMbid) ?? choice.artist;
  } else {
    title = choice.title;
    href = choice.href;
    if (choice.kind === "track") detail = trackArtistCredit(raw, choice) ?? choice.artist;
  }
  const event: HistoryEvent = {
    at,
    verb: choice.kind === "track" ? "top track" : choice.kind === "album" ? "top album" : "top artist",
    ...(detail ? { text: detail } : {}),
  };
  return {
    subject: choice.subject,
    kind: "note",
    title,
    ...(href ? { href } : {}),
    ...(cover ? { cover } : {}),
    history: [event],
    sample,
  };
}

function parse(raw: Raw, now: Date): { things: FeedThing[] } {
  const listens = parseListens(raw.listens, now);
  const windows = buildWindows(listens, now);
  const current = windows.find((window) => window.current);
  const currentChoice = current ? resolvedChoice(current, raw) : undefined;
  if (current && currentChoice) {
    const latestMonth = windows.find((window) => !window.current && window.monthKey === monthKey(latestListen(current.listens)));
    const latestChoice = latestMonth ? resolvedChoice(latestMonth, raw) : undefined;
    // Synthetic month-end dates must not outrank the real trailing-window listen.
    if (latestMonth && latestChoice && latestChoice.subject !== currentChoice.subject && latestMonth.at.getTime() >= current.at.getTime()) {
      latestMonth.at = new Date(current.at.getTime() - 1);
    }
  }
  const things = new Map<string, FeedThing>();
  for (const window of windows) {
    const choice = resolvedChoice(window, raw);
    if (!choice) continue;
    const at = window.at;
    const thing = thingFor(choice, at, raw.sample, raw);
    if (!thing) continue;
    const existing = things.get(thing.subject);
    if (existing) {
      existing.history.push(...thing.history);
      if (thing.href) existing.href ??= thing.href;
      if (thing.cover) existing.cover ??= thing.cover;
      existing.title = thing.title;
    } else things.set(thing.subject, thing);
  }
  return {
    things: [...things.values()].map((thing) => ({
      ...thing,
      history: [...new Map(thing.history.map((event) => [`${event.at.getTime()}\u0000${event.verb}`, event])).values()]
        .sort((a, b) => a.at.getTime() - b.at.getTime()),
    })),
  };
}

async function fetchListens(ctx: LiveContext, user: string, to: number): Promise<unknown[]> {
  let before = to;
  const listens: unknown[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < maxPages; page++) {
    if (page > 0) await sleep(1000, ctx.signal);
    const url = new URL(`${apiUrl}/user/${encodeURIComponent(user)}/listens`);
    url.searchParams.set("max_ts", String(before));
    url.searchParams.set("count", String(listensPerPage));
    const response = await getJson({ fetch: ctx.fetch, signal: ctx.signal }, url.toString(), {
      headers: { "User-Agent": userAgent },
    });
    const pageListens = responseSchema.parse(response).payload.listens;

    for (const listen of pageListens) {
      const parsed = listenSchema.safeParse(listen);
      const key = parsed.success && parsed.data.recording_msid
        ? `${parsed.data.listened_at}\u0000${parsed.data.recording_msid}`
        : JSON.stringify(listen);
      if (!seen.has(key)) {
        seen.add(key);
        listens.push(listen);
      }
    }
    if (pageListens.length < listensPerPage) break;

    const timestamps = pageListens.flatMap((listen) => {
      const parsed = listenSchema.safeParse(listen);
      return parsed.success ? [parsed.data.listened_at] : [];
    });
    if (timestamps.length === 0) throw new Error("ListenBrainz returned a full page without valid listen timestamps");
    const oldest = Math.min(...timestamps);
    const nextBefore = oldest + 1;
    if (nextBefore >= before) throw new Error("ListenBrainz listen pagination stalled");
    before = nextBefore;
  }

  return listens;
}

function luceneQuoted(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

function musicBrainzUrl(lookup: MusicBrainzLookup): string {
  if (lookup.kind === "search") {
    const query = `recording:${luceneQuoted(lookup.title ?? "")} AND artist:${luceneQuoted(lookup.artist ?? "")}`;
    return `https://musicbrainz.org/ws/2/recording?${new URLSearchParams({ query, limit: "5", fmt: "json" })}`;
  }
  const include = lookup.kind === "release" ? "artist-credits+recordings" : "artist-credits";
  return `https://musicbrainz.org/ws/2/${lookup.kind}/${lookup.mbid}?inc=${include}&fmt=json`;
}

async function lookupMusicBrainz(ctx: LiveContext, listens: unknown[]): Promise<Pick<Raw, "releaseGroups" | "recordings" | "releases" | "searches">> {
  const parsed = parseListens(listens, ctx.now);
  const queue = musicBrainzLookups(buildWindows(parsed, ctx.now));
  const cache = new Map<string, unknown>();
  for (const lookup of queue) {
    const key = lookupKey(lookup);
    if (cache.has(key)) continue;
    if (cache.size > 0) await sleep(1000, ctx.signal);
    const url = musicBrainzUrl(lookup);
    try {
      cache.set(key, await getJson({ fetch: ctx.fetch, signal: ctx.signal }, url, {
        headers: { "User-Agent": userAgent },
      }));
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      cache.set(key, null);
    }
  }
  const result = { releaseGroups: {}, recordings: {}, releases: {}, searches: {} } as Required<Pick<Raw, "releaseGroups" | "recordings" | "releases" | "searches">>;
  for (const lookup of queue) {
    const data = lookup.kind === "release-group" ? result.releaseGroups
      : lookup.kind === "recording" ? result.recordings
        : lookup.kind === "search" ? result.searches
          : result.releases;
    data[lookup.mbid] = cache.get(lookupKey(lookup));
  }
  return result;
}

async function live(ctx: LiveContext): Promise<Raw> {
  const user = ctx.env.LISTENBRAINZ_USER?.trim();
  if (!user) throw new Error("LISTENBRAINZ_USER is required");
  const listens = await fetchListens(ctx, user, Math.floor(ctx.now.getTime() / 1000));
  const musicBrainz = await lookupMusicBrainz(ctx, listens);
  return { sample: false, listens, ...musicBrainz };
}

export const listenbrainz: Adapter<Raw> = {
  id: "listenbrainz",
  pursuit: "music",
  liveTimeoutMs: 120000,
  env: ["LISTENBRAINZ_USER"],
  live,
  async fixture() {
    const [listens, releaseGroup] = await Promise.all([
      import("../../fixtures/listenbrainz/listens.sample.json"),
      import("../../fixtures/listenbrainz/release-group.sample.json"),
    ]);
    return {
      ...(listens.default as Omit<Raw, "releaseGroups">),
      releaseGroups: releaseGroup.default as Record<string, unknown>,
    };
  },
  parse(raw, ctx) {
    return parse(raw, ctx.now);
  },
};
