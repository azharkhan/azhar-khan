import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { buildFixtures, pinClock, seedRandom, serve } from "./lib.mjs";

function copyList(name) {
  const source = readFileSync(resolve("src/lib/home/copy.ts"), "utf8");
  const block = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`))?.[1];
  assert.ok(block, `missing ${name} in src/lib/home/copy.ts`);
  return [...block.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
}

function copyString(name) {
  const source = readFileSync(resolve("src/lib/home/copy.ts"), "utf8");
  const value = source.match(new RegExp(`export const ${name} = "((?:\\\\.|[^"\\\\])*)";`))?.[1];
  assert.ok(value, `missing ${name} in src/lib/home/copy.ts`);
  return JSON.parse(`"${value}"`);
}

const OPENERS = copyList("OPENERS");
const BLOG_LINE = copyString("BLOG_LINE");
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}; set CHROME_PATH`);

buildFixtures();
const server = await serve(resolve("dist"));
const browser = await chromium.launch({ executablePath: chromePath });
const outsideRequests = [];
const failures = [];

async function context(options = {}) {
  const result = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    reducedMotion: "reduce",
    ...options,
  });
  result.on("request", (request) => {
    if (!request.url().startsWith(server.origin + "/")) outsideRequests.push(request.url());
  });
  await pinClock(result);
  return result;
}

async function pageFor(options = {}, seed = 1) {
  const ctx = await context(options);
  await seedRandom(ctx, seed);
  const page = await ctx.newPage();
  await page.goto(`${server.origin}/`, { waitUntil: "networkidle" });
  return { ctx, page };
}

async function check(name, action) {
  try {
    await action();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function firstRandom(seed) {
  let state = seed >>> 0;
  state = (state + 0x6d2b79f5) >>> 0;
  let value = state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

try {
  await check("opener-static", async () => {
    const { ctx, page } = await pageFor({ javaScriptEnabled: false });
    try {
      assert.equal(await page.locator("#opener").textContent(), OPENERS[0]);
      assert.equal(await page.locator("#opener").evaluate((element) => element.nextElementSibling?.tagName), "SCRIPT");
    } finally {
      await ctx.close();
    }
  });

  await check("opener-rotates", async () => {
    const values = [];
    for (let seed = 1; seed <= 12; seed++) {
      const { ctx, page } = await pageFor({}, seed);
      try {
        values.push(await page.locator("#opener").textContent());
      } finally {
        await ctx.close();
      }
    }
    assert.ok(values.every((value) => OPENERS.includes(value)), "all opener text comes from OPENERS");
    assert.ok(new Set(values).size >= 2, "multiple seeded openers appear");
    assert.equal(values[0], OPENERS[Math.floor(firstRandom(1) * OPENERS.length)], "seed 1 matches the mockup's first random selection");
  });

  await check("hover-bridge", async () => {
    const { ctx, page } = await pageFor();
    try {
      const films = page.locator('[data-ref="films"]');
      const filmRow = page.locator('.log [data-key="films"]');
      await films.hover();
      assert.ok((await filmRow.getAttribute("class"))?.includes("lit"));
      await page.locator("h1").hover();
      assert.ok(!(await filmRow.getAttribute("class"))?.includes("lit"));
      await page.locator('[data-ref="board-games"]').focus();
      assert.ok((await page.locator('.log [data-key="board-games"]').getAttribute("class"))?.includes("lit"));
      await page.locator('[data-ref="gaming"]').hover();
      assert.ok((await page.locator('.log [data-key="gaming"]').getAttribute("class"))?.includes("lit"));
      await page.locator('[data-ref="reading"]').hover();
      assert.ok((await page.locator('.log [data-key="reading"]').getAttribute("class"))?.includes("lit"));
    } finally {
      await ctx.close();
    }
  });

  await check("die-filters", async () => {
    const { ctx, page } = await pageFor();
    try {
      const games = await page.locator("[data-die]").getAttribute("data-shelf").then(JSON.parse);
      const roll = page.locator(".roll");
      const out = page.locator(".out");
      const exercise = async (id, predicate) => {
        const button = page.locator(`[data-filter="${id}"]`);
        await button.click();
        assert.equal(await button.getAttribute("aria-pressed"), "true");
        for (const other of await page.locator("[data-filter]").all()) {
          if ((await other.getAttribute("data-filter")) !== id) assert.equal(await other.getAttribute("aria-pressed"), "false");
        }
        for (let i = 0; i < 25; i++) {
          await roll.click();
          const line = await out.textContent();
          assert.match(line, /^Play .+\. .+ players?, \d+ min\. You’ve played it (once|\d+ times)\.$/);
          const name = line.match(/^Play (.+?)\. /)?.[1];
          const game = games.find((candidate) => candidate.name === name);
          assert.ok(game && predicate(game), `filtered roll returned ${name}`);
        }
      };
      await exercise("two", (game) => game.minPlayers <= 2 && game.maxPlayers >= 2);
      await exercise("quick", (game) => game.minutes <= 45);
      await exercise("any", (game) => games.some((candidate) => candidate.name === game.name));
    } finally {
      await ctx.close();
    }
  });

  await check("die-motion", async () => {
    const { ctx, page } = await pageFor({ reducedMotion: "no-preference" });
    try {
      await page.locator(".roll").click();
      assert.ok((await page.locator(".roll").getAttribute("class"))?.includes("rolling"));
      await page.waitForFunction(() => !document.querySelector(".out")?.textContent?.startsWith("One of my games"), null, { timeout: 1000 });
    } finally {
      await ctx.close();
    }
  });

  await check("stub", async () => {
    const { ctx, page } = await pageFor();
    try {
      const button = page.locator(".stars-btn");
      await button.click();
      assert.equal(await button.getAttribute("aria-expanded"), "true");
      const stub = page.locator("#stub-films");
      assert.ok(await stub.isVisible());
      const text = await stub.locator("p").textContent();
      assert.ok(text?.trim());
      assert.ok(!/[<]|&#|\[placeholder/i.test(text));
      assert.ok((await stub.textContent()).includes("23 Mar 2026"));
      await button.click();
      assert.ok(!(await stub.isVisible()));
      assert.equal(await button.getAttribute("aria-expanded"), "false");
    } finally {
      await ctx.close();
    }
  });

  await check("blog-link", async () => {
    const { ctx, page } = await pageFor();
    try {
      const link = page.locator("#blog-line");
      assert.equal(await link.evaluate((element) => element.tagName), "A");
      assert.equal(await link.textContent(), BLOG_LINE);
      const href = await link.getAttribute("href");
      assert.ok(href?.startsWith("/garden/"));
      const pathname = decodeURI(href.split(/[?#]/, 1)[0]);
      const file = resolve("dist", `.${pathname}${pathname.endsWith("/") ? "index.html" : ""}`);
      assert.ok(existsSync(file), `blog link target does not exist: ${href}`);
    } finally {
      await ctx.close();
    }
  });

  await check("lights", async () => {
    const { ctx, page } = await pageFor({ colorScheme: "light" });
    try {
      await page.locator(".nav [data-lights]").click();
      assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
      await page.locator(".bio [data-lights]").click();
      assert.equal(await page.locator("html").getAttribute("data-theme"), null);
      assert.equal(await page.evaluate(() => localStorage.getItem("theme")), null);
    } finally {
      await ctx.close();
    }
  });

  await check("no-js", async () => {
    const { ctx, page } = await pageFor({ javaScriptEnabled: false });
    try {
      assert.equal(await page.locator("[data-die]").evaluate((element) => getComputedStyle(element).display), "none");
      assert.equal(await page.locator(".log li").count(), 6);
      assert.ok((await page.locator(".bio").textContent()).includes("I’m a tinkerer at heart"));
      assert.equal(await page.locator(".dash li").count(), 4);
      assert.equal(await page.locator("#blog-line").textContent(), BLOG_LINE);
      assert.equal(await page.locator("#blog-line").evaluate((element) => element.tagName), "A");
      assert.equal(await page.locator(".elsewhere a").count(), 3);
    } finally {
      await ctx.close();
    }
  });

  await check("focus", async () => {
    const { ctx, page } = await pageFor();
    try {
      const tabTo = async (selector) => {
        for (let i = 0; i < 20; i++) {
          if (await page.evaluate((target) => document.activeElement?.matches(target), selector)) return;
          await page.keyboard.press("Tab");
        }
        throw new Error(`could not tab to ${selector}`);
      };
      await tabTo(".roll");
      assert.notEqual(await page.locator(".roll").evaluate((element) => getComputedStyle(element).outlineStyle), "none");
      await tabTo("#blog-line");
      assert.notEqual(await page.locator("#blog-line").evaluate((element) => getComputedStyle(element).outlineStyle), "none");
    } finally {
      await ctx.close();
    }
  });

  await check("no-network", async () => {
    assert.deepEqual(outsideRequests, []);
  });
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) process.exitCode = 1;
