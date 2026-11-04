import { z } from "astro/zod";
import type { Adapter, LiveContext } from "../garden/feeds";
import type { FeedThing, HistoryEvent } from "../garden/schema";
import { getJson } from "./http";

const defaultUrl = "https://sync.crosspointreader.com";
const unix = z.number().int().nonnegative();
const percentage = z.number().min(0).max(1);
const progressBookSchema = z.object({
  document: z.string().min(1),
  title: z.string().nullable(),
  percentage,
  timestamp: unix,
  status: z.string().nullable().optional(),
  status_at: unix.nullable().optional(),
  cover_url: z.string().nullable().optional(),
});
const progressSchema = z.object({ items: z.array(progressBookSchema) });
const activityBookSchema = z.object({
  document: z.string().min(1),
  started_at: unix.nullable(),
  last_at: unix.nullable().optional(),
  percentage,
  finished_at: unix.nullable(),
});
const activitySchema = z.object({ books: z.array(activityBookSchema) });

type Raw = { sample: boolean; progress: unknown; activity: unknown };
function timestamp(value: number): Date {
  return new Date(value * 1000);
}

function parse(raw: Raw): { things: FeedThing[] } {
  const progress = progressSchema.parse(raw.progress).items;
  const activity = activitySchema.parse(raw.activity).books;
  const activityByDocument = new Map(activity.map((book) => [book.document, book]));
  const things: FeedThing[] = [];

  for (const book of progress) {
    if (book.title === null) continue;
    const activityBook = activityByDocument.get(book.document);
    const finished = activityBook?.finished_at != null || book.status === "finished";
    const value = finished ? 100 : Math.round(book.percentage * 100);
    const history: HistoryEvent[] = [];
    if (activityBook?.started_at != null) history.push({ at: timestamp(activityBook.started_at), verb: "started" });
    if (finished) {
      const at = activityBook?.finished_at ?? (book.status === "finished" ? book.status_at ?? book.timestamp : undefined);
      if (at !== undefined) history.push({ at: timestamp(at), verb: "finished" });
    } else {
      history.push({
        at: timestamp(activityBook?.last_at ?? book.timestamp),
        verb: "progress",
        value,
        unit: "%",
      });
    }
    things.push({
      subject: `crosspoint:${book.document}`,
      kind: "note",
      title: book.title,
      cover: book.cover_url || undefined,
      metric: { kind: "progress", value },
      history,
      sample: raw.sample,
    });
  }

  return { things };
}

async function live(ctx: LiveContext): Promise<Raw> {
  const base = (ctx.env.CROSSPOINT_URL || defaultUrl).replace(/\/+$/, "");
  const headers = {
    "x-auth-user": ctx.env.CROSSPOINT_USER ?? "",
    "x-auth-key": ctx.env.CROSSPOINT_KEY ?? "",
  };
  const get = { fetch: ctx.fetch, signal: ctx.signal };
  const [progress, activity] = await Promise.all([
    getJson(get, `${base}/api/v1/progress?${new URLSearchParams({ limit: "100" })}`, { headers }),
    getJson(get, `${base}/api/v1/stats/activity?${new URLSearchParams({ tz: "0" })}`, { headers }),
  ]);
  return { sample: false, progress, activity };
}

export const crosspoint: Adapter<Raw> = {
  id: "crosspoint",
  pursuit: "reading",
  env: ["CROSSPOINT_USER", "CROSSPOINT_KEY"],
  live,
  async fixture() {
    return import("../../fixtures/crosspoint/progress-and-activity.sample.json").then((module) => module.default as Raw);
  },
  parse(raw) {
    return parse(raw);
  },
};
