import type { Garden } from "./build";
import type { GardenEntry } from "./schema";

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

export function readMinutes(markdown: string): number {
  const words = plainText(markdown).match(/\S+/g)?.length ?? 0;
  return Math.max(1, Math.round(words / 230));
}

export function blogLineTarget(garden: Pick<Garden, "entries">): string | undefined {
  return garden.entries.find((entry) => entry.growth === "budding" || entry.growth === "evergreen")?.id;
}

export function coverAspect(entry: GardenEntry): string {
  return entry.pursuits.includes("films") ? "2 / 3" : "1 / 1";
}
