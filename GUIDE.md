# Running azharkhan.net

## What's there

| Page | What it is | Fed by |
|---|---|---|
| `/` | Opener, bio, Currently ledger, die, colophon | `src/pages/index.astro`, `src/lib/home/copy.ts`, pursuits + feeds |
| `/garden/` | Wall of everything, newest touch first; pursuit filters | entries + feeds |
| `/garden/<pursuit>/` | Blurb, timeline, auto-charts | pursuit file + its entries |
| `/garden/<pursuit>/<entry>/` | One thing: content, history, connected | entry file and/or feed item |
| `/uses/` | Hand-written list | `src/content/uses.md` |

Garden pages still exist but aren't linked from site navigation for now; no-source Currently items still link to their pursuit page.

## Day to day

Nothing. Once deployed with the daily rebuild, feeds refresh themselves: log a film on Letterboxd or a play on BGG, and it shows up after the next build. A Currently row keeps its latest entry regardless of age; it shows the pursuit's blurb only when there are no entries.

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
Optional body.
```

Per kind:
- **stat:** `label: ao5`, `value: 21.9`, `unit: s`. Any label logged 3+ times gets a chart on the pursuit page. To log a cubing solve, add `src/content/entries/solve-YYYY-MM-DD.md` with `title: Single`, `kind: stat`, `pursuits: [cubing]`, `date: YYYY-MM-DD`, `label: single`, `value: <seconds>`, and `unit: s`.
- **photo:** put the image next to the file; `photo: ./table.jpg`, `alt: …`, optional `caption`. EXIF/GPS is stripped at build, and the build fails if it isn't.
- **link:** `url: https://…`.
- **Long-form:** detected from 400 prose words in the body or feed thought, or a `##` body heading. Optional `dek: …`. Uses the blog design: figures (`<figure class="wide">`), blockquotes, code, footnotes (`[^1]`). See `src/content/entries/sample/sample-long-form.md` for every element.

Options for any kind:
- `hidden: true` keeps it out of the build.
- `connected: [<other entry id>]` links entries.
- `subject: "letterboxd:<slug>"` attaches your note to a feed item instead of making a new card (e.g. a longer thought on a film). Subject formats: `letterboxd:<film slug from its Letterboxd URL>`, `bgg:<BGG game id>`, `hardcover:<numeric book ID>`, `retroachievements:<RA game id>`, `listenbrainz:track:<artist>/<track>`, `listenbrainz:album:<release-group-mbid>`, or `listenbrainz:artist:<artist-mbid-or-name>`.

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
---
```
Adding an icon: download the Regular weight from phosphoricons.com into `src/icons/`.

### /uses
Edit `src/content/uses.md`.

### Homepage copy
Bio, roles and links: `src/pages/index.astro`. Openers and the blog line: `src/lib/home/copy.ts` (add a line and it joins the rotation).

## Feeds

| Feed | Needs | Without it |
|---|---|---|
| Letterboxd (`azhark`) | nothing | uses a committed snapshot if the fetch fails |
| BoardGameGeek (`azharkhan`) | `BGG_TOKEN` | live shelf/history when set; otherwise the committed shelf keeps the die available |
| RetroAchievements | `RA_USER`, `RA_KEY` | row disappears in prod |
| ListenBrainz | `LISTENBRAINZ_USER` | public username; row disappears in prod if unset |
| Hardcover | `HARDCOVER_TOKEN` | reading row disappears in prod |

To refresh the BGG shelf, export the collection CSV from BGG to `private/bgg-collection.csv`, then run `npm run bgg:import` (or `npm run bgg:import -- <path>`). Commit only `src/data/bgg-shelf.json`; private CSV columns are stripped. The committed shelf is preferred to BGG sample data in dev, and `BGG_TOKEN` replaces it with the live shelf and history. For play history, export BG Stats to `private/BGStatsExport.json`, run `npm run bgstats:import` (or `npm run bgstats:import -- <path>`), and commit only `src/data/bgg-plays.json`. The importer omits expansions and ignored plays and strips player, score, location, and other private fields; when available, live BGG history takes precedence.

- Local: copy `.env.example` to `.env` and fill it in. `.env` is gitignored; never commit it.
- `FEEDS` decides where data comes from:
  - unset (`auto`): live when required environment variables are set; otherwise sample fixtures in dev, nothing in prod. The committed BGG shelf still powers the die if live data is unavailable.
  - `fixtures`: sample data only, offline; a committed BGG shelf takes precedence for the die. The check and shots scripts use this.
  - `off`: disables feed cards; the committed BGG shelf still powers the die.
- A broken feed never breaks the build: it logs a warning and drops its row. ListenBrainz reads public listens without an API token and records a monthly latest obsession: a distinctive repeated track, a qualifying album, or otherwise an artist. Its Currently row uses the trailing 30 days. MusicBrainz supplies album titles and track/album artist credits; artist winners use the mapped canonical name. Play counts are not shown.
- Create a Hardcover personal access token at <https://hardcover.app/account/api> with only the read-only scopes `read:me`, `read:library:public`, and `read:catalog`. No user ID is needed; `me` returns it. Store the PAT as `HARDCOVER_TOKEN` in local `.env` and the Cloudflare build secrets; a raw token is preferred, though a leading `Bearer ` is accepted. It is used only during the build and never sent to the browser. The feed runs only when the Hardcover account, activity feed, and each included book are marked Public. Hardcover's API is beta, and tokens may expire: record the expiry and rotate the local value and Cloudflare build secret before then. Automatic production builds omit the reading feed without a token; local development uses the sample fixture. The API documentation requests a public DMCA policy when API cover images are public; it is the takedowns section of `/privacy/`.

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
Cloudflare Workers Builds deploys every push to `master`; GitHub Actions runs the check on pushes and pings a deploy hook daily at 10:00 UTC to refresh feeds. Feed keys live in the Worker's build variables and secrets; the only GitHub secret is `CF_DEPLOY_HOOK_URL`. Setup steps are in README → Deploy.

## Not built yet
`/lists`, crowd votes, `/answer`, `/capture` (so no phone capture yet: entries are markdown + commit), toys, easter eggs.
