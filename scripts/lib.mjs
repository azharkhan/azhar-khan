import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

export const NOW = process.env.BUILD_NOW || "2026-11-02T17:00:00Z";
export const SEED = Number(process.env.SHOTS_SEED || 1);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

export const FIXTURE_DIST = "build/fixture-dist";

export function buildFixtures() {
  execFileSync("npm", ["run", "build", "--", "--outDir", FIXTURE_DIST], {
    stdio: "inherit",
    env: { ...process.env, BUILD_NOW: NOW, FEEDS: "fixtures" },
  });
}

export async function serve(root, extraRoutes = new Map()) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      const extra = extraRoutes.get(path);
      const file = extra
        ? resolve(extra)
        : resolve(base, `.${path.endsWith("/") ? `${path}index.html` : path}`);
      if (!extra && file !== base && !file.startsWith(`${base}${sep}`)) throw new Error("outside root");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind a TCP port");
  if (!existsSync(base)) throw new Error(`served directory does not exist: ${base}`);
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((done, reject) => server.close((error) => error ? reject(error) : done())),
  };
}

export async function seedRandom(context, seed = SEED) {
  await context.addInitScript((initial) => {
    let state = initial >>> 0;
    Math.random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
}

export async function pinClock(context) {
  await context.clock.setFixedTime(new Date(NOW));
}

export async function mockupFonts(origin) {
  const sources = [
    ["fraunces", "full.css", "Fraunces Variable", "Fraunces"],
    ["fraunces", "full-italic.css", "Fraunces Variable", "Fraunces"],
    ["source-serif-4", "opsz.css", "Source Serif 4 Variable", "Source Serif 4"],
    ["source-serif-4", "opsz-italic.css", "Source Serif 4 Variable", "Source Serif 4"],
    ["source-code-pro", "wght.css", "Source Code Pro Variable", "Source Code Pro"],
    ["source-code-pro", "wght-italic.css", "Source Code Pro Variable", "Source Code Pro"],
  ];
  const routes = new Map();
  const css = await Promise.all(sources.map(async ([pkg, filename, from, to]) => {
    const path = resolve("node_modules/@fontsource-variable", pkg, filename);
    const source = await readFile(path, "utf8");
    return source.replaceAll(`'${from}'`, `'${to}'`).replace(/url\(\s*(['"]?)\.\/files\/([^'")]+)\1\s*\)/g, (_match, _quote, file) => {
      const route = `/_fonts/${pkg}/${file}`;
      routes.set(route, resolve("node_modules/@fontsource-variable", pkg, "files", file));
      return `url("${origin}${route}")`;
    });
  }));
  return { css: css.join("\n"), routes };
}
