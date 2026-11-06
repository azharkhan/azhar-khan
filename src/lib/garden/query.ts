import type { Garden } from "./build";
import { dayMonth, yearOf } from "../dates";
import type { GardenEntry, Metric, Pursuit } from "./schema";

export type CurrentlyItem = { title: string; id: string; href?: string };
export type CurrentlyRow =
  | { pursuit: Pursuit; state: "latest"; entry: GardenEntry; metric?: Metric; detail?: string; items?: CurrentlyItem[] }
  | { pursuit: Pursuit; state: "blurb"; blurb: string };

export function entriesFor(garden: Garden, pursuitId: string): GardenEntry[] {
  return garden.entries
    .filter((entry) => entry.pursuits.includes(pursuitId))
    .sort((a, b) => b.lastTouched.getTime() - a.lastTouched.getTime() || a.id.localeCompare(b.id));
}

export function statMetric(garden: Garden, entry: GardenEntry, pursuitId: string): Metric | undefined {
  if (entry.kind !== "stat" || !entry.stat) return undefined;
  const label = entry.stat.label.trim();
  const series = garden.entries
    .filter((candidate) => candidate.kind === "stat" && candidate.stat?.label.trim() === label && candidate.pursuits.includes(pursuitId))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  const index = series.findIndex((candidate) => candidate.id === entry.id);
  const previous = index > 0
    ? series[index - 1]?.stat
    : index < 0
      ? series.filter((candidate) => candidate.date.getTime() < entry.date.getTime()).at(-1)?.stat
      : undefined;
  const change = previous ? Number((entry.stat.value - previous.value).toFixed(2)) : undefined;
  return { kind: "stat", label, value: entry.stat.value, unit: entry.stat.unit, change };
}

export function currently(garden: Garden): CurrentlyRow[] {
  const pursuits = garden.pursuits
    .filter((pursuit) => pursuit.currently !== undefined)
    .sort((a, b) => a.currently! - b.currently!);

  const rows: CurrentlyRow[] = [];
  for (const pursuit of pursuits) {
    const entries = entriesFor(garden, pursuit.id);
    let entry: GardenEntry | undefined = pursuit.id === "cubing"
      ? entries.find((candidate) => candidate.kind === "stat" && candidate.stat?.label.trim().toLowerCase() === "single") ?? entries[0]
      : entries[0];
    let detail: string | undefined;
    let items: CurrentlyItem[] | undefined;
    if (pursuit.id === "board-games") {
      const playsByGame = new Map<string, { entry: GardenEntry; at: Date }>();
      let latestPlayedAt: Date | undefined;
      for (const candidate of entries) {
        for (const event of candidate.history) {
          if (event.verb !== "played" || event.at.getTime() > garden.now.getTime()) continue;
          const previous = playsByGame.get(candidate.id);
          if (!previous || event.at.getTime() > previous.at.getTime()) playsByGame.set(candidate.id, { entry: candidate, at: event.at });
          if (!latestPlayedAt || event.at.getTime() > latestPlayedAt.getTime()) latestPlayedAt = event.at;
        }
      }
      entry = undefined;
      if (latestPlayedAt) {
        const latestDay = `${yearOf(latestPlayedAt)}-${dayMonth(latestPlayedAt)}`;
        const games = [...playsByGame.values()]
          .filter((game) => `${yearOf(game.at)}-${dayMonth(game.at)}` === latestDay)
          .sort((a, b) => b.at.getTime() - a.at.getTime() || a.entry.title.localeCompare(b.entry.title) || a.entry.id.localeCompare(b.entry.id));
        const shown = games.slice(0, 3);
        entry = shown[0]?.entry;
        items = shown.map(({ entry: game }) => ({
          title: game.title,
          id: game.id,
          ...(game.href ? { href: game.href } : {}),
        }));
      }
    }
    if (entry) {
      rows.push({ pursuit, state: "latest", entry, metric: entry.metric ?? statMetric(garden, entry, pursuit.id), detail, ...(items ? { items } : {}) });
      continue;
    }

    const unavailable = garden.feeds.some((feed) => {
      if (feed.pursuit !== pursuit.id) return false;
      if (feed.mode === "off") return feed.adapter !== "bgg" || garden.shelf.length === 0;
      if (!feed.error) return false;
      if (feed.adapter === "bgg" && garden.shelf.length > 0) return false;
      return !garden.entries.some((candidate) => candidate.pursuits.includes(pursuit.id) && candidate.sources.includes(feed.adapter));
    });
    if (!unavailable) rows.push({ pursuit, state: "blurb", blurb: pursuit.blurb });
  }
  return rows;
}

export type StatSeries = { pursuit: string; label: string; unit?: string; points: { at: Date; value: number; entryId: string }[] };

export function statSeries(garden: Garden, pursuitId: string, min = 3): StatSeries[] {
  const groups = new Map<string, { unit?: string; points: StatSeries["points"] }>();
  for (const entry of garden.entries) {
    if (!entry.pursuits.includes(pursuitId) || entry.kind !== "stat" || !entry.stat) continue;
    const label = entry.stat.label.trim();
    let group = groups.get(label);
    if (!group) {
      group = { unit: entry.stat.unit, points: [] };
      groups.set(label, group);
    } else if (group.unit !== entry.stat.unit) {
      throw new Error(`stat unit mismatch for ${pursuitId}/${label}`);
    }
    group.points.push({ at: entry.date, value: entry.stat.value, entryId: entry.id });
  }

  return [...groups.entries()]
    .filter(([, group]) => group.points.length >= min)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, group]) => ({
      pursuit: pursuitId,
      label,
      unit: group.unit,
      points: group.points.sort((a, b) => a.at.getTime() - b.at.getTime() || a.entryId.localeCompare(b.entryId)),
    }));
}
