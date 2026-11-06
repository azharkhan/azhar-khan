import { describe, expect, it, vi } from "vitest";
import { hardcover } from "./hardcover";

const now = new Date("2026-11-02T17:00:00Z");
const token = "sample-hardcover-token";

function rawFor(books: unknown[], meAsArray = false, sample = false, accountPrivacy = 1, activityPrivacy = 1) {
  const user = { account_privacy_setting_id: accountPrivacy, activity_privacy_settings_id: activityPrivacy, user_books: books };
  return {
    sample,
    response: { data: { me: meAsArray ? [user] : user } },
  };
}

function bookRow(fields: Record<string, unknown> = {}) {
  return {
    status_id: 2,
    privacy_setting_id: 1,
    date_added: "2026-10-01",
    updated_at: "2026-10-31",
    book: {
      id: 710010,
      title: "Sample Current Book",
      pages: 200,
      image: { url: "https://covers.example.test/sample-current-book.jpg" },
    },
    edition: { pages: null },
    user_book_reads: [
      { started_at: "2026-10-02", finished_at: null, progress_pages: 20 },
    ],
    ...fields,
  };
}

function context(fetch: typeof globalThis.fetch, env: Record<string, string | undefined> = { HARDCOVER_TOKEN: token }) {
  return { env, now, fetch, signal: new AbortController().signal };
}

