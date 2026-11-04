import { describe, expect, it } from "vitest";
import type { GardenEntry } from "./schema";
import { blogLineTarget, cardVariant, coverAspect, excerpt, plainText, readMinutes } from "./wall";

function entry(overrides: Partial<GardenEntry> & { dek?: string } = {}): GardenEntry & { dek?: string } {
  return {
    id: "sample/entry",
    sources: [],
    kind: "note",
    title: "Sample entry",
    pursuits: ["board-games"],
    date: new Date("2026-01-01T00:00:00Z"),
    lastTouched: new Date("2026-01-01T00:00:00Z"),
    growth: "seedling",
    long: false,
    history: [],
    tags: [],
    connected: [],
    sample: true,
    ...overrides,
  };
}

describe("garden wall functions", () => {
  it("chooses still, cover and text cards", () => {
    expect(cardVariant(entry({ kind: "photo" }))).toBe("still");
    expect(cardVariant(entry({ cover: "https://example.com/cover.jpg" }))).toBe("cover");
    expect(cardVariant(entry())).toBe("text");
  });

  it("converts long-form markdown to plain text without losing placeholders", () => {
    const body = `<figure class="wide">\n\n![photo alt](./table.jpg)\n\n<figcaption>[placeholder: caption]</figcaption>\n</figure>\n\nParagraph **bold** with [a link](https://example.com) and [placeholder: keep].\n\n> quoted words\n\n[^1]\n\n[^1]: hidden footnote\n\n\`\`\`ts\nconst hidden = 2;\n\`\`\``;
    expect(plainText(body)).toBe("[placeholder: caption] Paragraph bold with a link and [placeholder: keep]. quoted words");
  });

  it("cuts excerpts at a word boundary and gives dek precedence", () => {
    expect(excerpt(entry({ body: "One two three four five six seven" }), 15)).toBe("One two three…");
    expect(excerpt(entry({ body: "Body text", dek: "[placeholder: dek]" }))).toBe("[placeholder: dek]");
  });

  it("estimates reading time with a one-minute minimum", () => {
    expect(readMinutes("A short entry.")).toBe(1);
    expect(readMinutes(Array.from({ length: 460 }, () => "word").join(" "))).toBe(2);
  });

  it("targets the newest non-seedling entry in existing order", () => {
    expect(blogLineTarget({ entries: [entry(), entry({ id: "reading/book", growth: "evergreen" })] })).toBe("reading/book");
    expect(blogLineTarget({ entries: [entry()] })).toBeUndefined();
  });

  it("uses film poster proportions only for film pursuits", () => {
    expect(coverAspect(entry({ pursuits: ["films"] }))).toBe("2 / 3");
    expect(coverAspect(entry())).toBe("1 / 1");
  });
});
