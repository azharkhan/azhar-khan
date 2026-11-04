import { describe, expect, it } from "vitest";
import { fallbackMode, feedMode, feedsSetting, includeSamples, missingVars } from "./policy";

describe("feed policy", () => {
  it("disables feeds when FEEDS=off", () => {
    expect(feedMode({ env: ["TOKEN"] }, { env: { FEEDS: "off" }, dev: true })).toBe("off");
  });

  it("uses fixtures when FEEDS=fixtures", () => {
    expect(feedMode({ env: ["TOKEN"] }, { env: { FEEDS: "fixtures" }, dev: false })).toBe("fixture");
  });

  it("uses live feeds when all vars are present", () => {
    expect(feedMode({ env: ["TOKEN"] }, { env: { TOKEN: "value" }, dev: false })).toBe("live");
  });

  it("uses fixtures in dev when a var is missing", () => {
    expect(feedMode({ env: ["TOKEN"] }, { env: {}, dev: true })).toBe("fixture");
  });

  it("uses the fallback mode in production when a var is missing", () => {
    expect(feedMode({ env: ["TOKEN"] }, { env: {}, dev: false })).toBe("off");
    expect(fallbackMode({ env: ["TOKEN"], realFixture: true }, { env: {}, dev: false })).toBe("fixture");
  });

  it("treats an empty string as missing", () => {
    expect(missingVars({ env: ["TOKEN"] }, { TOKEN: "" })).toEqual(["TOKEN"]);
  });

  it("rejects an unknown FEEDS setting", () => {
    expect(() => feedsSetting({ FEEDS: "bogus" })).toThrow("Invalid FEEDS setting: bogus");
  });

  it("includes samples in dev or fixture mode only", () => {
    expect(includeSamples({ env: {}, dev: true })).toBe(true);
    expect(includeSamples({ env: { FEEDS: "auto" }, dev: false })).toBe(false);
    expect(includeSamples({ env: { FEEDS: "fixtures" }, dev: false })).toBe(true);
    expect(includeSamples({ env: { FEEDS: "off" }, dev: false })).toBe(false);
  });
});
