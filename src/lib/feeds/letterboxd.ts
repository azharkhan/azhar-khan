import type { Adapter, LiveContext } from "../garden/feeds";
import type { FeedThing, HistoryEvent } from "../garden/schema";
import { httpError, getText } from "./http";
import { asArray, decodeEntities, htmlToText, parseXml, text } from "./xml";

const rssUrl = "https://letterboxd.com/azhark/rss/";

type Film = {
  title: string;
  history: HistoryEvent[];
  href: string;
  cover?: string;
  metric?: FeedThing["metric"];
  metricAt?: Date;
  thought?: string;
  thoughtAt?: Date;
};

type Node = Record<string, unknown>;

function node(value: unknown): Node | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Node : undefined;
}

function image(description: string): string | undefined {
  const match = description.match(/<img\b[^>]*\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const source = match?.[1] ?? match?.[2] ?? match?.[3];
  return source ? decodeEntities(source) : undefined;
}

function review(description: string): string | undefined {
  const withoutExtras = description.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, (paragraph) => {
    if (/<img\b/i.test(paragraph) && !htmlToText(paragraph.replace(/<img\b[^>]*>/gi, "").replace(/<\/?a\b[^>]*>/gi, ""))) return "";
    if (/^This review may contain spoilers\.$/i.test(htmlToText(paragraph))) return "";
    return paragraph;
  });
  const result = htmlToText(withoutExtras);
  return /^Watched on .+\.$/.test(result) ? undefined : result || undefined;
}

function itemRecord(value: unknown): Node | undefined {
  return node(value);
}

function makeThing(slug: string, film: Film): FeedThing {
  return {
    subject: `letterboxd:${slug}`,
    kind: "note",
    title: film.title,
    href: `https://letterboxd.com/azhark/film/${slug}/`,
    cover: film.cover,
    thought: film.thought,
    metric: film.metric,
    history: film.history,
    sample: false,
  };
}

function parse(raw: string): { things: FeedThing[] } {
  const root = node(parseXml(raw).rss);
  const channel = node(root?.channel);
  if (!channel) throw new Error("not a Letterboxd RSS feed");

  const films = new Map<string, Film>();
  for (const value of asArray(channel.item)) {
    const item = itemRecord(value);
    if (!item) continue;
    const title = text(item["letterboxd:filmTitle"]);
    if (!title) continue;
    const link = text(item.link);
    const slug = link?.match(/\/film\/([^/]+)\//)?.[1];
    if (!slug || !link) continue;

    const watchedDate = text(item["letterboxd:watchedDate"]);
    const pubDate = text(item.pubDate);
    const description = text(item.description) ?? "";
    const event: HistoryEvent = {
      at: new Date(watchedDate ? `${watchedDate}T12:00:00Z` : pubDate!),
      verb: text(item["letterboxd:rewatch"]) === "Yes" ? "rewatched" : "watched",
      href: link,
      text: review(description),
    };
    const rawRating = text(item["letterboxd:memberRating"]);
    const rating = rawRating === undefined ? undefined : Number(rawRating);
    const film = films.get(slug) ?? {
      title,
      href: `https://letterboxd.com/azhark/film/${slug}/`,
      cover: image(description),
      history: [],
    };
    film.history.push(event);
    if (film.cover === undefined) film.cover = image(description);
    if (rating !== undefined && rating >= 0.5 && rating <= 5 && Number.isFinite(rating)
      && (!film.metricAt || event.at.getTime() >= film.metricAt.getTime())) {
      film.metric = { kind: "stars", value: rating };
      film.metricAt = event.at;
    }
    if (event.text && (!film.thoughtAt || event.at.getTime() >= film.thoughtAt.getTime())) {
      film.thought = event.text;
      film.thoughtAt = event.at;
    }
    films.set(slug, film);
  }

  return {
    things: [...films].map(([slug, film]) => {
      film.history.sort((a, b) => a.at.getTime() - b.at.getTime());
      return makeThing(slug, film);
    }),
  };
}

async function live(ctx: LiveContext): Promise<string> {
  const response = await getText(ctx, rssUrl, { headers: { "User-Agent": "azharkhan.net build" } });
  if (response.status !== 200) throw httpError(response.status, rssUrl);
  return response.body;
}

export const letterboxd: Adapter<string> = {
  id: "letterboxd",
  pursuit: "films",
  env: [],
  realFixture: true,
  live,
  async fixture() {
    return import("../../fixtures/letterboxd/rss.xml?raw").then((module) => module.default);
  },
  parse(raw) {
    return parse(raw);
  },
};
