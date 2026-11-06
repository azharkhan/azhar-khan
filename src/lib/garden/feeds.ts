import type { Env } from "../now";
import type { FeedMode, Gate, PolicyContext } from "./policy";
import { fallbackMode, feedMode, missingVars } from "./policy";
import { feedOutputSchema, feedThingSchema, shelfGameSchema, type FeedThing, type ShelfGame } from "./schema";

export type LiveContext = { env: Env; now: Date; fetch: typeof fetch; signal: AbortSignal };
export type FeedOutput = { things: FeedThing[]; shelf?: ShelfGame[] };

export interface Adapter<Raw = unknown> extends Gate {
  id: string;
  pursuit: string;
  liveTimeoutMs?: number;
  live(ctx: LiveContext): Promise<Raw>;
  fixture(): Promise<Raw>;
  realFallback?(): Promise<Raw>;
  parse(raw: Raw, ctx: { now: Date }): FeedOutput;
}

export type FeedStatus = { adapter: string; pursuit: string; mode: FeedMode; error?: string; dropped: number };
export type FeedResult = FeedStatus & FeedOutput;
export type RunOptions = PolicyContext & { now: Date; fetch?: typeof fetch; timeoutMs?: number; log?: (line: string) => void; bggShelf?: ShelfGame[] };

type ParsedFeedOutput = { things: unknown[]; shelf?: unknown[] };

function redactMessage(message: string, adapter: Adapter, env: Env): string {
  for (const name of adapter.env) {
    const secret = env[name];
    if (secret) {
      message = message.replaceAll(secret, "***").replaceAll(encodeURIComponent(secret), "***");
    }
  }
  return message;
}

function messageOf(error: unknown, adapter: Adapter, env: Env): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactMessage(message, adapter, env);
}

function parseOutput(adapter: Adapter, raw: unknown, now: Date): ParsedFeedOutput {
  return feedOutputSchema.parse(adapter.parse(raw, { now }));
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new Error("feed timed out"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (cause) => {
        cleanup();
        reject(cause);
      },
    );
  });
}

export async function runFeeds(adapters: readonly Adapter[], opts: RunOptions): Promise<FeedResult[]> {
  return Promise.all(adapters.map(async (adapter) => {
    const missing = missingVars(adapter, opts.env);
    const bggShelf = adapter.id === "bgg" ? opts.bggShelf : undefined;
    let mode = feedMode(adapter, opts);
    let error: string | undefined;
    let output: ParsedFeedOutput | undefined;
    const log = opts.log ?? console.warn;
    const report = (message: string) => log(`[feeds] ${adapter.id}: ${redactMessage(message, adapter, opts.env)}`);

    if (mode === "off") {
      if (missing.length > 0) {
        error = `missing env vars: ${missing.join(", ")}`;
        report(error);
      }
      return {
        adapter: adapter.id,
        pursuit: adapter.pursuit,
        mode,
        error,
        dropped: 0,
        things: [],
        ...(bggShelf === undefined ? {} : { shelf: bggShelf }),
      };
    }

    if (mode === "live") {
      try {
        const signal = AbortSignal.timeout(adapter.liveTimeoutMs ?? opts.timeoutMs ?? 10000);
        const raw = await raceAbort(adapter.live({
          env: opts.env,
          now: opts.now,
          fetch: opts.fetch ?? globalThis.fetch,
          signal,
        }), signal);
        output = parseOutput(adapter, raw, opts.now);
      } catch (cause) {
        error = messageOf(cause, adapter, opts.env);
        report(`live failed: ${error}`);
        mode = fallbackMode(adapter, opts);
      }
    }

    if (mode === "fixture") {
      if (adapter.realFallback && opts.env.FEEDS !== "fixtures") {
        try {
          const raw = await adapter.realFallback();
          output = parseOutput(adapter, raw, opts.now);
        } catch (cause) {
          const fallbackError = messageOf(cause, adapter, opts.env);
          error = error ? `${error}; fallback failed: ${fallbackError}` : fallbackError;
          report(`fallback failed: ${fallbackError}`);
          mode = "off";
        }
      } else if (bggShelf !== undefined) {
        output = { things: [], shelf: bggShelf };
      } else {
        try {
          const raw = await adapter.fixture();
          output = parseOutput(adapter, raw, opts.now);
        } catch (cause) {
          const fixtureError = messageOf(cause, adapter, opts.env);
          error = error ? `${error}; fixture failed: ${fixtureError}` : fixtureError;
          report(`fixture failed: ${fixtureError}`);
          mode = "off";
        }
      }
    }

    if (mode === "off" || !output) {
      return {
        adapter: adapter.id,
        pursuit: adapter.pursuit,
        mode: "off",
        error,
        dropped: 0,
        things: [],
        ...(bggShelf === undefined ? {} : { shelf: bggShelf }),
      };
    }

    let dropped = 0;
    const things: FeedThing[] = [];
    for (const thing of output.things) {
      const parsed = feedThingSchema.safeParse(thing);
      if (parsed.success) things.push(parsed.data);
      else {
        dropped += 1;
        report(`dropped invalid thing: ${parsed.error.message}`);
      }
    }

    let shelf: ShelfGame[] | undefined;
    if (output.shelf) {
      shelf = [];
      for (const game of output.shelf) {
        const parsed = shelfGameSchema.safeParse(game);
        if (parsed.success) shelf.push(parsed.data);
        else {
          dropped += 1;
          report(`dropped invalid shelf game: ${parsed.error.message}`);
        }
      }
    }

    return { adapter: adapter.id, pursuit: adapter.pursuit, mode, error, dropped, things, shelf };
  }));
}
