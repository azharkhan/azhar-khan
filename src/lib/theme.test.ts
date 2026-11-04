import { describe, expect, it } from "vitest";
import { lightsTitle, nextOverride, parseOverride, resolveTheme, type Override, type Theme } from "./theme";

const overrides: Override[] = [null, "light", "dark"];
const systems: Theme[] = ["light", "dark"];

describe("parseOverride", () => {
  it("keeps light and dark", () => {
    expect(parseOverride("light")).toBe("light");
    expect(parseOverride("dark")).toBe("dark");
  });

  it("reads anything else as no override", () => {
    for (const value of [null, undefined, "", "system", "Dark"]) expect(parseOverride(value)).toBeNull();
  });
});

describe("resolveTheme", () => {
  it("follows the system when nothing is stored", () => {
    expect(resolveTheme(null, "light")).toBe("light");
    expect(resolveTheme(null, "dark")).toBe("dark");
  });

  it("lets an override win", () => {
    expect(resolveTheme("dark", "light")).toBe("dark");
    expect(resolveTheme("light", "dark")).toBe("light");
  });
});

describe("nextOverride", () => {
  const cases: [Override, Theme, Override][] = [
    [null, "light", "dark"],
    [null, "dark", "light"],
    ["dark", "light", null],
    ["light", "dark", null],
    ["dark", "dark", "light"],
    ["light", "light", "dark"],
  ];

  for (const [override, system, expected] of cases) {
    it(`turns ${override ?? "none"} on a ${system} system into ${expected ?? "none"}`, () => {
      expect(nextOverride(override, system)).toBe(expected);
    });
  }

  it("always flips what is shown", () => {
    for (const override of overrides) {
      for (const system of systems) {
        expect(resolveTheme(nextOverride(override, system), system)).not.toBe(resolveTheme(override, system));
      }
    }
  });
});

describe("lightsTitle", () => {
  it("names the action and says when it returns to the system setting", () => {
    expect(lightsTitle(null, "light")).toBe("Lights down");
    expect(lightsTitle(null, "dark")).toBe("Lights up");
    expect(lightsTitle("dark", "light")).toBe("Lights up (back to your system setting)");
    expect(lightsTitle("light", "dark")).toBe("Lights down (back to your system setting)");
    expect(lightsTitle("dark", "dark")).toBe("Lights up");
  });
});

describe("a session", () => {
  it("keeps an override through OS changes and drops it when a click lands on the system setting", () => {
    let system: Theme = "light";
    let override: Override = null;

    override = nextOverride(override, system);
    expect([override, resolveTheme(override, system)]).toEqual(["dark", "dark"]);

    system = "dark";
    expect([override, resolveTheme(override, system)]).toEqual(["dark", "dark"]);

    system = "light";
    expect([override, resolveTheme(override, system)]).toEqual(["dark", "dark"]);

    override = nextOverride(override, system);
    expect([override, resolveTheme(override, system)]).toEqual([null, "light"]);
  });
});
