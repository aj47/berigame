# BeriGame

A multiplayer 3D web game built with React Three Fiber on top of a SpacetimeDB game server with a 600ms authoritative tick.

## Settlements expansion

Land claims, modular building, quests, five disciplines, companions, coin trading and sailing are available behind the expansion flag. See [Settlements](docs/SETTLEMENTS.md) for play instructions, recovery, enabling/disabling and verification.

## Boss fights

Clatterhorn, a charging stag beetle in a glade on the Coast, and the Sunken Spire, a bullet-hell dungeon for parties of one to four, share the integer simulation in `shared/sim` (`clatterhorn.ts`, `spire.ts`, `bullets.ts`). Both ship closed; the world owner opens them with `configure_bosses`. Rules and numbers are in [docs/design/BOSSES.md](docs/design/BOSSES.md); the release and rollback steps are in [docs/CLOUDFLARE_BETA.md](docs/CLOUDFLARE_BETA.md). `SPIRE_VALIDATE=full npm test --prefix shared -- --run spire-patterns` runs the full 46,464-instance pattern validator.

## Overview

BeriGame is a real-time multiplayer game built around an authoritative
600ms server tick (RuneScape cadence):

- Tile-based click-to-move on a 50x50 island; the server paths up to two collision-checked tiles per tick, with clients interpolating along the confirmed route.
- Melee is punch-or-stick. Everyone starts with bare fists: a **punch deals 3**. Each completed harvest has a **25% chance** to also turn up a **stick**; wielded, it deals **6** per swing, shows in your character's right hand for every player, and swings with its own animation.
- The first three inventory slots are **quick slots** (keys **1/2/3**, also the buttons at the bottom of the screen). A berry there is eaten; a stick there is wielded or put away. The weapon chip shows what you are swinging with. Moving the stick out of the quick slots, dropping it or dying puts it away. There are no stances and nothing floats above your head besides your name, health and chat.
- Exchanges alternate like a tennis rally: each attacker swings every 4 ticks, and a retaliating player's swings are offset by 2 ticks.
- Berries heal (blueberry 5, strawberry 3, greenberry 2, goldberry 10). Eating has a 3-tick cooldown and delays your next swing by 3 ticks.
- Harvesting a tree takes 5 ticks, one player at a time, and the tree regrows for 50 ticks. Moving, taking damage or dying interrupts it.
- Death drops your inventory on the ground and respawns you at the island centre after 5 ticks.
- Character style: three hair meshes and skin, hair, robe and wrap palettes. Preview changes locally, then save to share them with other players. All variants use the same body, collision size, stats and animations.
- Anonymous but stable identity: a token scoped to the server/world in localStorage keeps your character and inventory across refreshes. Sign-in recovery preserves a local backup before explicitly creating a new character.

All tunable numbers live in `shared/sim/constants.ts`.

## Architecture

```
shared/sim/        Pure TypeScript simulation (grid, BFS pathing, combat resolution,
                   inventory). Used by both the server module and the client. Vitest.
spacetimedb/       SpacetimeDB TypeScript module: tables, the scheduled `tick`
                   reducer, and every input reducer. This is the whole game server.
frontend/          Vite + React + React Three Fiber client. Subscribes to tables via
                   the SpacetimeDB SDK (frontend/src/spacetime) and renders them.
frontend/agent-api/ Browser-independent HTTP API, invite issuance, scoped player
                   sessions and abuse controls. Reuses the generated SDK bindings.
backend/           Legacy AWS Lambda / DynamoDB backend. No longer used by the game;
                   kept until its auth pieces are migrated. Will be removed.
```

### Data flow

1. The client calls a reducer (`setTarget`, `attack`, `wieldItem`, `startHarvest`, `eatBerry`, ...). Reducers validate and update rows.
2. Every 600ms the scheduled `tick` reducer advances the world: respawns, movement, harvest completion (and the stick roll), swings, deaths, expiry. Only rows that changed are written.
3. Clients receive row updates through subscriptions. `combat_event` is an event table that drives damage numbers and animations without being stored.

## Getting Started

### Prerequisites

- Node.js 22 (see `.nvmrc`)
- The SpacetimeDB CLI: `curl -sSf https://install.spacetimedb.com | sh`

