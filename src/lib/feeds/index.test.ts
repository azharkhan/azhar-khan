import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapters } from "./index";

describe("feed registry", () => {
  it("has unique adapters registered to seeded pursuits", () => {
    const ids = adapters.map((adapter) => adapter.id);
    const pursuits = readdirSync(new URL("../../../src/content/pursuits/", import.meta.url))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3));
    expect(new Set(ids).size).toBe(ids.length);
    for (const adapter of adapters) expect(pursuits).toContain(adapter.pursuit);
    expect(ids).toEqual(["letterboxd", "bgg", "crosspoint", "retroachievements", "lastfm"]);
  });

  it("documents every feed and build environment variable with empty examples", () => {
    const envExample = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
    const names = new Set([...adapters.flatMap((adapter) => adapter.env), "CROSSPOINT_URL", "FEEDS", "BUILD_NOW"]);
    for (const name of names) {
      expect(envExample.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))).toBe(`${name}=`);
      expect(readme).toContain(name);
    }
  });
});
