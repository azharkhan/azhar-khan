import { getCollection } from "astro:content";
import { loadEnv } from "../env";
import { buildNow } from "../now";
import { adapters } from "../feeds";
import { includeSamples } from "./policy";
import { runFeeds } from "./feeds";
import { buildGarden, type Garden } from "./build";
import type { HandEntry, Pursuit } from "./schema";

let cached: Promise<Garden> | undefined;

async function load(): Promise<Garden> {
  const env = loadEnv();
  const dev = import.meta.env.DEV;
  const now = buildNow(env);
  const [pursuitCollection, entryCollection] = await Promise.all([
    getCollection("pursuits"),
    getCollection("entries"),
  ]);
  const pursuits: Pursuit[] = pursuitCollection.map((entry) => ({ ...entry.data, id: entry.id }));
  const hand: HandEntry[] = entryCollection.map((entry) => ({
    id: entry.id,
    body: entry.body,
    data: entry.data as HandEntry["data"],
  }));
  const feeds = await runFeeds(adapters, { env, dev, now, timeoutMs: 30000 });
  return buildGarden({ pursuits, hand, feeds, now, samples: includeSamples({ env, dev }) });
}

export function getGarden(): Promise<Garden> {
  return cached ??= load();
}

export * from "./build";
export * from "./query";
export type * from "./schema";
