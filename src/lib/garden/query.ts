import type { Garden } from "./build";
import type { GardenEntry, Metric, Pursuit } from "./schema";

export type CurrentlyRow =
  | { pursuit: Pursuit; state: "latest"; entry: GardenEntry; metric?: Metric }
  | { pursuit: Pursuit; state: "blurb"; blurb: string; entry?: GardenEntry };
export type CurrentlyOptions = { now?: Date; staleDays?: number };

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

export function currently(garden: Garden, opts: CurrentlyOptions = {}): CurrentlyRow[] {
  const now = opts.now ?? garden.now;
  const staleDays = opts.staleDays ?? 30;
  const pursuits = garden.pursuits
    .filter((pursuit) => pursuit.currently !== undefined)
    .sort((a, b) => a.currently! - b.currently!);

  const rows: CurrentlyRow[] = [];
  for (const pursuit of pursuits) {
    const entry = entriesFor(garden, pursuit.id)[0];
    if (entry && now.getTime() - entry.lastTouched.getTime() <= staleDays * 86400000) {
      rows.push({ pursuit, state: "latest", entry, metric: entry.metric ?? statMetric(garden, entry, pursuit.id) });
      continue;
    }

    const unavailable = garden.feeds.some((feed) => {
      if (feed.pursuit !== pursuit.id) return false;
      if (feed.mode === "off") return true;
      if (!feed.error) return false;
      return !garden.entries.some((candidate) => candidate.pursuits.includes(pursuit.id) && candidate.sources.includes(feed.adapter));
    });
    if (!unavailable) rows.push({ pursuit, state: "blurb", blurb: pursuit.blurb, entry });
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
