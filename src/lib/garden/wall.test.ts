import { describe, expect, it } from "vitest";
import type { GardenEntry } from "./schema";
import { blogLineTarget, cardContext, cardVariant, coverAspect, excerpt, isLongForm, LONG_FORM_WORD_THRESHOLD, plainText, proseWordCount, readMinutes } from "./wall";

function entry(overrides: Partial<GardenEntry> & { dek?: string } = {}): GardenEntry & { dek?: string } {
  return {
    id: "sample/entry",
    sources: [],
    kind: "note",
    title: "Sample entry",
    pursuits: ["board-games"],
    date: new Date("2026-01-01T00:00:00Z"),
    lastTouched: new Date("2026-01-01T00:00:00Z"),
    long: false,
    history: [],
    tags: [],
    connected: [],
    sample: true,
    ...overrides,
  };
}

describe("garden wall functions", () => {
  const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");

  it("detects long-form at the 400-word threshold", () => {
    expect(LONG_FORM_WORD_THRESHOLD).toBe(400);
    expect(isLongForm({ body: words(LONG_FORM_WORD_THRESHOLD - 1) })).toBe(false);
    expect(isLongForm({ body: words(LONG_FORM_WORD_THRESHOLD) })).toBe(true);
  });

  it("detects a short body with an H2 heading", () => {
    expect(isLongForm({ body: "## A brief heading\nJust a few words." })).toBe(true);
  });

  it("does not count fenced code, image syntax, link URLs or footnote definitions", () => {
    const code = ["```ts", words(400), "```"].join("\n");
    const body = `Keep [the link text](https://example.com) and <em>inline words</em>. ![ignored image](https://example.com/image.jpg) [^1]\n\n[^1]: ignored footnote\n\n${code}`;
    expect(proseWordCount(body)).toBe(7);
    expect(isLongForm({ body: code })).toBe(false);
  });

  it("detects a long feed thought", () => {
    expect(isLongForm({ thought: words(LONG_FORM_WORD_THRESHOLD) })).toBe(true);
  });

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

  it("targets the newest entry with prose in existing order", () => {
    expect(blogLineTarget({ entries: [entry(), entry({ id: "reading/book", body: "A few words." })] })).toBe("reading/book");
    expect(blogLineTarget({ entries: [entry()] })).toBeUndefined();
  });

  it("uses film poster proportions only for film pursuits", () => {
    expect(coverAspect(entry({ pursuits: ["films"] }))).toBe("2 / 3");
    expect(coverAspect(entry())).toBe("1 / 1");
  });

  it("builds music context from the latest top event and artist credit", () => {
    expect(cardContext(entry({ pursuits: ["music"], history: [
      { at: new Date("2026-10-31T23:00:00Z"), verb: "top album", text: "Older credit" },
      { at: new Date("2026-11-01T05:00:00Z"), verb: "top track", text: "Sample Artist" },
    ] }), 2026)).toBe("Top track, Nov 2026 · Sample Artist");
    expect(cardContext(entry({ pursuits: ["music"], history: [
      { at: new Date("2026-11-01T05:00:00Z"), verb: "top artist" },
    ] }), 2026)).toBe("Top artist, Nov 2026");
  });

  it("builds board-game, reading, and gaming context with pursuit metrics", () => {
    const late = new Date("2026-09-27T02:00:00Z");
    expect(cardContext(entry({ pursuits: ["board-games"], history: [{ at: late, verb: "played" }], metric: { kind: "times", value: 2 } }), 2026))
      .toBe("Played ×2 · last 26 Sep");
    expect(cardContext(entry({ pursuits: ["board-games"], history: [{ at: late, verb: "played" }] }), 2026))
      .toBe("Played · last 26 Sep");
    expect(cardContext(entry({ pursuits: ["reading"], history: [{ at: new Date("2025-11-05T12:00:00Z"), verb: "finished" }] }), 2026))
      .toBe("Finished 2025");
    expect(cardContext(entry({ pursuits: ["reading"], history: [{ at: late, verb: "progress", value: 47 }], metric: { kind: "progress", value: 47 } }), 2026))
      .toBe("Reading · 47%");
    expect(cardContext(entry({ pursuits: ["gaming"], history: [
      { at: new Date("2026-11-01T12:00:00Z"), verb: "played" },
      { at: new Date("2026-11-02T12:00:00Z"), verb: "unlocked" },
    ], metric: { kind: "count", value: 23, unit: "/80" } }), 2026))
      .toBe("Unlocked 23/80 · last played 1 Nov");
    expect(cardContext(entry({ pursuits: ["gaming"], history: [{ at: late, verb: "mastered" }] }), 2026))
      .toBe("Mastered 26 Sep");
    expect(cardContext(entry({ pursuits: ["gaming"], history: [{ at: new Date("2025-11-05T12:00:00Z"), verb: "played" }] }), 2026))
      .toBe("Played 5 Nov 2025");
  });

  it("combines film ratings and cubing values into one context line", () => {
    const watched = new Date("2026-11-02T12:00:00Z");
    expect(cardContext(entry({ pursuits: ["films"], history: [{ at: watched, verb: "rewatched" }], metric: { kind: "stars", value: 4.5 } }), 2026))
      .toBe("★★★★½ · watched 2 Nov");
    expect(cardContext(entry({ pursuits: ["films"], history: [{ at: watched, verb: "watched" }] }), 2026))
      .toBe("watched 2 Nov");
    expect(cardContext(entry({ kind: "stat", pursuits: ["cubing"], stat: { label: "Single", value: 118, unit: "s" } }), 2026))
      .toBe("Single 1:58");
    expect(cardContext(entry({ pursuits: ["fitness"] }), 2026)).toBeUndefined();
  });
});
