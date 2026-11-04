import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { entrySchema, pursuitSchema } from "./lib/garden/schema";

export const collections = {
  pursuits: defineCollection({
    loader: glob({ pattern: "*.md", base: "./src/content/pursuits" }),
    schema: pursuitSchema,
  }),
  entries: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/entries" }),
    schema: ({ image }) => entrySchema(image()),
  }),
};
