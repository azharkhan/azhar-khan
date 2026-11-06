import { describe, expect, it } from "vitest";
import { z } from "astro/zod";
import { entrySchema, feedThingSchema, metricSchema, pursuitSchema } from "./schema";

const pursuit = {
  title: "Films",
  icon: "film-slate",
  since: 2019,
  blurb: "[placeholder: Films blurb]",
};

const entryBase = {
  title: "Sample entry",
  pursuits: ["films"],
  date: "2026-10-01",
};

describe("pursuitSchema", () => {
  it("applies defaults", () => {
    expect(pursuitSchema.parse(pursuit)).toMatchObject({ colour: "none" });
  });

  it("rejects a bad colour", () => {
    expect(pursuitSchema.safeParse({ ...pursuit, colour: "purple" }).success).toBe(false);
  });

  it("requires a blurb", () => {
    const { blurb: _blurb, ...missingBlurb } = pursuit;
    expect(pursuitSchema.safeParse(missingBlurb).success).toBe(false);
  });

  it("rejects an unknown icon", () => {
    expect(pursuitSchema.safeParse({ ...pursuit, icon: "not-an-icon" }).success).toBe(false);
  });

  it("makes since an optional numeric year", () => {
    const { since: _since, ...withoutSince } = pursuit;
    expect(pursuitSchema.safeParse(withoutSince).success).toBe(true);
    expect(pursuitSchema.safeParse({ ...pursuit, since: 2019 }).success).toBe(true);
    expect(pursuitSchema.safeParse({ ...pursuit, since: "2019" }).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(pursuitSchema.safeParse({ ...pursuit, extra: true }).success).toBe(false);
  });
});

describe("entrySchema", () => {
  const schema = entrySchema(z.string());

  for (const [kind, extra] of [
    ["note", {}],
    ["photo", { photo: "./sample.jpg", alt: "Sample photo" }],
    ["link", { url: "https://example.com" }],
    ["milestone", {}],
    ["stat", { label: "ao5", value: 21.9 }],
  ] as const) {
    it(`parses ${kind} entries`, () => {
      expect(schema.safeParse({ ...entryBase, kind, ...extra }).success).toBe(true);
    });
  }

  it("accepts a dek and rejects an empty one", () => {
    expect(schema.safeParse({ ...entryBase, kind: "note", dek: "[placeholder: dek]" }).success).toBe(true);
    expect(schema.safeParse({ ...entryBase, kind: "note", dek: "" }).success).toBe(false);
  });

  it("rejects a long-form frontmatter flag", () => {
    expect(schema.safeParse({ ...entryBase, kind: "note", long: true }).success).toBe(false);
  });

  it("requires a stat value", () => {
    expect(schema.safeParse({ ...entryBase, kind: "stat", label: "ao5" }).success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(schema.safeParse({ ...entryBase, kind: "unknown" }).success).toBe(false);
  });
});

describe("feed schemas", () => {
  it("rejects star metrics outside half-star increments", () => {
    expect(metricSchema.safeParse({ kind: "stars", value: 4.3 }).success).toBe(false);
  });

  it("coerces history timestamps to Date", () => {
    const thing = feedThingSchema.parse({
      subject: "sample:film",
      title: "Sample film",
      history: [{ at: "2026-10-31T12:00:00Z", verb: "watched" }],
    });
    expect(thing.history[0]?.at).toBeInstanceOf(Date);
    expect(thing.history[0]?.at.toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });
});
