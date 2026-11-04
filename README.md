# azharkhan.net

Azhar Khan's personal site: Astro, static output. Needs Node 22.23.4 or newer.

- `npm run dev`: local dev server
- `npm run check`: type check, build and unit tests; must exit 0
- `npm run shots`: build, then screenshot every page in `dist/` at 1440×900 and 390 wide, light and dark, into `build/shots/`. Uses Google Chrome; set `CHROME_PATH` to use another binary.

See `GUIDE.md` for adding content and running feeds.

## Feeds

Adapters read process environment variables and a local `.env` file. Copy `.env.example` to `.env` for local builds; never commit `.env`. `FEEDS=fixtures` forces offline sample data, and `FEEDS=off` disables feeds. Leave `FEEDS` empty for automatic mode. `BUILD_NOW` optionally pins the build time to an ISO timestamp.

| Variable | Feed | Notes |
|---|---|---|
| `BGG_TOKEN` | BoardGameGeek | XML API2 app token |
| `RA_USER`, `RA_KEY` | RetroAchievements | Username and web API key |
| `LASTFM_USER`, `LASTFM_API_KEY` | Last.fm | Username and API key |
| `CROSSPOINT_USER`, `CROSSPOINT_KEY` | CrossPoint Sync | The key is the lowercase MD5 hex of the account password; use a unique password because it grants full account access. |
| `CROSSPOINT_URL` | CrossPoint Sync | Optional; defaults to `https://sync.crosspointreader.com`. |

In automatic production builds, private feeds without credentials are omitted; local development falls back to labelled sample fixtures. RetroAchievements unlocks cover the last 30 days, Last.fm reads four completed weekly album charts and records each week's top album when it has at least 10 plays, and CrossPoint reads the latest 100 progress records plus activity. Those windowed feeds do not persist between builds.

## Garden entries

Hand entries live under `src/content/entries/`. Frontmatter supports `kind`, `pursuits`, `date`, `updated`, `subject`, `hidden`, `sample`, `long`, `dek`, `tags`, `connected`, and `cover`. Photo entries also need `photo` and descriptive `alt` text; optional `caption` should include the photo credit. Sample entries must set `sample: true` and use placeholder or lorem text.

Long-form markdown can wrap ordinary Markdown images in figures:

```md
<figure class="wide">

![Description](./photo.jpg)

<figcaption>Caption and photo credit.</figcaption>
</figure>
```

For a pair, use `class="wide pair"` and put both image links in the same paragraph. A code block can carry a file label with `<div class="code"><p class="file">file.ts</p>`, a blank line, a fenced code block, then `</div>`. Photos are optimized as WebP and EXIF is stripped; the build fails if image metadata remains or a source image is copied unchanged.

## Deploy

GitHub Actions builds and deploys the static site to the `azharkhan-net` Worker on pushes to `master` and daily at 10:00 UTC (05:00/06:00 Toronto). The scheduled rebuild refreshes feed-backed pages from current upstream data. Each run checks offline with fixture data, builds production with the feed secrets, then deploys `dist/`.

One-time setup:
1. Create a Cloudflare Account API token using **Edit Cloudflare Workers**, scoped to the deployment account, and copy the account ID.
2. In GitHub **Settings → Secrets and variables → Actions**, add `BGG_TOKEN`, `RA_USER`, `RA_KEY`, `LASTFM_USER`, `LASTFM_API_KEY`, `CROSSPOINT_USER`, `CROSSPOINT_KEY`, `CROSSPOINT_URL`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID`. `CROSSPOINT_URL` is optional; the rest enable feeds or deployment.
3. After the workflow is on `master`, run **Actions → Deploy → Run workflow** once, selecting `master`.
4. In the Worker's **Settings → Domains & Routes**, add `azharkhan.net` and `www.azharkhan.net` as custom domains.

GitHub disables scheduled workflows in public repositories after 60 days without repository activity; re-enable this workflow in the Actions tab.
