import { describe, expect, it, vi } from "vitest";
import { getJson, getText, httpError, sleep } from "./http";

const signal = new AbortController().signal;

describe("HTTP helpers", () => {
  it("passes the provided signal and returns non-success statuses", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(signal);
      return new Response("queued", { status: 202 });
    }) as unknown as typeof globalThis.fetch;
    await expect(getText({ fetch, signal }, "https://x.test/p?token=secret")).resolves.toEqual({ status: 202, body: "queued" });
  });

  it("throws a status error without the query string", async () => {
    const fetch = vi.fn(async () => new Response("denied", { status: 403 })) as unknown as typeof globalThis.fetch;
    await expect(getJson({ fetch, signal }, "https://x.test/p?y=secret")).rejects.toThrow("HTTP 403 https://x.test/p");
    await expect(getJson({ fetch, signal }, "https://x.test/p?y=secret")).rejects.not.toThrow("secret");
    expect(httpError(403, "https://x.test/p?y=secret").message).toBe("HTTP 403 https://x.test/p");
  });

  it("reports malformed JSON without the query string", async () => {
    const fetch = vi.fn(async () => new Response("not json")) as unknown as typeof globalThis.fetch;
    await expect(getJson({ fetch, signal }, "https://x.test/p?y=secret")).rejects.toThrow("invalid JSON from https://x.test/p");
  });

  it("sanitizes network failures", async () => {
    const fetch = vi.fn(async () => { throw new Error("failed https://x.test/p?y=secret"); }) as unknown as typeof globalThis.fetch;
    await expect(getText({ fetch, signal }, "https://x.test/p?y=secret")).rejects.toThrow("request failed for https://x.test/p");
  });

  it("rejects sleep with the abort reason", async () => {
    const controller = new AbortController();
    const reason = new Error("aborted");
    const pending = sleep(1000, controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("stop");
    await expect(sleep(1000, controller.signal)).rejects.toBe("stop");
  });
});
