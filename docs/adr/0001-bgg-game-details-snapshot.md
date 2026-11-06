# BGG game details are a committed snapshot, not fetched at build

Box art and game details (weight, designer, rank, sized image URLs) come from a hand-run script that writes `src/data/bgg-things.json`; the daily build only calls BGG for the collection and plays. Per-game lookups are hundreds of rate-limited requests, and sized box art is only available from geekdo's unofficial image API, so keeping both out of the build keeps it fast and avoids depending on an unofficial endpoint. The cost is that new games show a thumbnail fallback and no details until the script is rerun and committed.

## Considered Options

- Build-time Astro optimization of BGG originals: hundreds of MB per daily Cloudflare build, and self-hosts artwork contrary to the hotlinking stance in the privacy page.
- Hotlinking BGG `image` originals: 0.7 to several MB per cover.