### Run locally

```bash
npm run play
```

`npm run play` installs dependencies on first run, starts a local SpacetimeDB
if none is listening on port 3000, publishes the module, regenerates the client
bindings and starts the client at http://127.0.0.1:5173/play. Open it in two
windows (one incognito) to get two players. Ctrl-C stops everything it started.

<details>
<summary>Manual steps (what the script does)</summary>

```bash
(cd shared && npm install)
(cd spacetimedb && npm install)
(cd frontend && npm install)

spacetime start                                    # terminal 1, listens on :3000
cd spacetimedb && spacetime publish berigame --server local --yes   # terminal 2
cd ../frontend && npm run stdb:generate            # after any module change
npm run dev                                        # http://localhost:5173
```

</details>

The client connects to port 3000 on the page hostname (`ws`, or `wss` for an HTTPS page) and database `berigame` by default.
Override with `VITE_SPACETIME_URI` and `VITE_SPACETIME_DB` (for example a
Maincloud deployment: `VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com`).

### Landing page and player wiki

The same frontend serves the public website and the game:

Production uses **https://berigame.com** for the landing page,
**https://wiki.berigame.com** for the wiki, and **https://beta.berigame.com**
for the existing multiplayer game. Wiki articles use clean paths such as
`https://wiki.berigame.com/crafting`. Existing `/docs` links redirect to the
wiki domain, preserving searches and section anchors. The paths below remain
available together when developing locally.

- `/` — landing page with an interactive day/dusk 3D island, island-life chapters, a map of Bramblewild and a cinematic trailer.
- `/docs` — searchable player wiki; `/docs/<article>` links directly to a guide. Search results can link to individual sections, and `/docs/crafting#recipe-planner` calculates ingredient quantities and Crafting XP.
- `/play` — the multiplayer game. Existing `/?join=...` invitations still work.
- `/agent` — the agent field guide and API onboarding.

The wiki also serves documentation directly over HTTP, without JavaScript:

- `/llms.txt` — start here; categorized article links and live API entry points.
- `/wiki-index.json` — article summaries, item IDs, section anchors, source paths and build metadata.
- `/wiki/<article>.md` — one article as Markdown; every browser article has a **Read Markdown** link.
- `/llms-full.txt` — the entire wiki in one Markdown document.
- `/robots.txt` and `/sitemap.xml` — crawler discovery.

Normal clicks on wiki export links open a document reader with copy controls.
The links retain their raw `href` for agents and modified clicks. This also lets
embedded browsers read the documents when they block top-level file navigation.

On the wiki host, request an article with `Accept: text/markdown` to receive
its Markdown representation. Local development supports the same header on
`/docs/<article>`. Explicit export URLs also work on static previews. Unknown
Markdown documents return 404 on the public Worker and local development server.
The public site Worker adds discovery links and varies negotiated responses by
`Accept`; a plain static host only serves the exported files.

