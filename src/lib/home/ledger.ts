import type { CurrentlyRow } from "../garden/query";
import type { Colour, GardenEntry, Metric } from "../garden/schema";
import { formatDuration, formatStatValue } from "../garden/stats";
import { shortDate } from "../dates";
import { pursuitPath } from "../garden/routes";

export type MetricView =
  | { kind: "stars"; text: string; label: string }
  | { kind: "text"; text: string }
  | { kind: "progress"; value: number; text: string }
  | { kind: "stat"; text: string; change?: string };
export type Stub = { title: string; line: string; date: string; iso: string };
export type LedgerRow = {
  key: string;
  label: string;
  icon: string;
  colour: Colour;
  title?: string;
  href?: string;
  external?: boolean;
  items?: { title: string; href?: string }[];
  detail?: string;
  italic: boolean;
  blurb?: string;
  metric?: MetricView;
  stub?: Stub;
};

export const ITALIC_PURSUITS: ReadonlySet<string> = new Set(["films", "reading", "gaming"]);

export function stars(value: number): string {
  return "★".repeat(Math.floor(value)) + (value % 1 ? "½" : "");
}

export function metricView(metric: Metric): MetricView {
  switch (metric.kind) {
    case "stars":
      return { kind: "stars", text: stars(metric.value), label: metric.value === 1 ? "1 star" : `${metric.value} stars` };
    case "times":
      return { kind: "text", text: `×${metric.value}` };
    case "count":
      return { kind: "text", text: metric.unit.startsWith("/") ? `${metric.value}${metric.unit}` : `${metric.value} ${metric.unit}` };
    case "progress": {
      const value = Math.max(0, Math.min(100, Math.round(metric.value)));
      return { kind: "progress", value, text: `${value}%` };
    }
    case "stat": {
      const result: MetricView = { kind: "stat", text: `${metric.label} ${formatStatValue(metric.value, metric.unit)}` };
      if (metric.change !== undefined) {
        const change = metric.change < 0
          ? `−${Math.abs(metric.change)}`
          : metric.change > 0
            ? `+${metric.change}`
            : "±0";
        return { ...result, change };
      }
      return result;
    }
  }
}

export function reviewLine(entry: GardenEntry): { line: string; at: Date } | undefined {
  const event = entry.history.reduce<typeof entry.history[number] | undefined>((latest, candidate) => {
    if (!candidate.text?.trim()) return latest;
    return !latest || candidate.at.getTime() >= latest.at.getTime() ? candidate : latest;
  }, undefined);
  const text = event?.text ?? entry.thought;
  const line = text?.split("\n", 1)[0]?.trim();
  if (!line) return undefined;
  return { line, at: event?.at ?? entry.lastTouched };
}

export function ledgerRow(row: CurrentlyRow): LedgerRow {
  const key = row.pursuit.id;
  const latestEvent = row.state === "latest"
    ? row.entry.history.reduce<typeof row.entry.history[number] | undefined>((latest, candidate) =>
      !latest || candidate.at.getTime() >= latest.at.getTime() ? candidate : latest, undefined)
    : undefined;
  const label = row.state === "blurb"
    ? row.pursuit.verb ?? row.pursuit.title
    : key === "cubing" && row.entry.kind === "stat"
      ? "Solving"
      : row.pursuit.verb ?? row.pursuit.title;
  const base = {
    key,
    label,
    icon: row.pursuit.icon,
    colour: row.pursuit.colour,
    italic: ITALIC_PURSUITS.has(key),
  };
  if (row.state === "blurb") return { ...base, blurb: row.blurb };

  const currentSolve = key === "cubing" && row.entry.kind === "stat" ? row.entry.stat : undefined;
  const currentSolveMetric: MetricView | undefined = currentSolve && row.metric?.kind === "stat"
    ? {
      kind: "stat",
      text: formatStatValue(currentSolve.value, currentSolve.unit),
      ...(row.metric.change !== undefined ? {
        change: `${row.metric.change < 0 ? "↓" : row.metric.change > 0 ? "↑" : "→"}${row.metric.unit === "s" ? formatDuration(Math.abs(row.metric.change)) : formatStatValue(Math.abs(row.metric.change), row.metric.unit)}`,
      } : {}),
    }
    : undefined;
  const metric = key === "board-games"
    ? undefined
    : currentSolve ? currentSolveMetric : row.metric ? metricView(row.metric) : undefined;
  const review = row.metric?.kind === "stars" ? reviewLine(row.entry) : undefined;
  const stub = review
    ? { title: row.entry.title, line: review.line, date: shortDate(review.at), iso: review.at.toISOString() }
    : undefined;
  return {
    ...base,
    ...(row.items
      ? { items: row.items.map((item) => ({ title: item.title.trim(), href: item.href })) }
      : {
        title: currentSolve ? "3×3 Rubik’s Cube" : row.entry.title,
        href: row.entry.href ?? pursuitPath(key),
        external: row.entry.href !== undefined,
      }),
    detail: currentSolve
      ? undefined
      : row.detail ?? (key === "music" && (latestEvent?.verb === "top track" || latestEvent?.verb === "top album")
        ? latestEvent.text
        : undefined),
    metric,
    stub,
  };
}
