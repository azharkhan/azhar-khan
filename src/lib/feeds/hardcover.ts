import type { Adapter, LiveContext } from "../garden/feeds";
import type { FeedThing, HistoryEvent } from "../garden/schema";
import { getJson } from "./http";

const endpoint = "https://api.hardcover.app/v1/graphql";
const query = `query HardcoverReadingFeed {
  me {
    account_privacy_setting_id
    activity_privacy_settings_id
    user_books(where: {status_id: {_in: [2, 3]}, privacy_setting_id: {_eq: 1}}, order_by: {updated_at: desc_nulls_last}, limit: 100) {
      status_id
      privacy_setting_id
      date_added
      updated_at
      book {
        id
        title
        pages
        image { url }
      }
      edition { pages }
      user_book_reads(order_by: {id: desc}, limit: 1) {
        started_at
        finished_at
        progress_pages
        edition { pages }
      }
    }
  }
}`;

type Raw = { sample: boolean; response: unknown };
type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoGraphqlErrors(response: unknown): void {
  if (!isRecord(response) || !("errors" in response)) return;
  if (!Array.isArray(response.errors) || response.errors.length > 0) {
    throw new Error("Hardcover GraphQL returned errors");
  }
}

function date(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? undefined : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function bookId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  return undefined;
}

function number(value: unknown, minimum: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : undefined;
}

function coverUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function latestRead(value: unknown): RecordValue | undefined {
  if (!Array.isArray(value) || !isRecord(value[0])) return undefined;
  return value[0];
}

function mapRow(value: unknown, sample: boolean): FeedThing | undefined {
  if (!isRecord(value) || !isRecord(value.book)) return undefined;
  const id = bookId(value.book.id);
  const title = typeof value.book.title === "string" ? value.book.title.trim() : "";
  const status = value.status_id;
  if (!id || !title || value.privacy_setting_id !== 1 || (status !== 2 && status !== 3)) return undefined;

  const dateAdded = date(value.date_added);
  const updatedAt = date(value.updated_at);
  const read = latestRead(value.user_book_reads);
  const startedAt = date(read?.started_at);
  const finishedAt = date(read?.finished_at);
  const history: HistoryEvent[] = [];
  let metric: FeedThing["metric"];

  if (status === 3) {
    metric = { kind: "progress", value: 100 };
    if (finishedAt) {
      if (startedAt) history.push({ at: startedAt, verb: "started" });
      history.push({ at: finishedAt, verb: "finished" });
    } else if (dateAdded) {
      history.push({ at: dateAdded, verb: "read" });
    } else {
      return undefined;
    }
  } else {
    if (startedAt) history.push({ at: startedAt, verb: "started" });
    else {
      const fallbackStart = dateAdded ?? updatedAt;
      if (fallbackStart) history.push({ at: fallbackStart, verb: "started" });
    }

    const readEdition = isRecord(read?.edition) ? read.edition : undefined;
    const edition = isRecord(value.edition) ? value.edition : undefined;
    const pageCount = number(readEdition?.pages ?? edition?.pages ?? value.book.pages, 0);
    const pages = pageCount !== undefined && pageCount > 0 ? pageCount : undefined;
    const progressPages = number(read?.progress_pages, 0);
    if (pages !== undefined && progressPages !== undefined) {
      const progress = Math.min(100, Math.max(0, Math.round(progressPages / pages * 100)));
      metric = { kind: "progress", value: progress };
      const at = updatedAt ?? dateAdded ?? startedAt;
      if (at) history.push({ at, verb: "progress", value: progress, unit: "%" });
    }
    if (history.length === 0) return undefined;
  }

  const image = isRecord(value.book.image) ? value.book.image.url : undefined;
  const cover = coverUrl(image);
  return {
    subject: `hardcover:${id}`,
    kind: "note",
    href: `https://hardcover.app/id/book/${id}`,
    title,
    ...(cover ? { cover } : {}),
    ...(metric ? { metric } : {}),
    history,
    sample,
  };
}

function parse(raw: Raw): { things: FeedThing[] } {
  if (!isRecord(raw) || typeof raw.sample !== "boolean") throw new Error("invalid Hardcover feed data");
  const response = raw.response;
  assertNoGraphqlErrors(response);
  if (!isRecord(response) || !isRecord(response.data)) throw new Error("invalid Hardcover GraphQL response");

  const me = response.data.me;
  const user = Array.isArray(me) ? (me.length === 1 ? me[0] : undefined) : me;
  if (!isRecord(user) || !Array.isArray(user.user_books)) throw new Error("invalid Hardcover GraphQL response");
  if (user.account_privacy_setting_id !== 1 || user.activity_privacy_settings_id !== 1) return { things: [] };

  return { things: user.user_books.flatMap((row) => {
    const thing = mapRow(row, raw.sample);
    return thing ? [thing] : [];
  }) };
}

async function live(ctx: LiveContext): Promise<Raw> {
  const token = (ctx.env.HARDCOVER_TOKEN ?? "").trim().replace(/^Bearer\s+/i, "");
  const response = await getJson({ fetch: ctx.fetch, signal: ctx.signal }, endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "azharkhan.net Hardcover reading feed (https://azharkhan.net)",
    },
    body: JSON.stringify({ query }),
  });
  assertNoGraphqlErrors(response);
  return { sample: false, response };
}

export const hardcover: Adapter<Raw> = {
  id: "hardcover",
  pursuit: "reading",
  env: ["HARDCOVER_TOKEN"],
  live,
  async fixture() {
    return import("../../fixtures/hardcover/me-user-books.sample.json").then((module) => module.default as Raw);
  },
  parse(raw) {
    return parse(raw);
  },
};