`npm run site:build` (or the frontend's `npm run build`) generates these files in
`frontend/dist` from the same article data as the browser wiki. The JSON index
records a content hash, generation time, base commit and working-tree status.
These describe the documentation build, not the live game deployment. Agents
should use the linked beta guide, discovery, OpenAPI and authenticated state for
current access, request schemas and game conditions.

To work on the landing page or wiki without starting a game server, run
`npm ci --prefix frontend` and `npm run dev --prefix frontend`. Open
http://127.0.0.1:5173. Reading the website does not connect to the game server
or create a character. Hosting must serve `index.html` for page routes (the
existing Cloudflare and nginx configurations already do this).

Website components live in `frontend/src/site/`. Wiki articles live in
`wikiContent.ts` and `itemArticles.ts`; reference tables and the island atlas use
the shared simulation definitions where possible. Update explanatory prose alongside rule changes, and verify the
related article links. The landing island is an illustrative diorama; the
trailer is a cinematic interpretation of the game. The crafting planner reads
the shared recipe definitions, including one-time cosmetic unlocks. The shared
blueberry brand icon is `frontend/public/icon.png`, copied from the in-game
`items/blueberry.png` artwork. Its PNG, ICO, SVG and Apple touch variants live in
the same directory. The public site deployment serves these brand assets on all
three production domains; see `docs/PUBLIC_SITE.md` for the narrow beta routes.

Run `npm run site:deploy` to deploy the public website and wiki separately from
the game. See [public website deployment](docs/PUBLIC_SITE.md) for domain setup,
validation and the separate beta update needed to publish game UI changes.

### Agent play

Share `/agent` on the game origin (locally `http://127.0.0.1:5173/agent`) and give
the agent a single-use invite code privately. The page explains how to join and
play through the HTTP API; `/agent.md` and `/api/agent/v1/openapi.json` provide
machine-readable instructions. Reading the guide does not create a character.

Invites allow gathering by default. Combat and chat require explicit opt-ins.
Sessions expire, requests are throttled, and action retries use idempotency keys.
The API requires server-enforced admission so direct SDK clients cannot bypass
invites. See [Agent API setup and limits](docs/AGENT_API.md) for new-world setup,
owner configuration, issuance, revocation, and deployment requirements.

The regular game view also registers WebMCP tools when the browser supports it.
Those browser tools use the current browser's character and the same server rules.

Handy while developing: `spacetime logs berigame -f`, and
`spacetime sql berigame "SELECT tick FROM world"`.

## Testing

```bash
cd shared && npm test              # simulation unit tests (vitest)
cd frontend && npm test            # client unit tests (vitest)
cd frontend && npm run smoke       # drives two SDK clients through every reducer
                                   # against the local server (needs it running)
```

`frontend/scripts/browser-check.mjs` runs a two-browser Playwright pass
against the Vite dev server (movement, quick slots, combat, harvest, eat, chat,
refresh persistence and death/respawn). `mobile-check.mjs` covers touch interactions, `cross-browser-check.mjs` covers installed WebKit/Firefox engines, and `render-check.ts` records rendering/resource measurements. See [graphics progress and verification](docs/PLAYABLE_GRAPHICS_PROGRESS.md) for local-runtime details and qualification limits.

The browser scripts follow the Grove rules: they fight outside the safe ring
(Chebyshev radius 2 around spawn) and end first-spawn grace by finding or
picking up a stick, attacking, or waiting out the 3:00. Point them at any
server with `GAME_URL`, `SPACETIME_URI` and `SPACETIME_DB`; `SHOT_DIR` (and
`OUT_DIR`, `RENDER_REPORT`, `COMBAT_REPORT_DIR`, `SWING_CAPTURE_DIR`) keep
ad-hoc runs out of `docs/art/game-review/`. On a host without a GPU,
frame-sampling asserts log `SKIP` instead of failing, and
`COMBAT_VIEWPORT=640x450 COMBAT_VIDEO=0` makes `combat-animation-check.ts`
render fast enough to sample each swing.

`reconnect-check.mjs` covers automatic reconnect (banner, backoff give-up and
Retry, offline emulation, CDP slow 3G). Set `STDB_STOP_CMD` / `STDB_START_CMD`
(shell commands that stop and start the local server) to include the
server-restart cases; `CHROMIUM_PATH` or `PLAYWRIGHT_MODULE` point it at a
local browser/Playwright. `network-liveness-regression.mjs` and
`network-lifecycle-check.mjs` accept `PLAYWRIGHT_CHANNEL=` (empty) to use the
bundled Chromium instead of installed Chrome.

CI (`.github/workflows/ci.yml`) runs the unit tests, build, agent API tests
and typecheck, the module typecheck and `spacetime build`, the model
optimisation check, then starts a local server + Vite and runs `smoke.ts` and
`reconnect-check.mjs`. Gameplay funnel analytics: see
[docs/ANALYTICS.md](docs/ANALYTICS.md).

## Deployment

- **Server**: `spacetime publish berigame` to Maincloud (or a self-hosted
  SpacetimeDB). The free tier is consumed by the tick alone; expect the Pro tier
  or self-hosting.
- **Client**: `cd frontend && VITE_SPACETIME_URI=wss://... npm run build` and host `dist/`.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

This project is licensed under the ISC License.

## Support

For issues and questions, please use the GitHub Issues page.
