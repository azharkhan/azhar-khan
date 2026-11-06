# azharkhan.net

Azhar Khan's personal site: Astro, static output. Needs Node 22.23.4 or newer. Garden pages still exist but aren't linked from site navigation for now; no-source Currently items still link to their pursuit page.

- `npm run dev`: local dev server
- `npm run check`: type check, build and unit tests; must exit 0
- `npm run shots`: build, then screenshot every page in `dist/` at 1440×900 and 390 wide, light and dark, into `build/shots/`. Uses Google Chrome; set `CHROME_PATH` to use another binary.

See `GUIDE.md` for adding content and running feeds.

## Feeds

Adapters read process environment variables and a local `.env` file. Copy `.env.example` to `.env` for local builds; never commit `.env`. `FEEDS=fixtures` forces offline sample data, and `FEEDS=off` disables feed cards (the committed BGG shelf still powers the die). Leave `FEEDS` empty for automatic mode. `BUILD_NOW` optionally pins the build time to an ISO timestamp.

| Variable | Feed | Notes |
|---|---|---|
| `BGG_TOKEN` | BoardGameGeek | XML API2 app token; in automatic mode, live shelf/history replaces the committed shelf |
| `RA_USER`, `RA_KEY` | RetroAchievements | Username and web API key |
| `LISTENBRAINZ_USER` | ListenBrainz | Public username; reads public listens without a token |
| `HARDCOVER_TOKEN` | Hardcover | Build-time-only personal access token; create at `https://hardcover.app/account/api` with the read-only scopes `read:me`, `read:library:public`, and `read:catalog`. No user ID is needed. |

The BGG die falls back to a committed, stripped shelf when the token is missing or the live feed fails. Export the BGG collection CSV to `private/bgg-collection.csv`, then run `npm run bgg:import` (or pass another CSV path with `npm run bgg:import -- <path>`); commit only `src/data/bgg-shelf.json`. The importer omits private CSV columns. A valid shelf file takes precedence over BGG sample data in development; `BGG_TOKEN` uses the live shelf instead.

BGG play history falls back to a stripped BG Stats export when there is no token or the live feed fails; live data wins when available. Export BG Stats to `private/BGStatsExport.json`, run `npm run bgstats:import` (or `npm run bgstats:import -- <path>`), and commit only `src/data/bgg-plays.json`. The importer keeps base-game IDs, BGG names, and play dates; player, score, location, and other private export fields are discarded.

In automatic production builds, other feeds without their required environment variables are omitted; local development falls back to labelled sample fixtures. `HARDCOVER_TOKEN` is read only by the build server and is never sent to the browser. Hardcover's API is beta; track the token's expiry and rotate it in local configuration and the Cloudflare build secret before it expires. Hardcover reads up to 100 currently-reading and finished books, and publishes them only when the account, activity feed, and each book are marked Public in Hardcover. It uses the edition page count for progress when available. Its API documentation requests a public DMCA policy when cover images are displayed; it lives in the takedowns section of [`/privacy/`](/privacy/#takedowns). RetroAchievements unlocks cover the last 30 days. ListenBrainz reads public listens and records a monthly latest obsession—distinctive track, qualifying album, or artist—with a separate trailing-30-day Currently row. MusicBrainz supplies album titles and track/album artist credits; artist winners use the mapped canonical name. Play counts are not shown.

## Garden entries

Hand entries live under `src/content/entries/`. Frontmatter supports `kind`, `pursuits`, `date`, `updated`, `subject`, `hidden`, `sample`, `dek`, `tags`, `connected`, and `cover`. Photo entries also need `photo` and descriptive `alt` text; optional `caption` should include the photo credit. Sample entries must set `sample: true` and use placeholder or lorem text.

Long-form is automatic: 400 prose words in the body or a feed thought, or a `##` heading in the body. Those entries use the blog layout. Long-form markdown can wrap ordinary Markdown images in figures:

```md
<figure class="wide">

![Description](./photo.jpg)

<figcaption>Caption and photo credit.</figcaption>
</figure>
```

For a pair, use `class="wide pair"` and put both image links in the same paragraph. A code block can carry a file label with `<div class="code"><p class="file">file.ts</p>`, a blank line, a fenced code block, then `</div>`. Photos are optimized as WebP and EXIF is stripped; the build fails if image metadata remains or a source image is copied unchanged.

To log a cubing solve, add `src/content/entries/solve-YYYY-MM-DD.md` with `title: Single`, `kind: stat`, `pursuits: [cubing]`, `date: YYYY-MM-DD`, `label: single`, `value: <seconds>`, and `unit: s`.

## Deploy

Cloudflare Workers Builds is connected to this repo: every push to `master` builds and deploys the `azhar-khan` Worker (static assets from `dist/`, configured in `wrangler.jsonc`). GitHub Actions runs the offline check (`npm run check`) on pushes and pull requests, and triggers a rebuild daily at 10:00 UTC (05:00/06:00 Toronto) through a Workers Builds deploy hook, so feed-backed pages refresh.

One-time setup:
1. Cloudflare → **Workers & Pages → Create → Import a repository**: pick `azharkhan/azhar-khan`, production branch `master`, build command `npm run build`, deploy command `npx wrangler deploy`.
2. In the Worker's **Settings → Builds → Variables and secrets**, add the feed keys from `.env.example` that you have (`RA_USER`, `RA_KEY`, `HARDCOVER_TOKEN`, `LISTENBRAINZ_USER`, `BGG_TOKEN`). Keep the Hardcover token private, record its expiry, and rotate it when renewing.
3. In **Settings → Builds → Deploy Hooks**, create a hook for `master` and add its URL as the GitHub Actions secret `CF_DEPLOY_HOOK_URL`.
4. In **Settings → Domains & Routes**, add `azharkhan.net` and `www.azharkhan.net` as custom domains.

To rebuild now: **Actions → CI → Run workflow**, or retry the latest build in Cloudflare. GitHub disables scheduled workflows in public repositories after 60 days without repository activity; re-enable the workflow in the Actions tab.
