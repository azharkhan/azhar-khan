# Running azharkhan.net

## What's there

| Page | What it is | Fed by |
|---|---|---|
| `/` | Opener, bio, Currently ledger, die, colophon | `src/pages/index.astro`, `src/lib/home/copy.ts`, pursuits + feeds |
| `/garden/` | Wall of everything, newest touch first; pursuit filters | entries + feeds |
| `/garden/<pursuit>/` | Blurb, kit, timeline, auto-charts | pursuit file + its entries |
| `/garden/<pursuit>/<entry>/` | One thing: content, history, connected | entry file and/or feed item |
| `/uses/` | Living list + every pursuit's kit | `src/content/uses.json` + pursuit kits |

Nav shows only rooms that exist: Garden · Uses · Lights.

## Day to day

Nothing. Once deployed with the daily rebuild, feeds refresh themselves: log a film on Letterboxd or a play on BGG, and it shows up after the next build. A Currently row whose latest activity is more than 30 days old shows the pursuit's blurb instead.

## Adding things

### A garden entry
Create `src/content/entries/<name>.md`. The URL becomes `/garden/<first pursuit>/<name>/`.

```md
---
title: First sub-20 solve
kind: milestone            # note | photo | link | milestone | stat
pursuits: [cubing]         # one or more; the first sets the URL
date: 2026-11-03
---
Optional body. Any body makes it "budding"; none is a "seedling".
```

Per kind:
- **stat:** `label: ao5`, `value: 21.9`, `unit: s`. Any label logged 3+ times gets a chart on the pursuit page.
- **photo:** put the image next to the file; `photo: ./table.jpg`, `alt: …`, optional `caption`. EXIF/GPS is stripped at build, and the build fails if it isn't.
- **link:** `url: https://…`.
- **Long-form (evergreen):** `long: true`, optional `dek: …`. Uses the blog design: figures (`<figure class="wide">`), blockquotes, code, footnotes (`[^1]`). See `src/content/entries/sample/sample-long-form.md` for every element.

Options for any kind:
- `hidden: true` keeps it out of the build.
- `connected: [<other entry id>]` links entries.
- `subject: "letterboxd:<slug>"` attaches your note to a feed item instead of making a new card (e.g. a longer thought on a film). Subject formats: `letterboxd:<film slug from its Letterboxd URL>`, `bgg:<BGG game id>`, `retroachievements:<RA game id>`, `lastfm:<artist>/<album>` (normalised), `crosspoint:<document>`.

### A pursuit
Create `src/content/pursuits/<slug>.md`. No code needed.

```md
---
title: Cubing
verb: Solved               # optional: the ledger label
icon: cube                 # a Phosphor Regular SVG in src/icons/<name>.svg
colour: blue               # red | green | yellow | blue | none
since: 2019
blurb: One line, shown when nothing's fresh.
currently: 6               # position on the homepage ledger; omit for garden-only
kit:
  - { name: GAN 12, why: One line of why }
---
```
Adding an icon: download the Regular weight from phosphoricons.com into `src/icons/`.

### /uses
Edit `src/content/uses.json`: sections of `{ name, why }` items. Kit lists come from pursuit files automatically.

### Homepage copy
Bio, roles and links: `src/pages/index.astro`. Openers and the blog line: `src/lib/home/copy.ts` (add a line and it joins the rotation).

## Feeds

| Feed | Needs | Without it |
|---|---|---|
| Letterboxd (`azhark`) | nothing | uses a committed snapshot if the fetch fails |
| BoardGameGeek (`azharkhan`) | `BGG_TOKEN` | row and die disappear in prod |
| RetroAchievements | `RA_USER`, `RA_KEY` | row disappears in prod |
| Last.fm | `LASTFM_USER`, `LASTFM_API_KEY` | row disappears in prod |
| CrossPoint Sync | `CROSSPOINT_USER`, `CROSSPOINT_KEY` (`CROSSPOINT_URL` optional) | row disappears in prod |

- Local: copy `.env.example` to `.env` and fill it in. `.env` is gitignored; never commit it.
- `FEEDS` decides where data comes from:
  - unset (`auto`): live when keys are set; otherwise sample fixtures in dev, nothing in prod.
  - `fixtures`: sample data only, offline. The check and shots scripts use this.
  - `off`: no feeds at all.
- A broken feed never breaks the build: it logs a warning and drops its row.

## Sample data
Anything with `sample: true` (in `src/content/entries/sample/`) and the non-Letterboxd fixtures appear only in dev and fixture builds, never in prod. They double as test data, so leave them in place.

## Working on it

```sh
npm run dev             # http://localhost:4321, live reload
npm run check           # type check + offline build + unit tests: must pass before committing
npm run checks:home     # headless behaviour checks (opener, die, stub, toggle…)
npm run checks:garden   # headless checks for wall, charts, entries, /uses
npm run shots           # screenshots into build/shots/ (pinned date, so stable); local only (gitignored)
npm run shots -- --mockup   # re-shoot the design mockups in private/mockups/ (local only)
```

## Deploy

GitHub Actions deploys the `azharkhan-net` Worker on pushes to `master` and daily at 10:00 UTC (05:00/06:00 Toronto); the scheduled rebuild refreshes feed-backed pages from current upstream data. Each run checks offline with fixtures, builds production with feed secrets, then deploys `dist/`.

One-time setup: create a Cloudflare Account API token using **Edit Cloudflare Workers**, scoped to the deployment account, and copy the account ID. Add GitHub Actions secrets `BGG_TOKEN`, `RA_USER`, `RA_KEY`, `LASTFM_USER`, `LASTFM_API_KEY`, `CROSSPOINT_USER`, `CROSSPOINT_KEY`, `CROSSPOINT_URL` (optional), `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID`. After the workflow is on `master`, run **Actions → Deploy → Run workflow** once. Then add `azharkhan.net` and `www.azharkhan.net` as custom domains in the Worker's **Settings → Domains & Routes**.

GitHub disables scheduled workflows in public repositories after 60 days without repository activity; re-enable this workflow in the Actions tab.

## Not built yet
`/lists`, crowd votes, `/answer`, `/capture` (so no phone capture yet: entries are markdown + commit), toys, easter eggs.
