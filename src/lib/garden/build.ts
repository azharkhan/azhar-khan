import { createHash } from "node:crypto";
import type { FeedResult, FeedStatus } from "./feeds";
import type { Growth, GardenEntry, HandEntry, HistoryEvent, Pursuit, ShelfGame, Stat } from "./schema";

export type BuildInput = { pursuits: Pursuit[]; hand: HandEntry[]; feeds: FeedResult[]; now: Date; samples: boolean };
export type Garden = { now: Date; pursuits: Pursuit[]; entries: GardenEntry[]; feeds: FeedStatus[]; shelf: ShelfGame[] };

export function growthOf(entry: { long: boolean; body?: string; thought?: string }): Growth {
  if (entry.long) return "evergreen";
  if (entry.body?.trim() || entry.thought?.trim()) return "budding";
  return "seedling";
}

function compareHistory(a: HistoryEvent, b: HistoryEvent): number {
  return a.at.getTime() - b.at.getTime() || a.verb.localeCompare(b.verb);
}

function mergeHistory(a: HistoryEvent[], b: HistoryEvent[]): HistoryEvent[] {
  const seen = new Set<string>();
  return [...a, ...b]
    .filter((event) => {
      const key = `${event.at.getTime()}\u0000${event.verb}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareHistory);
}

function dateMin(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function dateMax(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function normalizeHandDate(date: Date): Date {
  if (date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) return date;
  const normalized = new Date(date);
  normalized.setUTCHours(12);
  return normalized;
}

function handEntry(entry: HandEntry): GardenEntry {
  const data = entry.data;
  const date = normalizeHandDate(data.date);
  const updated = data.updated ? normalizeHandDate(data.updated) : undefined;
  const body = entry.body?.trim();
  const stat: Stat | undefined = data.kind === "stat"
    ? { label: data.label, value: data.value, unit: data.unit }
    : undefined;
  const photo = data.kind === "photo"
    ? { src: data.photo, alt: data.alt, caption: data.caption }
    : undefined;
  return {
    id: entry.id,
    sources: ["hand"],
    subject: data.subject,
    kind: data.kind,
    title: data.title,
    pursuits: data.pursuits,
    date,
    lastTouched: updated ?? date,
    growth: growthOf({ long: data.long, body }),
    long: data.long,
    dek: data.dek,
    body: body || undefined,
    url: data.kind === "link" ? data.url : undefined,
    cover: data.cover,
    photo,
    stat,
    history: [],
    tags: data.tags,
    connected: data.connected,
    sample: data.sample,
  };
}

function feedEntry(feed: FeedResult, thing: FeedResult["things"][number]): GardenEntry {
  const history = [...thing.history].sort(compareHistory);
  const date = history[0]!.at;
  const lastTouched = history[history.length - 1]!.at;
  const subjectPart = thing.subject.slice(thing.subject.indexOf(":") + 1);
  const slug = subjectPart.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const idPart = slug || `item-${createHash("sha256").update(thing.subject).digest("hex").slice(0, 8)}`;
  return {
    id: `${feed.pursuit}/${idPart}`,
    sources: [feed.adapter],
    subject: thing.subject,
    kind: thing.kind,
    title: thing.title,
    pursuits: [feed.pursuit],
    date,
    lastTouched,
    growth: growthOf({ long: false, thought: thing.thought }),
    long: false,
    thought: thing.thought,
    href: thing.href,
    cover: thing.cover,
    stat: thing.stat,
    metric: thing.metric,
    history,
    tags: [],
    connected: [],
    sample: thing.sample,
  };
}

export function buildGarden(input: BuildInput): Garden {
  const currently = new Set<number>();
  for (const pursuit of input.pursuits) {
    if (pursuit.currently === undefined) continue;
    if (currently.has(pursuit.currently)) throw new Error(`duplicate currently value: ${pursuit.currently}`);
    currently.add(pursuit.currently);
  }

  const pursuits = [...input.pursuits].sort((a, b) => {
    if (a.currently !== undefined && b.currently !== undefined) return a.currently - b.currently;
    if (a.currently !== undefined) return -1;
    if (b.currently !== undefined) return 1;
    return a.title.localeCompare(b.title);
  });
  const pursuitIds = new Set(pursuits.map((pursuit) => pursuit.id));

  for (const entry of input.hand) {
    for (const pursuit of entry.data.pursuits) {
      if (!pursuitIds.has(pursuit)) throw new Error(`entry ${entry.id}: unknown pursuit ${pursuit}`);
    }
  }
  for (const feed of input.feeds) {
    if (!pursuitIds.has(feed.pursuit)) throw new Error(`feed ${feed.adapter}: unknown pursuit ${feed.pursuit}`);
  }

  const seenHandSubjects = new Set<string>();
  for (const entry of input.hand) {
    const subject = entry.data.subject;
    if (!subject) continue;
    if (seenHandSubjects.has(subject)) throw new Error(`duplicate hand subject: ${subject}`);
    seenHandSubjects.add(subject);
  }

  const hand = input.hand.filter((entry) => input.samples || !entry.data.sample);
  const handEntries = hand.map(handEntry);
  const hiddenHandIds = new Set(hand.filter((entry) => entry.data.hidden).map((entry) => entry.id));
  const handBySubject = new Map<string, GardenEntry>();
  for (const entry of handEntries) {
    if (entry.subject) handBySubject.set(entry.subject, entry);
  }

  const groups = new Map<string, { feed: FeedResult; thing: FeedResult["things"][number] }>();
  for (const feed of input.feeds) {
    for (const thing of feed.things) {
      if (!input.samples && thing.sample) continue;
      const key = `${feed.adapter}\u0000${thing.subject}`;
      const previous = groups.get(key);
      if (previous) {
        groups.set(key, {
          feed,
          thing: { ...previous.thing, ...thing, history: mergeHistory(previous.thing.history, thing.history) },
        });
      } else {
        groups.set(key, { feed, thing });
      }
    }
  }

  const unmatchedFeeds: GardenEntry[] = [];
  for (const { feed, thing } of groups.values()) {
    const entry = feedEntry(feed, thing);
    const handMatch = thing.subject ? handBySubject.get(thing.subject) : undefined;
    if (!handMatch) {
      unmatchedFeeds.push(entry);
      continue;
    }
    const merged: GardenEntry = {
      ...entry,
      ...handMatch,
      pursuits: [...new Set([...handMatch.pursuits, ...entry.pursuits])],
      sources: [...new Set([...handMatch.sources, ...entry.sources])],
      cover: handMatch.cover ?? entry.cover,
      stat: handMatch.stat ?? entry.stat,
      date: dateMin(handMatch.date, entry.date),
      lastTouched: dateMax(handMatch.lastTouched, entry.lastTouched),
      thought: entry.thought,
      metric: entry.metric,
      history: mergeHistory(handMatch.history, entry.history),
      sample: handMatch.sample || entry.sample,
    };
    const index = handEntries.findIndex((candidate) => candidate.id === handMatch.id);
    if (index >= 0) handEntries[index] = merged;
    handBySubject.set(thing.subject, merged);
  }

  const visibleHand = handEntries.filter((entry) => !hiddenHandIds.has(entry.id));
  const visibleFeeds = unmatchedFeeds;
  const ids = new Set(visibleHand.map((entry) => entry.id));
  for (const entry of visibleFeeds) {
    const base = entry.id;
    let id = base;
    let suffix = 2;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    entry.id = id;
    ids.add(id);
  }

  const entries = [...visibleHand, ...visibleFeeds]
    .map((entry) => ({ ...entry, growth: growthOf(entry) }))
    .map((entry) => ({ ...entry, connected: entry.connected.filter((id) => ids.has(id)) }))
    .sort((a, b) => b.lastTouched.getTime() - a.lastTouched.getTime() || a.id.localeCompare(b.id));
  const feeds: FeedStatus[] = input.feeds.map(({ adapter, pursuit, mode, error, dropped }) => ({ adapter, pursuit, mode, error, dropped }));
  const shelf = input.feeds.flatMap((feed) => input.samples || !feed.things.some((thing) => thing.sample) ? feed.shelf ?? [] : []);

  return { now: input.now, pursuits, entries, feeds, shelf };
}
