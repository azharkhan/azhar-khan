import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { buildFixtures, FIXTURE_DIST, pinClock, seedRandom, serve } from "./lib.mjs";

const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}; set CHROME_PATH`);

async function filesUnder(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) result.push(...await filesUnder(path));
    else result.push(path);
  }
  return result;
}

function targetFile(href) {
  const pathname = decodeURI(href.split(/[?#]/, 1)[0] || "/");
  return resolve(FIXTURE_DIST, `.${pathname}${pathname.endsWith("/") ? "index.html" : ""}`);
}

buildFixtures();
const server = await serve(resolve(FIXTURE_DIST));
const browser = await chromium.launch({ executablePath: chromePath });
const outsideRequests = [];
const failures = [];
const imageStub = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="6"><rect width="4" height="6" fill="#E3DCCF"/></svg>';

async function pageFor(path, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    reducedMotion: "reduce",
    ...options,
  });
  context.on("request", (request) => {
    if (!request.url().startsWith(server.origin + "/")) outsideRequests.push({ url: request.url(), type: request.resourceType() });
  });
  await pinClock(context);
  await seedRandom(context);
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === server.origin) return route.continue();
    if (request.resourceType() === "image") {
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: imageStub });
    }
    return route.abort();
  });
  await page.goto(server.origin + path, { waitUntil: "networkidle" });
  return { context, page };
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

const allFiles = await filesUnder(resolve(FIXTURE_DIST));
const gardenFiles = await filesUnder(resolve(FIXTURE_DIST, "garden"));
const entryPages = gardenFiles.filter((file) => {
  const path = relative(resolve(FIXTURE_DIST, "garden"), file).split(sep);
  return path.length === 3 && path.at(-1) === "index.html";
});
const pursuitPages = gardenFiles.filter((file) => {
  const path = relative(resolve(FIXTURE_DIST, "garden"), file).split(sep);
  return path.length === 2 && path.at(-1) === "index.html";
});
const entryPage = "/garden/board-games/sample-long-form/";

try {
  await check("links", async () => {
    for (const file of allFiles.filter((path) => path.endsWith(".html"))) {
      const html = await readFile(file, "utf8");
      for (const match of html.matchAll(/\b(?:href|src)=["'](\/[^"]*?)["']/gi)) {
        const target = targetFile(match[1]);
        assert.ok(existsSync(target), `${relative(resolve(FIXTURE_DIST), file)} references missing ${match[1]}`);
      }
    }
  });

  await check("nav", async () => {
    for (const path of ["/", "/garden/", "/uses/", entryPage]) {
      const { context, page } = await pageFor(path);
      try {
        const links = page.locator(".nav a");
        assert.deepEqual((await links.allTextContents()).map((text) => text.trim()), ["Uses"]);
        assert.ok(await page.locator("[data-lights]").count() > 0);
        if (path === "/uses/") assert.equal(await links.nth(0).getAttribute("aria-current"), "page");
      } finally {
        await context.close();
      }
    }
  });

  await check("uses", async () => {
    const { context, page } = await pageFor("/uses/");
    try {
      const headings = await page.locator(".uses-content h2").allTextContents();
      assert.ok(headings.length >= 3, JSON.stringify(headings));
      for (const heading of ["Cubing", "3D printing"]) assert.ok(headings.includes(heading), JSON.stringify(headings));
      assert.ok(await page.locator(".uses-content ul > li").count() >= 6);
      const links = await page.locator(".uses-content a").evaluateAll((anchors) => anchors.map((link) => ({
        text: link.textContent?.trim(),
        href: link.getAttribute("href"),
      })));
      for (const expected of [
        { text: "MoYu RS3M V5 Ball Core", href: "https://www.thecubicle.com/en-ca/products/moyu-rs3-m-v5-3x3-ball-core-uv-robot-cube-stand" },
        { text: "Bambu Lab A1 Combo", href: "https://bambulab.com/en/a1" },
      ]) assert.ok(links.some((link) => link.text === expected.text && link.href === expected.href), JSON.stringify(expected));
    } finally {
      await context.close();
    }
  });

  await check("privacy-page", async () => {
    const response = await fetch(`${server.origin}/privacy/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<h1\b[^>]*>Privacy<\/h1>/i);
    assert.match(html, /id="takedowns"/);
    assert.match(html, /<a href="mailto:azhar@hey\.com">azhar@hey\.com<\/a>/i);
  });

  await check("privacy-footer", async () => {
    for (const path of ["/", "/garden/"]) {
      const { context, page } = await pageFor(path);
      try {
        assert.equal(await page.locator('.footer-meta a[href="/privacy/"]').count(), 1);
        assert.equal(await page.locator('.copyright-link[href="https://github.com/azharkhan/azhar-khan"]').count(), 1);
      } finally {
        await context.close();
      }
    }
  });

  await check("wall", async () => {
    const { context, page } = await pageFor("/garden/");
    try {
      const cards = page.locator(".wall > li");
      assert.equal(await cards.count(), entryPages.length);
      const touched = await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-touched")));
      for (let index = 1; index < touched.length; index++) {
        assert.ok(Date.parse(touched[index - 1]) >= Date.parse(touched[index]), "cards are sorted by last touched");
      }
      const variants = await page.locator(".card").evaluateAll((elements) => [...new Set(elements.map((element) => element.getAttribute("data-variant")))].sort());
      assert.deepEqual(variants, ["cover", "still", "text"]);
      assert.ok(await page.locator(".card-context").count() > 0, "feed cards show context lines");
      assert.equal(await page.locator(".card-context + .card-metric").count(), 0, "context replaces the separate metric line");
    } finally {
      await context.close();
    }
  });

  await check("filters", async () => {
    const { context, page } = await pageFor("/garden/");
    try {
      const filters = page.locator(".filters a");
      assert.equal(await filters.count(), pursuitPages.length + 1);
      assert.equal(await filters.first().textContent().then((text) => text.trim().split(/\s+/)[0]), "All");
      assert.equal(await filters.first().getAttribute("aria-current"), "page");
      for (const link of await filters.all()) {
        const href = await link.getAttribute("href");
        assert.ok(href && existsSync(targetFile(href)), `filter target does not exist: ${href}`);
      }
    } finally {
      await context.close();
    }
  });

  await check("no-js", async () => {
    const { context, page } = await pageFor("/garden/", { javaScriptEnabled: false });
    try {
      assert.equal(await page.locator(".wall > li").count(), entryPages.length);
    } finally {
      await context.close();
    }
  });

  await check("no-network", async () => {
    assert.ok(outsideRequests.every((request) => request.type === "image"), JSON.stringify(outsideRequests));
  });

  await check("chart", async () => {
    const { context: cubingContext, page: cubingPage } = await pageFor("/garden/cubing/");
    try {
      const chart = cubingPage.locator("figure.chart");
      assert.equal(await chart.count(), 1);
      assert.equal(await chart.locator("svg circle").count(), 3);
      assert.equal(await chart.locator("table.sr-only tbody tr").count(), 3);
      assert.ok(await cubingPage.locator(".toc li").count() >= 5);
      assert.ok(await cubingPage.locator('.toc a[href="/garden/cubing/first-solve/"]').count());
      assert.match(await cubingPage.locator(".toc li").filter({ hasText: "Single" }).textContent(), /1:58/);
    } finally {
      await cubingContext.close();
    }
    const { context: filmsContext, page: filmsPage } = await pageFor("/garden/films/");
    try {
      assert.equal(await filmsPage.locator(".chart").count(), 0);
    } finally {
      await filmsContext.close();
    }
  });

  await check("entry-history", async () => {
    const { context, page } = await pageFor("/garden/music/album-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/");
    try {
      const rows = page.locator(".entry-history .toc > li");
      assert.ok(await rows.count() > 0);
      assert.equal(await rows.first().locator(".leader").count(), 1);
      assert.equal(await rows.first().locator("time[datetime]").count(), 1);
      const dates = await rows.locator("time").evaluateAll((elements) => elements.map((element) => Date.parse(element.getAttribute("datetime"))));
      for (let index = 1; index < dates.length; index++) assert.ok(dates[index - 1] >= dates[index]);
    } finally {
      await context.close();
    }
  });

  await check("music-entry-width", async () => {
    const { context, page } = await pageFor("/garden/music/album-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/", { viewport: { width: 390, height: 844 } });
    try {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "music entry does not scroll horizontally at 390px");
    } finally {
      await context.close();
    }
  });

  await check("longform", async () => {
    const { context, page } = await pageFor(entryPage, { viewport: { width: 390, height: 844 } });
    try {
      assert.ok(await page.locator(".prose figure.wide").count() >= 2);
      assert.equal(await page.locator(".prose figure.pair img").count(), 2);
      assert.ok(await page.locator(".prose figure:not(.wide)").count() >= 1);
      assert.ok(await page.locator(".prose figcaption").count() >= 3);
      assert.equal(await page.locator(".prose blockquote cite").count(), 1);
      const code = page.locator("pre.astro-code");
      assert.ok((await code.getAttribute("style"))?.includes("var(--"));
      assert.ok(await page.locator(".prose :not(pre) > code").count() > 0);
      const footnote = page.locator(".footnotes li");
      assert.ok(await footnote.count() > 0);
      const backref = page.locator(".footnotes a[data-footnote-backref]");
      assert.ok(await backref.count() > 0);
      const target = await backref.first().getAttribute("href");
      assert.ok(target && await page.locator(target).count() > 0, "footnote backref target resolves");
      const endMarkWidth = await page.locator(".longform .prose > p:last-of-type").evaluate((element) => Number.parseFloat(getComputedStyle(element, "::after").width));
      assert.ok(endMarkWidth > 0);
      assert.equal(await page.locator("article.page-prose.longform").count(), 1, "sample long-form entry is auto-detected");
      const meta = await page.locator(".meta").textContent();
      assert.ok(meta?.includes("min read"));
      assert.ok(meta?.includes("24 October 2026"), "long-form meta shows its frontmatter date");
      const connected = page.locator(".connected");
      assert.equal(await connected.locator("h2").textContent(), "Connected to");
      const photoLink = connected.locator('a[href="/garden/board-games/sample-photo/"]');
      assert.equal(await photoLink.count(), 1);
      assert.ok(existsSync(targetFile(await photoLink.getAttribute("href"))));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    } finally {
      await context.close();
    }
  });

  await check("photo", async () => {
    const values = {};
    for (const colorScheme of ["light", "dark"]) {
      const { context, page } = await pageFor("/garden/board-games/sample-photo/", { colorScheme });
      try {
        const image = page.locator("figure.print img");
        assert.equal(await image.count(), 1);
        assert.ok((await page.locator(".meta").textContent())?.includes("20 October 2026"), "photo meta shows its frontmatter date");
        assert.match(await image.getAttribute("src"), /\.webp(?:$|\?)/);
        values[colorScheme] = await image.evaluate((element) => getComputedStyle(element).backgroundColor);
      } finally {
        await context.close();
      }
    }
    assert.notEqual(values.light, values.dark, "photo mat uses a dark color in dark mode");
    for (const file of allFiles.filter((path) => path.endsWith(".html"))) {
      const html = await readFile(file, "utf8");
      for (const match of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
        const url = new URL(match[1], server.origin);
        if (url.origin === server.origin) assert.match(url.pathname, /^\/_astro\/.+\.webp$/);
      }
    }
  });
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) process.exitCode = 1;
