import { z } from "astro/zod";
import type { Adapter, LiveContext } from "../garden/feeds";
import type { FeedThing, HistoryEvent } from "../garden/schema";
import { asArray } from "./xml";
import { getJson } from "./http";

const apiUrl = "https://ws.audioscrobbler.com/2.0/";
const unix = z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number).pipe(z.number().int().nonnegative());
const rangeSchema = z.object({ from: unix, to: unix });
const imageSchema = z.object({ "#text": z.string().optional(), size: z.string().optional() });
const artistSchema = z.union([z.string(), z.object({ "#text": z.string() })]);
const albumSchema = z.object({
  name: z.string().min(1),
  playcount: unix,
  url: z.url(),
  artist: artistSchema,
  image: z.union([z.array(imageSchema), imageSchema]).optional(),
  "@attr": z.object({ rank: z.union([z.string(), z.number().transform(String)]).optional() }).optional(),
});
const albumChartSchema = z.object({ weeklyalbumchart: z.object({ album: z.union([z.array(albumSchema), albumSchema]).optional() }) });
const chartListSchema = z.object({ weeklychartlist: z.object({ chart: z.union([z.array(rangeSchema), rangeSchema]).optional() }) });

export const MIN_ALBUM_PLAYS = 10;
export const WEEKS = 4;

type Raw = { sample: boolean; weeks: { from: number; to: number; chart: unknown }[] };
type Album = z.infer<typeof albumSchema>;
type Week = { from: number; to: number; chart: unknown };
type AlbumThing = { title: string; href: string; cover?: string; history: HistoryEvent[]; metric?: FeedThing["metric"]; metricAt: number };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function checkError(value: unknown): void {
  const data = record(value);
  if (data && "error" in data) throw new Error(`Last.fm error ${String(data.error)}: ${String(data.message ?? "unknown error")}`);
}

function url(params: Record<string, string>): string {
  return `${apiUrl}?${new URLSearchParams(params)}`;
}

async function request(ctx: LiveContext, params: Record<string, string>): Promise<unknown> {
  const result = await getJson({ fetch: ctx.fetch, signal: ctx.signal }, url(params));
  checkError(result);
  return result;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function artistName(artist: Album["artist"]): string {
  return typeof artist === "string" ? artist : artist["#text"];
}

function image(album: Album): string | undefined {
  const images = asArray(album.image).filter((candidate) => candidate["#text"]?.trim());
  const rank: Record<string, number> = { small: 0, medium: 1, large: 2, extralarge: 3, mega: 4 };
  const selected = [...images].sort((a, b) => (rank[a.size ?? ""] ?? -1) - (rank[b.size ?? ""] ?? -1)).at(-1);
  return selected?.["#text"] || undefined;
}

function albumsFrom(chart: unknown): Album[] {
  checkError(chart);
  const parsed = albumChartSchema.parse(chart);
  return asArray(parsed.weeklyalbumchart.album);
}

function parse(raw: Raw): { things: FeedThing[] } {
  const things = new Map<string, AlbumThing>();
  for (const week of raw.weeks) {
    const albums = albumsFrom(week.chart);
    const top = albums.find((album) => album["@attr"]?.rank === "1")
      ?? [...albums].sort((a, b) => b.playcount - a.playcount)[0];
    if (!top || top.playcount < MIN_ALBUM_PLAYS) continue;
    const artist = artistName(top.artist);
    const album = top.name;
    if (!artist.trim()) continue;
    const subject = `lastfm:${normalize(artist)}/${normalize(album)}`;
    const at = new Date(week.to * 1000);
    const event: HistoryEvent = { at, verb: "top-album-week", value: top.playcount, unit: "plays", text: artist };
    const existing = things.get(subject);
    if (existing) {
      existing.history.push(event);
      if (week.to >= existing.metricAt) {
        existing.metric = { kind: "count", value: top.playcount, unit: "plays" };
        existing.metricAt = week.to;
      }
      existing.cover ??= image(top);
    } else {
      things.set(subject, {
        title: album,
        href: top.url,
        cover: image(top),
        history: [event],
        metric: { kind: "count", value: top.playcount, unit: "plays" },
        metricAt: week.to,
      });
    }
  }

  return {
    things: [...things].map(([subject, album]) => ({
      subject,
      kind: "note",
      title: album.title,
      href: album.href,
      cover: album.cover,
      history: album.history.sort((a, b) => a.at.getTime() - b.at.getTime()),
      metric: album.metric,
      sample: raw.sample,
    })),
  };
}

async function live(ctx: LiveContext): Promise<Raw> {
  const user = ctx.env.LASTFM_USER ?? "";
  const apiKey = ctx.env.LASTFM_API_KEY ?? "";
  const common = { user, api_key: apiKey, format: "json" };
  const response = await request(ctx, { ...common, method: "user.getweeklychartlist" });
  const chartList = chartListSchema.parse(response);
  const ranges = asArray(chartList.weeklychartlist.chart)
    .filter((range) => range.to <= ctx.now.getTime() / 1000)
    .sort((a, b) => a.to - b.to)
    .slice(-WEEKS);
  const weeks: Week[] = await Promise.all(ranges.map(async ({ from, to }) => ({
    from,
    to,
    chart: await request(ctx, { ...common, method: "user.getweeklyalbumchart", from: String(from), to: String(to) }),
  })));
  return { sample: false, weeks };
}

export const lastfm: Adapter<Raw> = {
  id: "lastfm",
  pursuit: "music",
  env: ["LASTFM_USER", "LASTFM_API_KEY"],
  live,
  async fixture() {
    return import("../../fixtures/lastfm/weekly-album-charts.sample.json").then((module) => module.default as Raw);
  },
  parse(raw) {
    return parse(raw);
  },
};
