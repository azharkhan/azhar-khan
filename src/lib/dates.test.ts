import { describe, expect, it } from "vitest";
import { dayMonth, longDate, shortDate, yearOf } from "./dates";

describe("dates", () => {
  it("formats day and month in Toronto", () => {
    expect(dayMonth(new Date("2026-09-28T12:00:00Z"))).toBe("28 Sep");
    const newYear = new Date("2026-01-01T03:00:00Z");
    expect(dayMonth(newYear)).toBe("31 Dec");
    expect(yearOf(newYear)).toBe(2025);
  });

  it("formats long dates in Toronto", () => {
    expect(longDate(new Date("2026-11-02T17:00:00Z"))).toBe("2 November 2026");
    expect(longDate(new Date("2026-11-02T03:00:00Z"))).toBe("1 November 2026");
  });

  it("formats entry dates in UTC with fixed English month names", () => {
    expect(shortDate(new Date("2026-09-28"))).toBe("28 Sep 2026");
    expect(Array.from({ length: 12 }, (_, month) => shortDate(new Date(Date.UTC(2026, month, 2))).split(" ")[1]))
      .toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  });
});
