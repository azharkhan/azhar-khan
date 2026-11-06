import { z } from "astro/zod";
import type { Adapter, LiveContext } from "../garden/feeds";
import type { FeedThing, HistoryEvent } from "../garden/schema";
import { getJson } from "./http";

const baseUrl = "https://retroachievements.org/API";
const mediaUrl = "https://media.retroachievements.org";
const recentTimestampSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value.replace(" ", "T")}Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19).replace("T", " ") === value;
  });
const isoInstantSchema = z.string().refine((value) => Number.isFinite(new Date(value).getTime()));
const idSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).transform(String);
const recentSchema = z.object({
  Date: recentTimestampSchema,
  GameID: idSchema,
  GameTitle: z.string().min(1),
  GameIcon: z.string(),
  ConsoleName: z.string(),
  Title: z.string(),
});
const awardSchema = z.object({
  AwardType: z.enum(["Game Beaten", "Mastery/Completion"]),
  AwardData: idSchema,
  AwardDataExtra: z.union([z.number(), z.string()]).optional(),
  AwardedAt: isoInstantSchema,
  Title: z.string().min(1).nullish(),
  ImageIcon: z.string().nullish(),
});
const awardsSchema = z.object({ VisibleUserAwards: z.array(z.unknown()) });

type Raw = { sample: boolean; recent: unknown; awards: unknown; played: unknown };
type Game = {
  id: string;
  title: string;
  icon?: string;
  progress?: { achieved: number; possible: number };
  unlocks: Map<string, { at: Date; count: number }>;
  history: HistoryEvent[];
};

function date(value: string): Date {
  return new Date(value.includes(" ") ? `${value.replace(" ", "T")}Z` : value);
}

function cover(icon: string | undefined): string | undefined {
  if (!icon) return undefined;
  return icon.startsWith("http") ? icon : `${mediaUrl}${icon.startsWith("/") ? "" : "/"}${icon}`;
}

function group(games: Map<string, Game>, id: string, title: string, icon?: string): Game {
  const existing = games.get(id);
  if (existing) {
    if (!existing.title && title) existing.title = title;
    if (!existing.icon && icon) existing.icon = icon;
    return existing;
  }
  const game = { id, title, icon, unlocks: new Map(), history: [] };
  games.set(id, game);
  return game;
}

function nonnegativeInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function addRecentlyPlayed(games: Map<string, Game>, values: unknown): void {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    if (!item) continue;
    const id = idSchema.safeParse(item.GameID);
    const title = typeof item.Title === "string" && item.Title.trim() ? item.Title : undefined;
    if (!id.success || !title || typeof item.LastPlayed !== "string") continue;
    const at = date(item.LastPlayed);
    if (!Number.isFinite(at.getTime())) continue;

    const icon = typeof item.ImageIcon === "string" && item.ImageIcon ? item.ImageIcon : undefined;
    const game = group(games, id.data, title, icon);
    game.history.push({ at, verb: "played" });

    const possible = nonnegativeInteger(item.NumPossibleAchievements);
    if (possible !== undefined) {
      game.progress = { achieved: nonnegativeInteger(item.NumAchieved) ?? 0, possible };
    }
  }
}

function parse(raw: Raw): { things: FeedThing[] } {
  if (!Array.isArray(raw.recent)) throw new Error("unexpected RetroAchievements response");
  const recent = z.array(recentSchema).parse(raw.recent);
  const awards = awardsSchema.parse(raw.awards).VisibleUserAwards
    .filter((value) => {
      const award = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
      return award?.AwardType === "Game Beaten" || award?.AwardType === "Mastery/Completion";
    })
    .map((value) => awardSchema.parse(value));
  const games = new Map<string, Game>();

  for (const achievement of recent) {
    const game = group(games, achievement.GameID, achievement.GameTitle, achievement.GameIcon);
    const at = date(achievement.Date);
    const day = achievement.Date.slice(0, 10);
    const existing = game.unlocks.get(day);
    if (existing) {
      existing.count += 1;
      if (at.getTime() > existing.at.getTime()) existing.at = at;
    } else {
      game.unlocks.set(day, { at, count: 1 });
    }
  }

  addRecentlyPlayed(games, raw.played);

  for (const award of awards) {
    const verb = award.AwardType === "Game Beaten"
      ? "beaten"
      : award.AwardType === "Mastery/Completion"
        ? Number(award.AwardDataExtra) === 1 ? "mastered" : "completed"
        : undefined;
    if (!verb) continue;
    const existing = games.get(award.AwardData);
    const title = award.Title ?? "";
    if (!title && !existing?.title) continue;
    const game = group(games, award.AwardData, title, award.ImageIcon ?? undefined);
    game.history.push({ at: date(award.AwardedAt), verb });
  }

  return {
    things: [...games.values()].map((game) => {
      const unlockEvents: HistoryEvent[] = [...game.unlocks.values()].map(({ at, count }) => ({
        at,
        verb: "unlocked",
        value: count,
        unit: "achievements",
      }));
      const history = [...unlockEvents, ...game.history].sort((a, b) => a.at.getTime() - b.at.getTime());
      const unlockCount = [...game.unlocks.values()].reduce((sum, row) => sum + row.count, 0);
      return {
        subject: `retroachievements:${game.id}`,
        kind: "note",
        title: game.title,
        href: `https://retroachievements.org/game/${game.id}`,
        cover: cover(game.icon),
        history,
        metric: unlockCount > 0
          ? { kind: "count", value: unlockCount, unit: "new" }
          : game.progress && game.progress.possible > 0
            ? { kind: "count", value: game.progress.achieved, unit: `/${game.progress.possible}` }
            : undefined,
        sample: raw.sample,
      };
    }),
  };
}

async function live(ctx: LiveContext): Promise<Raw> {
  const user = ctx.env.RA_USER ?? "";
  const key = ctx.env.RA_KEY ?? "";
  const params = new URLSearchParams({ u: user, y: key });
  const recentUrl = `${baseUrl}/API_GetUserRecentAchievements.php?${new URLSearchParams({ ...Object.fromEntries(params), m: "43200" })}`;
  const awardsUrl = `${baseUrl}/API_GetUserAwards.php?${params}`;
  const playedUrl = `${baseUrl}/API_GetUserRecentlyPlayedGames.php?${new URLSearchParams({ ...Object.fromEntries(params), c: "50" })}`;
  const [recent, awards, played] = await Promise.all([
    getJson({ fetch: ctx.fetch, signal: ctx.signal }, recentUrl),
    getJson({ fetch: ctx.fetch, signal: ctx.signal }, awardsUrl),
    getJson({ fetch: ctx.fetch, signal: ctx.signal }, playedUrl),
  ]);
  return { sample: false, recent, awards, played };
}

export const retroachievements: Adapter<Raw> = {
  id: "retroachievements",
  pursuit: "gaming",
  env: ["RA_USER", "RA_KEY"],
  live,
  async fixture() {
    return import("../../fixtures/retroachievements/recent-and-awards.sample.json").then((module) => module.default as Raw);
  },
  parse(raw) {
    return parse(raw);
  },
};
