import { describe, expect, it } from "vitest";
import { buildNow, type Env } from "./now";

describe("buildNow", () => {
  it("uses the current time when BUILD_NOW is unset", () => {
    const before = Date.now();
    const now = buildNow({});
    const after = Date.now();
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  it("parses BUILD_NOW", () => {
    expect(buildNow({ BUILD_NOW: "2026-11-02T17:00:00Z" }).toISOString()).toBe("2026-11-02T17:00:00.000Z");
  });

  it("rejects an invalid BUILD_NOW", () => {
    expect(() => buildNow({ BUILD_NOW: "nope" } satisfies Env)).toThrow("BUILD_NOW is not a date: nope");
  });
});
