import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { buildFixtures, FIXTURE_DIST, pinClock, seedRandom, serve } from "./lib.mjs";

function copyList(name) {
  const source = readFileSync(resolve("src/lib/home/copy.ts"), "utf8");
  const block = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`))?.[1];
  assert.ok(block, `missing ${name} in src/lib/home/copy.ts`);
  return [...block.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
}

const OPENERS = copyList("OPENERS");
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}; set CHROME_PATH`);

buildFixtures();
const server = await serve(resolve(FIXTURE_DIST));
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
      await page.locator('[data-ref="reading"]').hover();
      assert.ok((await page.locator('.log [data-key="reading"]').getAttribute("class"))?.includes("lit"));
    } finally {
      await ctx.close();
    }
  });

  await check("mobile-current-separate", async () => {
    const { ctx, page } = await pageFor({ viewport: { width: 390, height: 844 } });
    try {
      const current = await page.locator(".current").boundingBox();
      const bio = await page.locator(".bio").boundingBox();
      assert.ok(current && bio);
      assert.ok(current.y + current.height <= bio.y, "Lately is entirely above the bio");
    } finally {
      await ctx.close();
    }
  });

  await check("footer-layout", async () => {
    const { ctx, page } = await pageFor();
    try {
      const footer = page.locator(".site-footer");
      assert.equal(await footer.locator(".social-links li").count(), 3);
      assert.equal(await footer.locator(".social-links svg").count(), 3);
      assert.deepEqual(await footer.locator(".social-links svg").evaluateAll((icons) => icons.map((icon) => icon.getAttribute("aria-hidden"))), ["true", "true", "true"]);
      const meta = await footer.locator(".footer-meta p").allTextContents().then((items) => items.map((item) => item.trim()));
      assert.match(meta[0], /^© 2013–\d{4} Azhar Khan$/);
      assert.equal(meta[1], "Built with Astro · Privacy");
      assert.equal(await footer.locator('.copyright-link[href="https://github.com/azharkhan/azhar-khan"] .year-range').count(), 1);
      const socialLink = footer.locator(".social-links a").first();
      const underline = await socialLink.locator(".social-label").evaluate((element) => ({
        line: getComputedStyle(element).textDecorationLine,
        color: getComputedStyle(element).textDecorationColor,
      }));
      assert.equal(underline.line, "underline");
      assert.equal(await socialLink.evaluate((element) => getComputedStyle(element).textDecorationLine), "none");
      await socialLink.hover();
      assert.notEqual(await socialLink.locator(".social-label").evaluate((element) => getComputedStyle(element).textDecorationColor), underline.color);
      const [footerBox, bioBox] = await Promise.all([footer.boundingBox(), page.locator(".bio").boundingBox()]);
      assert.ok(footerBox && bioBox && footerBox.width < bioBox.width);
      await page.setViewportSize({ width: 390, height: 844 });
      const links = await footer.locator(".social-links a").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()));
      assert.ok(links.every((box) => box.height >= 44), "mobile links have a comfortable tap target");
      assert.ok(links.every((box, index) => index === 0 || (box.y - links[index - 1].bottom >= 7 && box.y - links[index - 1].bottom <= 16)), "mobile links have modest open spacing");
      assert.ok(await footer.locator(".social-links li").evaluateAll((items) => items.every((item) => getComputedStyle(item).borderTopStyle === "none")), "mobile links have no dividing rules");
      assert.equal(await footer.locator(".footer-meta").evaluate((element) => getComputedStyle(element).borderTopStyle), "none");
      const metaRows = await footer.locator(".footer-meta p").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()));
      assert.ok(metaRows.every((box, index) => index === 0 || box.y >= metaRows[index - 1].bottom), "mobile fine print stays in readable rows");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "mobile page has no horizontal overflow");
    } finally {
      await ctx.close();
    }
  });

  await check("board-games-current-list", async () => {
    const { ctx, page } = await pageFor();
    try {
      const row = page.locator('.log [data-key="board-games"]');
      const links = row.locator(".v a");
      if (await links.count() > 0) {
        assert.equal((await links.allTextContents()).join(", "), "Cascadia");
        assert.equal(await links.first().getAttribute("href"), "https://boardgamegeek.com/boardgame/295947");
        assert.equal(await links.first().getAttribute("target"), "_blank");
        assert.equal(await links.first().getAttribute("rel"), "noopener noreferrer");
      } else {
        assert.equal(await row.locator(".blurb").count(), 1);
      }
      assert.equal(await row.locator(".detail").count(), 0);
      assert.ok(!(await row.textContent())?.includes("lately"));
    } finally {
      await ctx.close();
    }
  });

  await check("currently-links", async () => {
    const { ctx, page } = await pageFor();
    try {
      assert.equal(await page.locator(".current .label").textContent(), "Lately");
      assert.deepEqual(await page.locator(".log > li > .k").allTextContents(), ["Watching", "Gaming", "Reading", "Playing", "Listening", "Solving"]);
      const externalLinks = page.locator('.log .v a[target="_blank"]');
      assert.ok(await externalLinks.count() > 0);
      for (const link of await externalLinks.all()) {
        assert.match(await link.getAttribute("href"), /^https:\/\//);
        assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
      }
      const cubingRow = page.locator('.log [data-key="cubing"]');
      const cubing = cubingRow.locator(".v a");
      assert.equal(await cubingRow.locator(".k").textContent(), "Solving");
      assert.equal(await cubing.count(), 1);
      assert.equal(await cubing.textContent(), "3×3 Rubik’s Cube");
      assert.equal((await cubingRow.locator(".m").textContent())?.trim(), "1:50↓0:57");
      assert.equal(await cubing.getAttribute("href"), "/garden/cubing/");
      assert.equal(await cubing.getAttribute("target"), null);
      assert.equal(await cubing.getAttribute("rel"), null);
      await page.setViewportSize({ width: 320, height: 900 });
      const [cubingBox, valueBox, metricBox] = await Promise.all([
        cubingRow.boundingBox(), cubingRow.locator(".v").boundingBox(), cubingRow.locator(".m").boundingBox(),
      ]);
      assert.ok(cubingBox && valueBox && metricBox);
      assert.equal(await cubingRow.evaluate((element) => element.scrollWidth === element.clientWidth), true);
      assert.ok(metricBox.y >= valueBox.y + valueBox.height - 1);
    } finally {
      await ctx.close();
    }
  });

  await check("die-filters", async () => {
    const { ctx, page } = await pageFor();
    try {
      const games = await page.locator("[data-die]").getAttribute("data-shelf").then(JSON.parse);
      assert.equal(await page.locator(".bio [data-die]").count(), 1);
      assert.equal(await page.locator(".current [data-die]").count(), 0);
      const card = page.locator("[data-die]");
      assert.equal(await card.evaluate((element) => getComputedStyle(element).borderTopWidth), "3px");
      assert.equal(await card.evaluate((element) => getComputedStyle(element).borderTopStyle), "solid");
      const title = page.locator(".die-title");
      assert.equal(await title.evaluate((element) => getComputedStyle(element).borderBottomWidth), "0px");
      const roll = page.locator(".roll");
      const out = page.locator(".out");
      const [rollBox, placeholderBox] = await Promise.all([roll.boundingBox(), out.locator("span").boundingBox()]);
      assert.ok(rollBox && placeholderBox);
      assert.ok(Math.abs((rollBox.y + rollBox.height / 2) - (placeholderBox.y + placeholderBox.height / 2)) < 2);
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
          assert.match(line, /^Play .+\. .+ players?, \d+ min\. I(?: haven’t played it yet|’ve played it once|’ve played it \d+ times)\.$/);
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
      const clamp = await stub.locator("p").evaluate((element) => {
        element.textContent = "A long review. ".repeat(100);
        const style = getComputedStyle(element);
        return {
          lines: style.webkitLineClamp,
          height: element.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(style.lineHeight),
        };
      });
      assert.equal(clamp.lines, "4");
      assert.ok(clamp.height <= clamp.lineHeight * 4 + 1);
      await button.click();
      assert.ok(!(await stub.isVisible()));
      assert.equal(await button.getAttribute("aria-expanded"), "false");
    } finally {
      await ctx.close();
    }
  });

  await check("blog-placeholder-removed", async () => {
    const { ctx, page } = await pageFor();
    try {
      assert.equal(await page.locator("#blog-line").count(), 0);
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
      assert.equal(await page.locator(".social-links a").count(), 3);
    } finally {
      await ctx.close();
    }
  });

  await check("focus", async () => {
    const { ctx, page } = await pageFor();
    try {
      const tabTo = async (selector) => {
        for (let i = 0; i < 30; i++) {
          if (await page.evaluate((target) => document.activeElement?.matches(target), selector)) return;
          await page.keyboard.press("Tab");
        }
        throw new Error(`could not tab to ${selector}`);
      };
      await tabTo(".roll");
      assert.notEqual(await page.locator(".roll").evaluate((element) => getComputedStyle(element).outlineStyle), "none");
      await tabTo(".social-links a");
      assert.notEqual(await page.locator(".social-links a").first().evaluate((element) => getComputedStyle(element).outlineStyle), "none");
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
