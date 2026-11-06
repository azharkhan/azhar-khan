import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { bggCoversFileSchema } from "../src/lib/feeds/bgg-covers.ts";

const output = "src/data/bgg-covers.json";
const api = "https://boardgamegeek.com/xmlapi2";
const userAgent = "azharkhan.net/0.0.0 (https://azharkhan.net)";
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

async function bgg(path, token) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const response = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": userAgent } });
    if (response.status === 200) return xml.parse(await response.text());
    if (response.status !== 202 && response.status !== 429) throw new Error(`BGG ${response.status} ${path.split("?")[0]}`);
    await sleep(2000 * attempt);
  }
  throw new Error(`BGG ${path.split("?")[0]} still queued`);
}

async function localIds() {
  const ids = new Set();
  for (const [file, key] of [["src/data/bgg-shelf.json", "games"], ["src/data/bgg-plays.json", "plays"]]) {
    try {
      for (const row of JSON.parse(await readFile(file, "utf8"))[key]) ids.add(row.id);
    } catch {}
  }
  return ids;
}

async function liveIds(token) {
  const ids = new Set();
  const collection = await bgg("/collection?username=azharkhan&own=1&subtype=boardgame&excludesubtype=boardgameexpansion&brief=1", token);
  for (const item of list(collection.items?.item)) ids.add(String(item.objectid));
  for (let page = 1; page <= 20; page++) {
    const plays = await bgg(`/plays?username=azharkhan&type=thing&subtype=boardgame&page=${page}`, token);
    const rows = list(plays.plays?.play);
    for (const play of rows) ids.add(String(play.item.objectid));
    if (rows.length < 100) break;
    await sleep(1000);
  }
  return ids;
}

async function picIds(ids, token) {
  const pics = new Map();
  for (let index = 0; index < ids.length; index += 20) {
    const things = await bgg(`/thing?id=${ids.slice(index, index + 20).join(",")}`, token);
    for (const item of list(things.items?.item)) {
      const pic = /\/pic(\d+)\.[a-z]+$/i.exec(item.image ?? "")?.[1];
      if (pic) pics.set(String(item.id), pic);
    }
    await sleep(1000);
  }
  return pics;
}

async function mediumUrl(pic) {
  const response = await fetch(`https://api.geekdo.com/api/images/${pic}`, { headers: { "User-Agent": userAgent } });
  if (!response.ok) return undefined;
  return (await response.json()).images?.medium?.url;
}

export async function refreshCovers({ all = false } = {}) {
  const token = process.env.BGG_TOKEN;
  if (!token) throw new Error("BGG_TOKEN is required");
  let covers = {};
  if (!all) {
    try {
      covers = bggCoversFileSchema.parse(JSON.parse(await readFile(output, "utf8"))).covers;
    } catch {}
  }
  const ids = new Set([...(await localIds()), ...(await liveIds(token))]);
  const missing = [...ids].filter((id) => !covers[id]).sort((a, b) => Number(a) - Number(b));
  const pics = await picIds(missing, token);
  let added = 0;
  for (const [id, pic] of pics) {
    const url = await mediumUrl(pic);
    if (url) {
      covers[id] = url;
      added++;
    }
    await sleep(200);
  }
  const sorted = Object.fromEntries(Object.entries(covers).sort(([a], [b]) => Number(a) - Number(b)));
  const data = bggCoversFileSchema.parse({ source: "geekdo-images", covers: sorted });
  await writeFile(output, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return { added, missing: missing.length - added, total: Object.keys(sorted).length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  refreshCovers({ all: process.argv.includes("--all") })
    .then(({ added, missing, total }) => console.log(`Added ${added} covers (${missing} unresolved); ${total} total`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "BGG cover refresh failed");
      process.exitCode = 1;
    });
}
