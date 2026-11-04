import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ImageMetadata } from "astro";
import { z } from "astro/zod";

export const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const placeholder = z.string().regex(/^\[placeholder: [^\]]+\]$/);
export const subject = z.string().regex(/^[a-z0-9-]+:[^\s]+$/);
export const colour = z.enum(["red", "green", "yellow", "blue", "none"]);
export const kind = z.enum(["note", "photo", "link", "milestone", "stat"]);
export const growth = z.enum(["seedling", "budding", "evergreen"]);
export const toy = z.enum(["cube-timer", "model-viewer"]);

export const icon = z.string().regex(/^[a-z0-9-]+$/)
  .refine((name) => existsSync(resolve("src/icons", `${name}.svg`)), "no such icon in src/icons");

export const kitItem = z.strictObject({ name: z.string().min(1), why: z.string().optional(), href: z.url().optional() });

export const pursuitSchema = z.strictObject({
  title: z.string().min(1),
  verb: z.string().min(1).optional(),
  icon,
  colour: colour.default("none"),
  since: z.union([z.number().int().min(1980).max(2100), placeholder]),
  blurb: z.string().min(1),
  kit: z.array(kitItem).default([]),
  toy: toy.optional(),
  currently: z.number().int().min(1).optional(),
});

export const statFields = { label: z.string().trim().min(1), value: z.number(), unit: z.string().min(1).optional() };
export const statSchema = z.strictObject(statFields);

export function entrySchema<I extends z.ZodType>(image: I) {
  const base = z.strictObject({
    title: z.string().min(1),
    pursuits: z.array(slug).min(1),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    subject: subject.optional(),
    hidden: z.boolean().default(false),
    sample: z.boolean().default(false),
    long: z.boolean().default(false),
    dek: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).default([]),
    connected: z.array(z.string().min(1)).default([]),
    cover: image.optional(),
  });
  return z.discriminatedUnion("kind", [
    base.extend({ kind: z.literal("note") }),
    base.extend({ kind: z.literal("photo"), photo: image, alt: z.string().min(1), caption: z.string().optional() }),
    base.extend({ kind: z.literal("link"), url: z.url() }),
    base.extend({ kind: z.literal("milestone") }),
    base.extend({ kind: z.literal("stat"), ...statFields }),
  ]);
}

export const historyEventSchema = z.strictObject({
  at: z.coerce.date(),
  verb: z.string().min(1),
  text: z.string().optional(),
  value: z.number().optional(),
  unit: z.string().optional(),
  href: z.url().optional(),
});

export const metricSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stars"), value: z.number().min(0.5).max(5).multipleOf(0.5) }),
  z.strictObject({ kind: z.literal("times"), value: z.number().int().min(1) }),
  z.strictObject({ kind: z.literal("count"), value: z.number().int().min(0), unit: z.string().min(1) }),
  z.strictObject({ kind: z.literal("progress"), value: z.number().min(0).max(100) }),
  z.strictObject({ kind: z.literal("stat"), ...statFields, change: z.number().optional() }),
]);

export const feedThingSchema = z.strictObject({
  subject,
  kind: kind.default("note"),
  title: z.string().min(1),
  href: z.url().optional(),
  cover: z.string().min(1).optional(),
  thought: z.string().min(1).optional(),
  stat: statSchema.optional(),
  metric: metricSchema.optional(),
  history: z.array(historyEventSchema).min(1),
  sample: z.boolean().default(false),
});

export const shelfGameSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  year: z.number().int().optional(),
  minPlayers: z.number().int().min(1),
  maxPlayers: z.number().int().min(1),
  minutes: z.number().int().min(1),
  plays: z.number().int().min(0),
  rating: z.number().min(0).max(10).optional(),
  href: z.url().optional(),
});

export const feedOutputSchema = z.object({
  things: z.array(z.unknown()),
  shelf: z.array(z.unknown()).optional(),
});

export type ImageSource = ImageMetadata | string;
export type Colour = z.infer<typeof colour>;
export type Kind = z.infer<typeof kind>;
export type Growth = z.infer<typeof growth>;
export type PursuitData = z.output<typeof pursuitSchema>;
export type Pursuit = PursuitData & { id: string };
export type EntryData = z.output<ReturnType<typeof entrySchema<z.ZodType<ImageSource>>>>;
export type HandEntry = { id: string; body?: string; data: EntryData };
export type Stat = z.output<typeof statSchema>;
export type HistoryEvent = z.output<typeof historyEventSchema>;
export type Metric = z.output<typeof metricSchema>;
export type FeedThing = z.output<typeof feedThingSchema>;
export type ShelfGame = z.output<typeof shelfGameSchema>;

export type GardenEntry = {
  id: string;
  sources: string[];
  subject?: string;
  kind: Kind;
  title: string;
  pursuits: string[];
  date: Date;
  lastTouched: Date;
  growth: Growth;
  long: boolean;
  dek?: string;
  body?: string;
  thought?: string;
  href?: string;
  url?: string;
  cover?: ImageSource;
  photo?: { src: ImageSource; alt: string; caption?: string };
  stat?: Stat;
  metric?: Metric;
  history: HistoryEvent[];
  tags: string[];
  connected: string[];
  sample: boolean;
};
