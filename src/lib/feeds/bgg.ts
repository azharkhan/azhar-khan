import type { Adapter, LiveContext } from "../garden/feeds";
import type { FeedThing, HistoryEvent, ShelfGame } from "../garden/schema";
import { loadBggCovers, type BggCovers } from "./bgg-covers";
import { loadBggPlays, type BggPlay } from "./bgg-plays";
import { loadBggShelf } from "./bgg-shelf";
import { getText, httpError, sleep } from "./http";
import { asArray, attr, parseXml, text } from "./xml";

const baseUrl = "https://boardgamegeek.com/xmlapi2";

type BggRaw = {
  sample: boolean;
  collection: string;
  plays: string[];
  fallback?: { plays: BggPlay[]; shelf?: ShelfGame[] };
  covers?: BggCovers;
};
type Node = Record<string, unknown>;
type Play = { id: string; date: string; quantity: number; comments: string[]; title?: string; thumb?: string };
type OwnedGame = { title: string; cover?: string; added?: Date };
type Game = { id: string; title: string; cover?: string; history: HistoryEvent[] };

type BggOptions = { retryDelayMs?: number; maxAttempts?: number; maxPages?: number };

function node(value: unknown): Node | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Node : undefined;
}

function number(value: unknown): number | undefined {
  const raw = typeof value === "string" ? value : text(value) ?? attr(value, "value");
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(value: unknown): string | undefined {
  const root = node(value);
  if (!root) return text(value);
  const nested = Array.isArray(root.error) ? root.error[0] : root.error;
  const error = node(nested) ?? root;
  return text(error.message) ?? attr(error, "message") ?? text(nested);
}

function parsedRoot(xml: string, expected: string): Node {
  const document = parseXml(xml);
  const error = document.errors ?? document.error;
  if (error !== undefined) throw new Error(errorMessage(error) ?? "BGG API error");
  const root = node(document[expected]);
  if (!root) {
    const message = text(document.message);
    throw new Error(message ?? `unexpected BGG XML response: missing ${expected}`);
  }
  return root;
}

function utcTimestamp(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return new Date(normalized);
}

function playDate(value: string | undefined): Date | undefined {
  if (!value || value === "0000-00-00" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : date;
}

function yearAgo(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return cutoff;
}

async function bggGet(
  ctx: LiveContext,
  path: string,
  token: string,
  retryDelayMs: number,
  maxAttempts: number,
): Promise<string> {
  const url = `${baseUrl}${path}`;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await getText(ctx, url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 200) return response.body;
    if (response.status !== 202 && response.status !== 429) throw httpError(response.status, url);
    if (attempt < maxAttempts) await sleep(retryDelayMs, ctx.signal);
  }
  throw new Error(`BGG ${path} still queued after ${maxAttempts} attempts`);
}

function thingsFromPlays(
  playRows: Iterable<Play>,
  owned: Map<string, OwnedGame>,
  playedNames: Map<string, string>,
  sample: boolean,
  now: Date,
  covers: BggCovers = {},
): FeedThing[] {
  const cutoff = yearAgo(now);
  const games = new Map<string, Game>();
  for (const [id, game] of owned) {
    games.set(id, {
      id,
      title: game.title,
      cover: game.cover,
      history: game.added ? [{ at: game.added, verb: "added" }] : [],
    });
  }
  for (const play of playRows) {
    const at = playDate(play.date)!;
    const game = games.get(play.id) ?? {
      id: play.id,
      title: playedNames.get(play.id) ?? play.title ?? "",
      history: [],
    };
    if (!game.title) continue;
    const event: HistoryEvent = {
      at,
      verb: "played",
      value: play.quantity,
      text: play.comments.length ? play.comments.join("\n") : undefined,
    };
    game.history.push(event);
    games.set(play.id, game);
  }

  return [...games.values()].flatMap((game) => {
    const history = game.history
      .filter((event) => event.at >= cutoff && event.at <= now)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const newestComment = [...history].reverse().find((event) => event.text?.trim())?.text;
    const playEvents = history.filter((event) => event.verb === "played");
    const hasRecentActivity = Boolean(newestComment || playEvents.length || history.some((event) => event.verb === "added"));
    if (!hasRecentActivity) return [];

    const total = playEvents.reduce((sum, event) => sum + (event.value ?? 0), 0);
    return [{
      subject: `bgg:${game.id}`,
      kind: "note",
      title: game.title,
      href: `https://boardgamegeek.com/boardgame/${game.id}`,
      cover: covers[game.id] ?? game.cover,
      history,
      metric: total > 0 ? { kind: "times", value: total } : undefined,
      thought: newestComment,
      sample,
    }];
  });
}

function parseFallback(raw: BggRaw & { fallback: NonNullable<BggRaw["fallback"]> }, now: Date): { things: FeedThing[]; shelf: ShelfGame[] } {
  const shelf = raw.fallback.shelf ?? [];
  const shelfById = new Map(shelf.map((game) => [game.id, game]));
  const playRows = new Map<string, Play>();
  const playedNames = new Map<string, string>();
  for (const play of raw.fallback.plays) {
    const at = playDate(play.date);
    if (!at) continue;
    const key = `${play.id}\u0000${play.date}`;
    const existing = playRows.get(key);
    if (existing) {
      existing.quantity++;
      existing.thumb ??= play.thumb;
    } else playRows.set(key, { id: play.id, date: play.date, quantity: 1, comments: [], title: play.name, thumb: play.thumb });
    playedNames.set(play.id, play.name);
  }

  const owned = new Map<string, OwnedGame>();
  for (const [id, play] of [...playRows.values()].map((play) => [play.id, play] as const)) {
    const game = shelfById.get(id);
    const previous = owned.get(id);
    owned.set(id, {
      title: play.title ?? game?.name ?? previous?.title ?? "",
      cover: play.thumb ?? previous?.cover ?? game?.cover,
    });
  }
  return { things: thingsFromPlays(playRows.values(), owned, playedNames, false, now, raw.covers), shelf };
}

function parse(raw: BggRaw, now: Date): { things: FeedThing[]; shelf?: ShelfGame[] } {
  if (raw.fallback) return parseFallback(raw as BggRaw & { fallback: NonNullable<BggRaw["fallback"]> }, now);
  const collection = parsedRoot(raw.collection, "items");
  const collectionItems = asArray(collection.item).map(node).filter((item): item is Node => item !== undefined);
  const owned = new Map<string, { title: string; cover?: string; added?: Date }>();
  const shelf: ShelfGame[] = [];

  for (const item of collectionItems) {
    const status = node(item.status);
    if (attr(status, "own") !== "1") continue;
    const id = attr(item, "objectid");
    const title = text(item.name);
    if (!id || !title) continue;
    const stats = node(item.stats);
    const rating = number(attr(node(stats?.rating), "value"));
    const year = number(item.yearpublished);
    const minPlayers = number(attr(stats, "minplayers")) ?? 0;
    const maxPlayers = number(attr(stats, "maxplayers")) ?? 0;
    const minutes = number(attr(stats, "playingtime")) || number(attr(stats, "maxplaytime")) || 0;
    const plays = number(item.numplays) ?? number(attr(item.numplays, "value")) ?? 0;
    const added = utcTimestamp(attr(status, "lastmodified"));
    const cover = text(item.thumbnail);
    owned.set(id, { title, cover, added });
    shelf.push({
      id,
      name: title,
      year,
      minPlayers,
      maxPlayers,
      minutes,
      plays,
      rating,
      href: `https://boardgamegeek.com/boardgame/${id}`,
    });
  }

  const playRows = new Map<string, Play>();
  const playedNames = new Map<string, string>();
  for (const xml of raw.plays) {
    const root = parsedRoot(xml, "plays");
    for (const playNode of asArray(root.play)) {
      const play = node(playNode);
      if (!play) continue;
      const date = attr(play, "date");
      const at = playDate(date);
      const item = node(play.item);
      const id = attr(item, "objectid");
      if (!at || !date || !id) continue;
      const quantity = number(attr(play, "quantity")) ?? 1;
      const key = `${id}\u0000${date}`;
      const comments = text(play.comments);
      const existing = playRows.get(key);
      if (existing) {
        existing.quantity += quantity;
        if (comments) existing.comments.push(comments);
      } else {
        playRows.set(key, { id, date, quantity, comments: comments ? [comments] : [], title: attr(item, "name") });
      }
      const title = attr(item, "name");
      if (title) playedNames.set(id, title);
    }
  }

  return { things: thingsFromPlays(playRows.values(), owned, playedNames, raw.sample, now, raw.covers), shelf };
}

export function createBggAdapter({ retryDelayMs = 2000, maxAttempts = 6, maxPages = 10 }: BggOptions = {}): Adapter<BggRaw> {
  return {
    id: "bgg",
    pursuit: "board-games",
    env: ["BGG_TOKEN"],
    realFixture: true,
    async live(ctx) {
      const token = ctx.env.BGG_TOKEN ?? "";
      const collection = await bggGet(
        ctx,
        "/collection?username=azharkhan&own=1&stats=1&subtype=boardgame&excludesubtype=boardgameexpansion",
        token,
        retryDelayMs,
        maxAttempts,
      );
      const plays: string[] = [];
      for (let page = 1; page <= maxPages; page++) {
        const xml = await bggGet(ctx, `/plays?username=azharkhan&type=thing&subtype=boardgame&page=${page}`, token, retryDelayMs, maxAttempts);
        plays.push(xml);
        const root = parsedRoot(xml, "plays");
        const pagePlays = asArray(root.play);
        const total = number(attr(root, "total"));
        if (pagePlays.length < 100 || (total !== undefined && page * 100 >= total)) break;
      }
      return { sample: false, collection, plays, covers: await loadBggCovers() };
    },
    async fixture() {
      const [collection, plays] = await Promise.all([
        import("../../fixtures/bgg/collection.sample.xml?raw").then((module) => module.default),
        import("../../fixtures/bgg/plays.sample.xml?raw").then((module) => module.default),
      ]);
      return { sample: true, collection, plays: [plays] };
    },
    async realFallback() {
      const [data, shelf, covers] = await Promise.all([loadBggPlays(), loadBggShelf(), loadBggCovers()]);
      return { sample: false, collection: "", plays: [], fallback: { plays: data?.plays ?? [], shelf }, covers };
    },
    parse(raw, { now }) {
      return parse(raw, now);
    },
  };
}

export const bgg = createBggAdapter();
