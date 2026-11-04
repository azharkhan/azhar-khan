import type { CurrentlyRow } from "../garden/query";
import type { Colour, GardenEntry, Metric } from "../garden/schema";
import { shortDate } from "../dates";

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
      return { kind: "text", text: `${metric.value} ${metric.unit}` };
    case "progress": {
      const value = Math.max(0, Math.min(100, Math.round(metric.value)));
      return { kind: "progress", value, text: `${value}%` };
    }
    case "stat": {
      const result: MetricView = { kind: "stat", text: `${metric.label} ${metric.value}${metric.unit ?? ""}` };
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
  const base = {
    key,
    label: row.state === "blurb" ? row.pursuit.title : row.pursuit.verb ?? row.pursuit.title,
    icon: row.pursuit.icon,
    colour: row.pursuit.colour,
    italic: ITALIC_PURSUITS.has(key),
  };
  if (row.state === "blurb") return { ...base, blurb: row.blurb };

  const metric = row.metric ? metricView(row.metric) : undefined;
  const review = row.metric?.kind === "stars" ? reviewLine(row.entry) : undefined;
  const stub = review
    ? { title: row.entry.title, line: review.line, date: shortDate(review.at), iso: review.at.toISOString() }
    : undefined;
  return {
    ...base,
    title: row.entry.title,
    href: row.entry.href ?? row.entry.url,
    metric,
    stub,
  };
}
