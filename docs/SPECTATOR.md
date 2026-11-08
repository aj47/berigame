# Spectator view (`/watch`)

A read-only picture of a world for OBS. No login, no character, nothing to click.

```
/watch?player=<id or name>     follow one character
/watch?mode=overview           the whole map with every player
/watch?mode=director           cut to the current fight on its own
```

`<id>` is a character's identity hex (`state.player.id` in the agent API, `playerId` from `POST /sessions`). A name works too and must match exactly, in any case. `/watch` alone is the overview.

| Parameter | Default | Meaning |
|---|---|---|
| `world` | this site | Origin of the world's gateway, such as `https://match.example`. The build-time `VITE_WATCH_WORLD` sets a default. |
| `key` | none | The world's watch key. Required: a world without one refuses every pass. |
| `delay` | `0` | Broadcast delay in seconds, up to 600. |
| `graphics` | `medium` | `low`, `medium` or `high`. `high` adds real shadows. |
| `fps` | `30` | Frame cap, 5 to 60. |
| `audio` | off | `1` plays game sound. Leave it off on all but one source. |
| `hold` | `8` | Director: shortest shot in seconds, 3 to 120. |

## OBS

Add one Browser Source per agent: width 1920, height 1080, FPS 30, with **Shutdown source when not visible** and **Refresh browser when scene becomes active** both off, so a scene is already live when you cut to it. Nothing needs a click. Each source gets its own pass.

## Private worlds

The page asks the world's gateway for a pass, and the answer names the game server and database, so the gateway is all a URL has to name. Host the page with the world, or point it there with `world=`.

Every world that can be watched needs a watch key. Without one the gateway refuses pass requests (403 `watch_disabled`), because a pass reads every position in the world:

- Node gateway: `BERIGAME_WATCH_KEY`. Set `BERIGAME_SPECTATOR_URI` as well if the gateway reaches the game server at an address the browser cannot.
- Worker: `npx wrangler secret put WATCH_KEY --config frontend/cloudflare/wrangler.jsonc`.

```sh
npm run agent:serve                     # with BERIGAME_WATCH_KEY set
# OBS source URL:
# https://<site>/watch?player=<id>&world=https://<gateway>&key=<watch key>
```

The key sits in the source URL, so keep it out of anything shown on stream.

## Broadcast delay

`delay=` holds back every frame from the server at the socket (`src/watch/delayedSocket.ts`), so the picture, the chat and the effects are all the world as it was. It protects the *video*: an agent that watches the stream sees the past. The browser holding the feed still receives it live, so the watch key, not the delay, is what keeps agents off the feed itself.

## How it stays read-only

- A pass is an identity registered in the private `spectator` table by the gateway (`grant_spectator`) before it connects. `onConnect` admits it with no player row. It is not counted online and takes no player slot.
- `spacetimedb/src/schema.ts` wraps reducer registration, so every reducer refuses a spectator, including any added later. Procedures are admin-gated.
- An expired pass is refused at connect and never treated as a new player. The page fetches another and carries on.
- The page has no input layer: no HUD, clicks or hotkeys, `conn.reducers` is replaced, and `useGameActions` returns at once. Nothing is read from or written to the player's saved token or settings, so watching in the browser you play in is safe.
- Tables with row-level security come back empty, because a pass owns nothing. Inventories, friend lists and trades never reach the page.

## How it stays up

The socket retries forever with backoff (`maxAttempts: Infinity`), and a refused pass is replaced. The page reloads itself after five minutes offline or on a render crash. A pass lasts 48 hours and is replaced with 12 hours left. A reload reuses the tab's pass (sessionStorage), because every pass holds one of the world's `MAX_SPECTATORS` rows until it expires. A pass holds at most `MAX_SPECTATOR_CONNECTIONS` (2) sockets at once; the server counts them in its `spectator` row and the host runs the disconnect hook for every open socket when it restarts, so a crash leaves no stale count.

The owner can free the rows with `clear_spectators` (over SSH on the VM; refused for anyone else):

```sh
spacetime call --server http://127.0.0.1:3000 berigame-beta clear_spectators true    # expired passes only
spacetime call --server http://127.0.0.1:3000 berigame-beta clear_spectators false   # every pass
```

A pass no socket holds is deleted. One still open is expired instead, so its viewer is refused at its next connect and fetches a new pass, and the row goes when its last socket closes. Clearing needs admission on, because a deleted pass's token would otherwise connect as a new character.

## Load

A viewer holds the whole public world rather than a block around itself, because a cut, a respawn across the map or a delayed picture cannot wait for an area subscription. That is one feed per viewer, capped at `MAX_SPECTATORS` (32) per world. A pass request is judged by its key before any rate limit is charged, so wrong-key requests cannot spend the players' join budgets. Accepted requests have their own lane per address (`WATCH_PASS_BUDGET`): eight at once, then four an hour.

A viewer adds nothing to the tick. Rendering is the viewer's own machine's cost: four 1080p sources at 30 fps on `medium` is the setup this was built for.
