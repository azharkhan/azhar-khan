import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import { buildFixtures, mockupFonts, pinClock, seedRandom, SEED, serve } from "./lib.mjs";

const mockupMode = process.argv.includes("--mockup");
const root = resolve(mockupMode ? "private/mockups" : "dist");
const out = resolve("build/shots");
const destination = mockupMode ? join(out, "mockup") : out;
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const viewports = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const themes = ["light", "dark"];
const SHOT_PAGES = [
  { file: "index.html", slug: "home" },
  { file: "garden/index.html", slug: "garden" },
  { file: "uses/index.html", slug: "uses" },
  { file: "garden/cubing/index.html", slug: "garden-cubing" },
  { file: "garden/board-games/sample-long-form/index.html", slug: "garden-board-games-sample-long-form" },
  { file: "garden/board-games/sample-photo/index.html", slug: "garden-board-games-sample-photo" },
];
const MOCKUP_PAGES = [
  { file: "v5/index.html", slug: "home" },
  { file: "blog/index.html", slug: "blog-index" },
  { file: "blog/the-die.html", slug: "blog-the-die" },
  { file: "blog/game-nights.html", slug: "blog-game-nights" },
  { file: "v5/photos.html", slug: "v5-photos" },
];
const imageStub = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="6"><rect width="4" height="6" fill="#E3DCCF"/></svg>';

if (!mockupMode) buildFixtures();
if (!existsSync(chrome)) throw new Error(`Chrome not found at ${chrome}; set CHROME_PATH`);
const pages = mockupMode ? MOCKUP_PAGES : SHOT_PAGES;
for (const page of pages) {
  if (!existsSync(join(root, page.file))) throw new Error(`shot page not found: ${page.file}`);
}
await mkdir(out, { recursive: true });
if (mockupMode) {
  await rm(destination, { recursive: true, force: true });
} else {
  for (const file of await readdir(out, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith(".png")) await rm(join(out, file.name));
  }
}
await mkdir(destination, { recursive: true });

const fontRoutes = new Map();
const server = await serve(root, fontRoutes);
const fontCss = mockupMode ? await mockupFonts(server.origin) : undefined;
if (fontCss) for (const [path, file] of fontCss.routes) fontRoutes.set(path, file);
const browser = await chromium.launch({ executablePath: chrome });
try {
  const route = (file) => "/" + file.replace(/(^|\/)index\.html$/, "$1");

  for (const item of pages) {
    for (const { width, height } of viewports) {
      for (const colorScheme of themes) {
        const context = await browser.newContext({
          viewport: { width, height },
          colorScheme,
          deviceScaleFactor: width === 390 ? 2 : 1,
        });
        await pinClock(context);
        await seedRandom(context, SEED);
        const page = await context.newPage();
        await page.addInitScript(() => {
          const style = document.createElement("style");
          style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}";
          (document.head ?? document.documentElement).append(style);
        });
        await page.route("**/*", async (request) => {
          const url = new URL(request.request().url());
          if (url.origin === server.origin) return request.continue();
          if (fontCss && url.origin === "https://fonts.googleapis.com") {
            return request.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: fontCss.css });
          }
          if (request.request().resourceType() === "image") {
            return request.fulfill({ status: 200, contentType: "image/svg+xml", body: imageStub });
          }
          return request.abort();
        });
        await page.goto(server.origin + route(item.file), { waitUntil: "networkidle" });
        await page.addStyleTag({
          content: `${mockupMode ? ".mock{display:none!important}" : ""} *,*::before,*::after{animation:none!important;transition:none!important}`,
        });
        await page.evaluate(async () => {
          for (const image of document.images) image.loading = "eager";
          await Promise.all([...document.images].map((image) => image.decode()));
          await document.fonts.ready;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        await page.waitForTimeout(250);
        const dimensions = await page.evaluate(() => ({
          width: innerWidth,
          height: Math.min(Math.max(document.documentElement.scrollHeight, innerHeight), 6000),
        }));
        const name = `${item.slug}--${width}--${colorScheme}.png`;
        const image = join(destination, name);
        await page.screenshot({
          path: image,
          fullPage: true,
          clip: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
          animations: "disabled",
        });
        if (process.platform === "darwin") {
          const normalized = `${image}.normalized.png`;
          execFileSync("sips", ["-s", "format", "png", image, "--out", normalized], { stdio: "ignore" });
          await rename(normalized, image);
        }
        await context.close();
        console.log(`${mockupMode ? "build/shots/mockup" : "build/shots"}/${name}`);
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