describe("Hardcover adapter", () => {
  it("maps fixture books, falls back to date-only noon UTC, and skips null titles", async () => {
    const output = hardcover.parse(await hardcover.fixture(), { now });
    const foundryside = output.things.find((thing) => thing.subject === "hardcover:710001");
    expect(foundryside).toMatchObject({
      href: "https://hardcover.app/id/book/710001",
      title: "Foundryside",
      cover: "https://covers.example.test/sample-foundryside.jpg",
      metric: { kind: "progress", value: 43 },
      sample: true,
      history: [
        { at: new Date("2026-10-20T12:00:00Z"), verb: "started" },
        { at: new Date("2026-11-01T12:00:00Z"), verb: "progress", value: 43, unit: "%" },
      ],
    });
    expect(foundryside).not.toHaveProperty("author");

    const finished = output.things.find((thing) => thing.subject === "hardcover:710002");
    expect(finished).toMatchObject({
      metric: { kind: "progress", value: 100 },
      history: [
        { at: new Date("2026-09-01T12:00:00Z"), verb: "started" },
        { at: new Date("2026-09-20T12:00:00Z"), verb: "finished" },
      ],
    });

    const noPages = output.things.find((thing) => thing.subject === "hardcover:710003");
    expect(noPages).toMatchObject({
      title: "Sample Book Without Page Counts",
      history: [{ at: new Date("2026-10-25T12:00:00Z"), verb: "started" }],
      sample: true,
    });
    expect(noPages).not.toHaveProperty("metric");
    expect(output.things).toHaveLength(3);
  });

  it("uses book pages when edition pages are null", () => {
    const output = hardcover.parse(rawFor([
      bookRow({
        book: { id: 710011, title: "Sample Book Pages Fallback", pages: 200 },
        edition: { pages: null },
        user_book_reads: [{ started_at: "2026-10-02", finished_at: null, progress_pages: 50 }],
      }),
    ]), { now });
    expect(output.things[0]).toMatchObject({ metric: { kind: "progress", value: 25 } });
  });

  it("emits public books only when the Hardcover account is public", () => {
    const output = hardcover.parse(rawFor([
      bookRow({ privacy_setting_id: 2, book: { id: 710020, title: "Sample Followers Book" } }),
      bookRow({ privacy_setting_id: 3, book: { id: 710021, title: "Sample Private Book" } }),
      bookRow({ privacy_setting_id: undefined, book: { id: 710022, title: "Sample Book With Unknown Privacy" } }),
    ]), { now });
    expect(output.things).toEqual([]);
    expect(hardcover.parse(rawFor([bookRow()], false, false, 2), { now }).things).toEqual([]);
    expect(hardcover.parse(rawFor([bookRow()], false, false, 3), { now }).things).toEqual([]);
    expect(hardcover.parse(rawFor([bookRow()], false, false, 1, 2), { now }).things).toEqual([]);
    expect(hardcover.parse(rawFor([bookRow()], false, false, 1, 3), { now }).things).toEqual([]);
  });

  it("clamps progress over the page total to 100", () => {
    const output = hardcover.parse(rawFor([
      bookRow({ user_book_reads: [{ started_at: "2026-10-02", finished_at: null, progress_pages: 250 }] }),
    ]), { now });
    expect(output.things[0]).toMatchObject({ metric: { kind: "progress", value: 100 } });
  });

  it("uses date_added for read books without finished_at and finished_at when present", () => {
    const output = hardcover.parse(rawFor([
      bookRow({
        status_id: 3,
        book: { id: 710012, title: "Sample Read Date Fallback" },
        updated_at: "2026-10-31",
        date_added: "2026-10-01",
        user_book_reads: [{ started_at: null, finished_at: null }],
      }),
      bookRow({
        status_id: 3,
        book: { id: 710013, title: "Sample Finished Date" },
        updated_at: "2026-10-31",
        date_added: "2026-10-01",
        user_book_reads: [{ started_at: "2026-10-02", finished_at: "2026-10-20" }],
      }),
    ]), { now });
    expect(output.things[0]?.history).toEqual([{ at: new Date("2026-10-01T12:00:00Z"), verb: "read" }]);
    expect(output.things[1]?.history).toEqual([
      { at: new Date("2026-10-02T12:00:00Z"), verb: "started" },
      { at: new Date("2026-10-20T12:00:00Z"), verb: "finished" },
    ]);
  });

  it("skips malformed rows and drops non-HTTPS covers", () => {
    const output = hardcover.parse(rawFor([
      null,
      bookRow({ book: { id: "not-a-book-id", title: "Sample Invalid ID" } }),
      bookRow({ status_id: 1 }),
      bookRow({ book: { id: 710014, title: "Sample HTTP Cover", image: { url: "http://covers.example.test/sample.jpg" } } }),
    ]), { now });
    expect(output.things).toHaveLength(1);
    expect(output.things[0]).toMatchObject({ subject: "hardcover:710014", title: "Sample HTTP Cover" });
    expect(output.things[0]).not.toHaveProperty("cover");
  });

  it("accepts me as an object or a one-element array", () => {
    const row = bookRow({ book: { id: 710015, title: "Sample Me Shape" } });
    expect(hardcover.parse(rawFor([row]), { now }).things).toHaveLength(1);
    expect(hardcover.parse(rawFor([row], true), { now }).things).toHaveLength(1);
    expect(() => hardcover.parse({ sample: false, response: { data: { me: [{ user_books: [] }, { user_books: [] }] } } }, { now }))
      .toThrow("invalid Hardcover GraphQL response");
  });

  it("makes one authenticated build-time POST with only the me root field", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ data: { me: { user_books: [] } } }));
    }) as unknown as typeof globalThis.fetch;

    const raw = await hardcover.live(context(fetch));
    expect(raw.sample).toBe(false);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.hardcover.app/v1/graphql");
    expect(call.init?.method).toBe("POST");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("user-agent")).toContain("azharkhan.net");
    expect(call.url).not.toContain(token);

    const body = JSON.parse(String(call.init?.body)) as { query: string };
    const rootFields = [...body.query.matchAll(/^ {2}([A-Za-z_]\w*)\s*\{$/gm)].map((match) => match[1]);
    expect(rootFields).toEqual(["me"]);
    expect(body.query).toContain("account_privacy_setting_id");
    expect(body.query).toContain("activity_privacy_settings_id");
    expect(body.query).toContain("user_books(where: {status_id: {_in: [2, 3]}, privacy_setting_id: {_eq: 1}}, order_by: {updated_at: desc_nulls_last}, limit: 100)");
    expect(body.query).toContain("user_book_reads(order_by: {id: desc}, limit: 1)");
    expect(body.query).toContain("privacy_setting_id");
    expect(body.query).toContain("edition { pages }");
    expect(body.query).not.toContain(token);
  });

  it("accepts a token with an Authorization prefix", async () => {
    let authorization: string | null = null;
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ data: { me: { user_books: [] } } }));
    }) as unknown as typeof globalThis.fetch;
    await hardcover.live(context(fetch, { HARDCOVER_TOKEN: `bEaReR ${token} ` }));
    expect(authorization).toBe(`Bearer ${token}`);
  });

  it("does not expose the token in HTTP errors", async () => {
    const fetch = vi.fn(async () => new Response(`unauthorized ${token}`, { status: 401 })) as unknown as typeof globalThis.fetch;
    const error = await hardcover.live(context(fetch)).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("HTTP 401 https://api.hardcover.app/v1/graphql");
    expect((error as Error).message).not.toContain(token);
  });

  it("treats GraphQL errors on HTTP 200 as a safe adapter failure", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      errors: [{ message: `permission denied ${token}` }],
      data: { me: { user_books: [] } },
    }))) as unknown as typeof globalThis.fetch;
    const error = await hardcover.live(context(fetch)).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Hardcover GraphQL returned errors");
    expect((error as Error).message).not.toContain(token);
  });
});
