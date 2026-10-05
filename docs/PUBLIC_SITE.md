# Public website and wiki

The public website runs on the Cloudflare Worker `berigame-site`:

| Domain | Purpose |
| --- | --- |
| `berigame.com` | Landing page |
| `wiki.berigame.com` | Wiki home and article paths such as `/crafting` |
| `beta.berigame.com` | Existing game and agent API, on the separate `berigame-beta` Worker |

The site Worker also owns narrow routes for the beta's favicon, Apple touch icon,
`/icon.png` and `/logo.png`. Those routes serve shared brand assets. The Worker
rejects other beta paths; the game and API remain on `berigame-beta`. This follows
Cloudflare's [route precedence over Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/routes/).

`frontend/cloudflare/site-wrangler.jsonc` binds the public domains and serves the
Vite build. `site-worker.ts` redirects `/docs` URLs to the wiki, and `/play`,
`/agent` and old root invite links to the beta. Query strings and browser
fragments survive redirects. The public Worker has no game credentials,
Durable Objects, or database migrations.

## Deploy

Use Node.js 22 or later. Configure `CLOUDFLARE_API_TOKEN` in the deployment
environment with access to the configured account and the `berigame.com` zone,
including Worker deployment and custom domain/DNS management. Do not commit
credentials. The runtime must be able to reach `api.cloudflare.com`; live checks
also need access to all three production domains.

```bash
npm ci --prefix frontend
npm test --prefix frontend -- --run
npm run site:deploy
```

The command builds first, then uses Wrangler 4.36.0 to deploy static assets and
the two custom domains. Set `WRANGLER_BIN` to an existing compatible Wrangler
executable when package installation is unavailable. Both domains must belong
to the configured Cloudflare account. Inspect existing DNS/custom-domain
bindings before replacing a conflicting deployment.

For a local deployment-package check:

```bash
npm run site:build
npx --yes wrangler@4.36.0 deploy --dry-run --config frontend/cloudflare/site-wrangler.jsonc
```

## Game updates

Publishing the public Worker updates the shared brand icons on all three domains.
To publish in-game wiki links or other approved frontend changes
to the game, use the separate `npm run beta:deploy` command described in
[Cloudflare beta operations](CLOUDFLARE_BETA.md). That build sets the correct
game server (`wss://berigame-db.exe.xyz`) and admission settings. Deploy the public site first so
the game's new wiki links have a destination. No game database publication is
needed for this website release.

## Verify

- `https://berigame.com/` opens the landing page.
- `https://wiki.berigame.com/` opens the encyclopedia, with article links on that host.
- `https://wiki.berigame.com/crafting#recipe-planner` opens the calculator.
- Main-site `/docs/crafting?q=flint` redirects to wiki `/crafting?q=flint`.
- Play links reach the beta, and `/?join=CODE` preserves the invite query.
- `/favicon.svg`, `/favicon.ico`, and `/apple-touch-icon.png` load on every deployed origin.
- `/icon.png` is the transparent 128 × 128 blueberry used by the game. `/logo.png` is a compatibility copy. The PNG, ICO and self-contained SVG favicons use this same artwork.
- Opening the landing page or wiki does not open a game WebSocket or create a character.
- `/llms.txt` links to the generated Markdown articles and live beta API descriptions.
- `/wiki-index.json` lists every article, its sections, source files and build metadata.
- `/wiki/crafting.md` serves Markdown; requesting `/crafting` with `Accept: text/markdown` serves the same document with `Vary: Accept`.
- `/llms-full.txt`, `/robots.txt` and `/sitemap.xml` are readable without JavaScript.
- `/wiki/no-such-article.md` returns 404 instead of an HTML application shell.
- Clicking Start here, JSON index, Full wiki or an article's Read Markdown link opens the document reader. Check loading, Copy URL, close and Escape in the browser.

The frontend build generates wiki exports in `dist` from `wikiContent.ts`, its
article modules and the shared simulation definitions. Keep this generation step
when changing the build pipeline. Do not hand-edit the exported files. Their
content hash and generation metadata identify the documentation snapshot; they
do not describe the live beta's feature flags or state.

Local walkthrough recordings in `review-videos/` and `frontend/review-videos/`
are review artifacts, not part of the deployed bundle.


## Changelog

The public changelog is `https://wiki.berigame.com/changelog`. It appears in wiki
navigation, search, the home page’s latest-update card and the site footer.

For each player-facing release, prepend a concise entry to
`frontend/src/site/changelog.ts`. Use Pacific calendar dates, keep permanent
section IDs so shared links keep working, and include source commit references.
State when a feature is disabled or awaiting activation. Historical entries are
grouped from repository history; do not turn their commit dates into unverified
deployment claims. The wiki article and latest-update card use the same data.

Publish wiki-only changes with the public site build/deploy commands above.
They do not require a game database publish.
