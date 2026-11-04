import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export function parseXml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object" && "#text" in value) return text(value["#text"]);
  return undefined;
}

export function attr(node: unknown, name: string): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  return text((node as Record<string, unknown>)[`@_${name}`]);
}

export function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|#039|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
      "&#039;": "'",
      "&apos;": "'",
      "&nbsp;": " ",
    };
    const replacement = named[entity.toLowerCase()];
    if (replacement !== undefined) return replacement;
    const hex = entity.match(/^&#x([\da-f]+);$/i);
    const decimal = entity.match(/^&#(\d+);$/);
    const point = hex ? Number.parseInt(hex[1]!, 16) : decimal ? Number.parseInt(decimal[1]!, 10) : NaN;
    if (!Number.isInteger(point) || point < 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return entity;
    return String.fromCodePoint(point);
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, ""))
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n\n");
}
