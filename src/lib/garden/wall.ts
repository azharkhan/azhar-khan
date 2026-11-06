import type { Garden } from "./build";
import { dayMonth, yearOf, ZONE } from "../dates";
import { formatStatValue } from "./stats";
import type { GardenEntry, HistoryEvent, Metric } from "./schema";

export const LONG_FORM_WORD_THRESHOLD = 400;

export type CardVariant = "still" | "cover" | "text";

export function cardVariant(entry: GardenEntry): CardVariant {
  if (entry.kind === "photo") return "still";
  if (entry.cover) return "cover";
  return "text";
}

function stripFences(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  let fence: { marker: string; length: number } | undefined;
  for (const line of lines) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && match) {
      fence = { marker: match[1]![0]!, length: match[1]!.length };
      continue;
    }
    if (fence) {
      const close = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (close && close[1]![0] === fence.marker && close[1]!.length >= fence.length) fence = undefined;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

export function plainText(markdown: string): string {
  return stripFences(markdown)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^ {0,3}\[\^[^\]]+\]:.*(?:\n[ \t]+.*)*/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\^[^\]]+\]/g, " ")
    .replace(/^ {0,3}#{1,6}[ \t]*/gm, "")
    .replace(/^ {0,3}>[ \t]?/gm, "")
    .replace(/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

export function excerpt(entry: GardenEntry, max = 160): string | undefined {
  const dek = (entry as GardenEntry & { dek?: string }).dek;
  const text = dek?.trim() || plainText(entry.body ?? "") || plainText(entry.thought ?? "");
  if (!text) return undefined;
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  const start = text.slice(0, max - 1);
  const boundary = start.lastIndexOf(" ");
  return `${(boundary > 0 ? start.slice(0, boundary) : start).trimEnd()}…`;
}

export function proseWordCount(markdown: string): number {
  return plainText(markdown).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function hasMarkdownH2(markdown: string): boolean {
  const withoutCode = stripFences(markdown).replace(/<!--[\s\S]*?-->/g, "");
  return /^ {0,3}(?:>[ \t]?)*##(?:[ \t]+|$)/m.test(withoutCode);
}

export function isLongForm(entry: { body?: string; thought?: string }): boolean {
  return hasMarkdownH2(entry.body ?? "")
    || proseWordCount(entry.body ?? "") >= LONG_FORM_WORD_THRESHOLD
    || proseWordCount(entry.thought ?? "") >= LONG_FORM_WORD_THRESHOLD;
}

export function readMinutes(markdown: string): number {
  const words = plainText(markdown).match(/\S+/g)?.length ?? 0;
  return Math.max(1, Math.round(words / 230));
}

export function blogLineTarget(garden: Pick<Garden, "entries">): string | undefined {
  return garden.entries.find((entry) => entry.long || entry.body?.trim() || entry.thought?.trim())?.id;
}

export function coverAspect(entry: GardenEntry): string {
  return entry.pursuits.includes("films") ? "2 / 3" : "1 / 1";
}

function latestEvent(events: HistoryEvent[]): HistoryEvent | undefined {
  return events.reduce<HistoryEvent | undefined>((latest, event) =>
    !latest || event.at.getTime() > latest.at.getTime() ? event : latest, undefined);
}

function contextDate(date: Date, buildYear: number): string {
  const day = dayMonth(date);
  const year = yearOf(date);
  return year === buildYear ? day : `${day} ${year}`;
}

function monthYear(date: Date): string {
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: ZONE }).format(date);
}

function starText(value: number): string {
  return "★".repeat(Math.floor(value)) + (value % 1 ? "½" : "");
}

function progressValue(metric: Metric | undefined, event: HistoryEvent): number | undefined {
  const value = metric?.kind === "progress" ? metric.value : event.value;
  return value === undefined ? undefined : Math.max(0, Math.min(100, Math.round(value)));
}

export function cardContext(entry: GardenEntry, buildYear: number, metric = entry.metric): string | undefined {
  if (entry.kind === "stat" && entry.stat && entry.pursuits.includes("cubing")) {
    return `${entry.stat.label} ${formatStatValue(entry.stat.value, entry.stat.unit)}`;
  }

  const event = latestEvent(entry.history);
  if (!event) return undefined;

  if (entry.pursuits.includes("music") && ["top track", "top album", "top artist"].includes(event.verb)) {
    const label = event.verb.replace(/^top /, "Top ");
    const credit = event.verb === "top artist" ? undefined : event.text?.trim();
    return `${label}, ${monthYear(event.at)}${credit ? ` · ${credit}` : ""}`;
  }

  if (entry.pursuits.includes("board-games")) {
    const played = latestEvent(entry.history.filter((candidate) => candidate.verb === "played"));
    if (!played) return undefined;
    const count = metric?.kind === "times"
      ? metric.value
      : entry.history.filter((candidate) => candidate.verb === "played").length;
    return `Played${count === 1 ? "" : ` ×${count}`} · last ${contextDate(played.at, buildYear)}`;
  }

  if (entry.pursuits.includes("reading")) {
    if (event.verb === "finished") return `Finished ${yearOf(event.at)}`;
    if (event.verb === "read") return `Read ${yearOf(event.at)}`;
    if (event.verb === "started" || event.verb === "progress") {
      const progress = progressValue(metric, event);
      return `Reading${progress === undefined ? "" : ` · ${progress}%`}`;
    }
  }

  if (entry.pursuits.includes("gaming")) {
    if (event.verb === "beaten" || event.verb === "mastered") {
      return `${event.verb === "beaten" ? "Beaten" : "Mastered"} ${contextDate(event.at, buildYear)}`;
    }
    const played = latestEvent(entry.history.filter((candidate) => candidate.verb === "played"));
    const progress = metric?.kind === "count" && /^\/\d+$/.test(metric.unit)
      ? `Unlocked ${metric.value}${metric.unit} · `
      : "";
    return `${progress}${progress ? "last played" : "Played"} ${contextDate(played?.at ?? event.at, buildYear)}`;
  }

  if (entry.pursuits.includes("films")) {
    const rating = metric?.kind === "stars" ? `${starText(metric.value)} · ` : "";
    return `${rating}watched ${contextDate(event.at, buildYear)}`;
  }

  return undefined;
}
