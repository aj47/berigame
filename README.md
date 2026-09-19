# BeriGame

A multiplayer 3D web game built with React Three Fiber on top of a SpacetimeDB game server with a 600ms authoritative tick.

## Overview

BeriGame is a real-time multiplayer game built around an authoritative
600ms server tick (RuneScape cadence):

- Tile-based click-to-move on a 50x50 island; the server paths one tile per tick and clients interpolate one tick behind.
- Rock-paper-scissors melee in the Smash Bros mould: **Strike > Grab > Guard > Strike**. Your stance is visible above your head and switchable any time with keys 1/2/3; the stance you hold when a swing resolves is what counts.
- Fighting-game states: winning an exchange puts you in **Advantage** and your opponent in **Disadvantage**. Advantage hits do 6 and knock the target back a tile, neutral hits do 4, escape hits do 3, and a countered swing costs the attacker 2. States decay to Neutral after 8 ticks without an exchange.
- Exchanges alternate like a tennis rally: each attacker swings every 4 ticks, and a retaliating player's swings are offset by 2 ticks.
- Berries heal (blueberry 5, strawberry 3, greenberry 2, goldberry 10). Eating has a 3-tick cooldown and delays your next swing by 3 ticks.
- Harvesting a tree takes 5 ticks, one player at a time, and the tree regrows for 50 ticks. Moving, taking damage or dying interrupts it.
- Death drops your inventory on the ground and respawns you at the island centre after 5 ticks.
- Anonymous but stable identity: a token in localStorage keeps your HP and inventory across refreshes.

All tunable numbers live in `shared/sim/constants.ts`.

## Architecture

```
shared/sim/        Pure TypeScript simulation (grid, BFS pathing, combat resolution,
                   inventory). Used by both the server module and the client. Vitest.
spacetimedb/       SpacetimeDB TypeScript module: tables, the scheduled `tick`
                   reducer, and every input reducer. This is the whole game server.
frontend/          Vite + React + React Three Fiber client. Subscribes to tables via
                   the SpacetimeDB SDK (frontend/src/spacetime) and renders them.
backend/           Legacy AWS Lambda / DynamoDB backend. No longer used by the game;
                   kept until its auth pieces are migrated. Will be removed.
```

### Data flow

1. The client calls a reducer (`setTarget`, `attack`, `setStance`, `startHarvest`, `eatBerry`, ...). Reducers validate and update rows.
2. Every 600ms the scheduled `tick` reducer advances the world: respawns, movement, harvest completion, swings, state decay, deaths, expiry. Only rows that changed are written.
3. Clients receive row updates through subscriptions. `combat_event` is an event table that drives damage numbers and animations without being stored.

## Getting Started

### Prerequisites

- Node.js 22 (see `.nvmrc`)
- The SpacetimeDB CLI: `curl -sSf https://install.spacetimedb.com | sh`

### Run locally

```bash
git checkout claude/elegant-babbage-l1je9i
npm run play
```

`npm run play` installs dependencies on first run, starts a local SpacetimeDB
if none is listening on port 3000, publishes the module, regenerates the client
bindings and starts the client at http://127.0.0.1:5173. Open it in two
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

The client connects to `ws://localhost:3000` and database `berigame` by default.
Override with `VITE_SPACETIME_URI` and `VITE_SPACETIME_DB` (for example a
Maincloud deployment: `VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com`).

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
against the Vite dev server (movement, stances, combat, harvest, eat, chat,
refresh persistence).

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
