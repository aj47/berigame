# Public website and wiki

The public website runs on the Cloudflare Worker `berigame-site`:

| Domain | Purpose |
| --- | --- |
| `berigame.com` | Landing page |
| `wiki.berigame.com` | Wiki home and article paths such as `/crafting` |
| `beta.berigame.com` | Existing game and agent API, on the separate `berigame-beta` Worker |

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

Publishing the public Worker does not update the existing beta game. To publish
the shared berry favicon, in-game wiki links, or other approved frontend changes
to the game, use the separate `npm run beta:deploy` command described in
[Cloudflare beta operations](CLOUDFLARE_BETA.md). That build sets the correct
Maincloud connection and admission settings. Deploy the public site first so
the game's new wiki links have a destination. No game database publication is
needed for this website release.

## Verify

- `https://berigame.com/` opens the landing page.
- `https://wiki.berigame.com/` opens the encyclopedia, with article links on that host.
- `https://wiki.berigame.com/crafting#recipe-planner` opens the calculator.
- Main-site `/docs/crafting?q=flint` redirects to wiki `/crafting?q=flint`.
- Play links reach the beta, and `/?join=CODE` preserves the invite query.
- `/favicon.svg`, `/favicon.ico`, and `/apple-touch-icon.png` load on every deployed origin.
- Opening the landing page or wiki does not open a game WebSocket or create a character.

Local walkthrough recordings in `review-videos/` and `frontend/review-videos/`
are review artifacts, not part of the deployed bundle.
