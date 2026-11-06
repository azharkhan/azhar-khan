export type InlinePart = { text: string; href?: string };

const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function inlineLinks(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[1]!, href: match[2]! });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function plainInline(text: string): string {
  return inlineLinks(text).map((part) => part.text).join("");
}
