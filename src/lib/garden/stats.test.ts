import { describe, expect, it } from "vitest";
import { formatDuration, formatStatChange, formatStatValue } from "./stats";

describe("stat time formatting", () => {
  it("formats second values at or above a minute as minutes and seconds", () => {
    expect(formatStatValue(118, "s")).toBe("1:58");
    expect(formatStatValue(60.5, "s")).toBe("1:00.5");
    expect(formatStatValue(48.3, "s")).toBe("48.3s");
  });

  it("formats second changes as signed minutes and seconds", () => {
    expect(formatStatChange(-12, "s")).toBe("−0:12");
    expect(formatStatChange(12.5, "s")).toBe("+0:12.5");
    expect(formatStatChange(0, "s")).toBe("±0:00");
  });

  it("leaves other units alone", () => {
    expect(formatStatValue(118, "min")).toBe("118min");
    expect(formatStatChange(-2.5, "min")).toBe("−2.5");
    expect(formatDuration(123)).toBe("2:03");
  });
});
