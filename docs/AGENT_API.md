# Agent API

For the hosted beta on Cloudflare and SpacetimeDB Maincloud, see
[Cloudflare beta operations](./CLOUDFLARE_BETA.md). The instructions below also
cover the standalone Node gateway used for local development or self-hosting.

The agent API is a Node service that keeps a SpacetimeDB SDK connection for each
player session. It calls the same authoritative reducers as the browser game.
It uses the dependencies already installed in `frontend/`; there is no separate
framework or database service to install. Node 22 or later is required.

`/agent` is the shareable onboarding page. It does not connect a player to the
world. `/agent.md` is the static, machine-readable guide, and
`/api/agent/v1/openapi.json` describes the HTTP contract. WebMCP remains available
in the regular game view on browsers that support it.

## World admission

API limits alone would be bypassable through direct SpacetimeDB clients. The
gateway therefore **refuses to start unless server admission is enabled** and
its identity matches the configured gateway. In that mode, uninvited connections
are rejected before a player row is created. Every gameplay reducer also checks
admission. Expiring or revoking a permit stops ongoing actions on the next tick,
even if the client keeps its connection open.

Admission covers **all players in that world**, including browser players.
The world owner can grant human permits with `grant_player`; agents receive
one-hour-or-shorter permits from a separate gateway identity. The gateway cannot
change admission policy, grant owner-level human access, impersonate an existing
character, or appoint another gateway. It can extend (`renew_grant`) only an
unrevoked permit it issued itself, by at most one hour at a time; the beta uses
this solely for returning browser players (docs/CLOUDFLARE_BETA.md). Agent API
sessions are never renewed: each agent invite still yields one fresh character
for at most one hour. A combat-restricted player also
cannot be targeted by another player. Changing the gateway invalidates permits
issued by the previous gateway.

New databases capture their publishing identity as the owner during `init`.
Normal local play initially keeps anonymous admission so `npm run play` keeps
working. **Older databases that predate `access_policy` need an owner-controlled,
data-preserving migration before the API can be enabled.** The gateway fails
closed when that record is missing. There is deliberately no public
“first caller becomes owner” bootstrap, and no automatic reset of existing data.
For the first API deployment, use a new admitted world, then plan the migration
of any existing shared world separately.

## Set up a new local world

From the repository root, with the local SpacetimeDB server already running:

```sh
export BERIGAME_AGENT_URI=ws://127.0.0.1:3000
export BERIGAME_AGENT_DB=berigame-agents
spacetime publish --server local --module-path spacetimedb berigame-agents
npm run agent:setup
```

Setup creates a separate gateway credential in `.agent-api-data/gateway.json`
(mode 0600 inside a mode 0700 directory). It prints a `configure_access` command
containing only the gateway's public identity. Run that command using the same
CLI identity that published the database. It enables admission for this world.
An existing gateway file is never overwritten.

Then start the API and frontend in separate terminals:

```sh
npm run agent:serve
npm run dev --prefix frontend
```

Vite proxies `/api/agent` to `http://127.0.0.1:3001` by default. Visit
`http://127.0.0.1:5173/agent`. For a different API port, set
`BERIGAME_AGENT_API_ORIGIN` when starting Vite. The browser game's
`VITE_SPACETIME_DB` setting is independent of the agent service's database setting.

Issue an invite:

```sh
npm run agent:invite
# Explicit opt-ins:
npm run agent:invite -- --combat --chat
```

The code is shown once. Give the agent the onboarding URL and provide the code
privately, outside the URL. Codes expire after 24 hours and are single-use. The
store keeps hashes, capabilities and expiry, not the original invite codes.
Atomic file renames consume invites durably, including concurrent redemption
attempts and API restarts. If connection provisioning or delivery fails after
redemption, issue a replacement code; consumed codes are not restored.

## Call the API

```sh
curl -X POST http://127.0.0.1:3001/api/agent/v1/sessions \
  -H "Authorization: Bearer $BERIGAME_INVITE" \
  -H 'Content-Type: application/json' -d '{}'
```

The response contains `token`, `sessionId`, `playerId`, `expiresAt`, and
`permissions`. Save the token privately as `BERIGAME_SESSION` in your agent's
credential store. Underlying SpacetimeDB credentials are never returned.

```sh
curl http://127.0.0.1:3001/api/agent/v1/state \
  -H "Authorization: Bearer $BERIGAME_SESSION"

curl -X POST http://127.0.0.1:3001/api/agent/v1/actions/harvest \
  -H "Authorization: Bearer $BERIGAME_SESSION" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $ACTION_UUID" -d '{}'

curl -X DELETE http://127.0.0.1:3001/api/agent/v1/session \
  -H "Authorization: Bearer $BERIGAME_SESSION"
```

All action requests need an Idempotency-Key. Use a UUID, reuse it for a retry
with the same arguments, and create a new key for each new intended action.
Receipts remain for the whole session; conflicting reuse is rejected. Only one
action can be in flight per session. A timeout closes the session because the
action outcome may be uncertain. An accepted move or harvest may still be in
progress; read state to observe completion.

### Gameplay through the API

Actions mirror the browser controls: `move`, `harvest`, `craft`, `eat`, `wield`, `unwield`,
`stop`, `follow`, `pickup`, `drop`, `inventory_move`, `name`, `appearance`,
`attack_dummy`, `attack_giant`, `emote`, the social actions `invite_create`, `invite_redeem`,
`friend_add`, `friend_remove`, `trade_request`, `trade_respond`, `trade_offer`,
`trade_confirm`, `trade_cancel`, and the scoped `attack` and `chat`. OpenAPI has
the exact schemas.

- **Invite links.** `invite_create` makes (or replaces) your 8-character code,
  valid for one hour (`state.invite`: `code`, `expiresInSeconds`, `linkQuery`
  such as `?join=K7M2Q9XA`). The browser link is the game URL with only that
  query; it never carries an identity or token. `invite_redeem` with someone's
  code makes you friends both ways and places you beside them, unless you are
  fighting or down. Without a stick you never land past the brambles: if the
  inviter is on the hedge or the Coast you land on the nearest Grove tile, and
  `state.notices` explains why. Without a stone club you never land past the
  boulder line: you land on the nearest Coast tile instead.
- **Friends.** `friend_add` / `friend_remove` (one-way list). `state.friends`
  gives each friend's `online`, `area` and `tile`; walk to one with `follow`.
- **Trading.** `trade_request` a player within 3 tiles (if they already asked
  you, it accepts); they answer with `trade_respond` (`accept`/`decline`).
  Both then `trade_offer` everything they give as `itemId:qty` pairs joined by
  commas (`""` for nothing). Items stay in the bags and must not be wielded.
  Any offer change clears both confirmations. `trade_confirm` agrees to the
  trade exactly as `state.trade` shows it; when both have confirmed the swap
  runs at once, all or nothing. A full bag, a missing or wielded item leaves
  both bags unchanged, clears confirmations and adds a notice. Walking more
  than 6 tiles apart, dying, leaving, or an unanswered request (30 s) cancels.
- **Chat filter.** Each `state.chat` row has `nearby`: said within 12 tiles
  (Chebyshev) of where you stand now. `state.notices` holds your last 10
  personal notices (trade and invite results).

- **Training dummy.** `attack_dummy` walks you to the practice post at (28,28)
  (`state.dummies`) and keeps swinging with your punch or wielded weapon. No
  combat access needed; it works in the safe ring and during grace (it does not
  end grace), hurts nobody and never dies (60 HP that springs back to full).
- **Emotes.** `emote` with `wave`, `cheer`, `sit` or `point`: cosmetic, seen by
  everyone, ended by moving or acting; at most one every 2 ticks.
- **Death drops.** Ground items you dropped on defeat carry `yourDeathDrop: true`
  and `expiresInTicks` (piles last `groundItemTtlTicks`, 500).

- **Combat is punch-or-stick.** While attacking, you swing automatically. Bare
  fists punch for `PUNCH_DAMAGE` (3). A wielded stick hits for its
  `weaponDamage` (6), a wielded stone club 8. Numbers come from `shared/sim`.
- **Quick slots.** Inventory slots `0..HOTBAR_SIZE-1` (0..2) are the quick slots,
  the same slots behind the game's 1/2/3 keys. State reports `hotbarSize`,
  `punchDamage`, and a `hotbar`, `wielded` and `weaponDamage` value on every
  inventory row.
- **Getting a stick.** While you hold no stick (bag or wielded), each completed
  berry harvest has a `STICK_DROP_CHANCE` (25%, about 1 in 4) chance to add a
  sturdy stick next to the berry. It is pure luck: no meter, no guarantee. A
  player already holding a stick never finds a spare. One harvest can add two
  inventory rows, so find rows by `itemId`.
- **The Grove and the bramble hedge.** You spawn at (25,25) in the Grove.
  `ring(t)` is the Chebyshev distance from (25,25). Ring 17 (x or z = 8 or 42,
  136 tiles) is a thorny bramble hedge; ring 18 and beyond is the Coast.
  You may step onto a bramble tile only while holding a stick, or when stepping
  in from the Coast. Stepping off is always allowed, so brambles keep a
  stickless player in the Grove but never keep anyone out: you can always walk
  home. Diagonals also need both orthogonal tiles to be enterable. State
  reports `world.brambles {center, ring: 17, key: 'stick', rule}`,
  `player.area` (`grove`, `hedge` or `coast`, also on every listed player) and
  `me {area, safe, graceTicks, hasBrambleKey}`.
- **Moving into the hedge.** `move` beyond the hedge without a stick is accepted
  but clamped to the nearest reachable Grove tile; the receipt then contains
  `destination` and `blockedBy: "brambles"`. `harvest` or `pickup` of something
  you cannot reach because of the brambles is rejected with `422` and error code
  `brambles` ("Thorny brambles — you need a sturdy stick to push through") and
  queues nothing. Dropping the stick mid-walk stops you where you are.
- **The Coast: nodes and the stone club (M2).** `state.nodes` lists every
  gathering node: `{id, kind, name, tile, gives, ready, regrowTicks, harvesting}`
  with `kind` `berry`, `driftwood` or `tide_rock`. Four driftwood piles lie on
  the beach straight past the path crossings, (25,3), (46,25), (25,46), (3,25):
  4 ticks to gather, 25 to wash up again, 1 driftwood. Four tide rocks sit in
  the corners, (3,3), (46,3), (3,46), (46,46): 6 ticks, 40 to regrow, 1 flint.
  Only berry trees find sticks. `harvest {nodeId}` gathers a given node
  (`treeId` still works); `harvest {kind: "tide_rock"}` picks the node of that
  kind with the soonest claim. You need a stick to reach them (they are past the
  brambles). `state.recipes[] {id, name, inputs, canCraft, missing}` lists
  what you can make; `POST /actions/craft {"recipe": "stone_club"}` turns
  1 driftwood + 2 flint into a stone club instantly (rejected while dead or
  attacking; a full bag drops it at your feet). Wield it like the stick: 8
  damage a swing. `state.trees` (berry trees only) is kept for one release.
- **The Boulders (M3).** The grid is now 64x64 (`state.gridSize`); the old
  island keeps tiles 0-49 unchanged. Past its south-east corner lies the
  Boulders: land with both x and z >= 36 and `max(x, z) > 50` (an L, 559
  tiles). A one-tile **boulder line** (`max(x, z) = 50`, 29 tiles) guards it
  with the same one-way rule as the brambles, keyed by the **stone club** (bag
  or wielded): you may step onto it only while holding a club, or from the
  Boulders; stepping off is always allowed, so you can always walk home. Every
  other tile with x or z >= 50 is sea and never walkable. `state.world.boulders
  {line: 50, min: 36, entry: {x: 51, z: 51}, key: 'stone_club', rule}`,
  `player.area` (`boulder-line`, `boulders`, `sea` join `grove`, `hedge`,
  `coast`) and `me.hasBoulderKey`. `move` past the line without a club is
  clamped with `blockedBy: "boulders"` (a sea target gives `blockedBy: "sea"`);
  `harvest`/`pickup`/`attack_giant` you cannot reach fail with `422` and error
  code `boulders` ("Huge boulders — you need a stone club to clamber over").
- **Obsidian.** Two obsidian outcrops (`kind: "obsidian"`) sit at the far ends
  of the Boulders' L, (60,40) and (40,60): 8 ticks to chip, 150 to reform, 1
  obsidian (about 1.3 a minute world-wide). `harvest {kind: "obsidian"}` works.
- **The Giant (F3).** `state.giant {id, tile: {x: 57, z: 57}, footprint: 1,
  reach: 2, aggroRange: 8, state, health, maxHealth: 400, telegraph?,
  respawnInTicks?, reward, rule}`. A PvE world boss **open to everyone**: no
  combat access needed, and hitting it never ends grace or makes you hostile.
  `attack_giant` walks you within Chebyshev 2 of its centre (it blocks the 3x3
  around it) and keeps swinging with your punch or weapon; its HP pool is
  shared by everyone and regenerates after 100 ticks without a hit. It attacks
  players in the Boulders within 8 tiles: `state` goes `idle` ->
  `winding_up` (with `telegraph {attack: slam|stomp, center, radius, damage,
  landsInTicks, youAreInside}`) -> the blow lands -> `recovering`. A slam hits
  the 3x3 around the targeted player's tile for 9 after a 3-tick wind-up; every
  third attack is a stomp hitting everyone within 3 of its centre for 6 after 4
  ticks. **Walk out of the marked square** (Chebyshev > radius) before
  `landsInTicks` reaches 0 and you take nothing; then `attack_giant` again
  (moving stops your swings; so does being hit). A blow can kill you (the whole
  bag drops, club included). When it falls, everyone who dealt at least 16
  damage that life gets 3 obsidian (equal shares; online players only), and it
  rises again 500 ticks later (`respawnInTicks`).
- **Busy trees: wait and claim.** `harvest` on a regrowing or claimed tree is
  not an error: you walk next to it and wait. On the tick it ripens, waiters
  claim it in this order: newcomers (in first-spawn grace), then the earliest
  last input (any new action resets yours), then server order. The receipt has
  `waiting {treeId, ripeInTicks}` when the tree is not ready yet. Without
  `treeId`, `harvest` picks the tree with the soonest claim for you.
- **Safety.** No attack starts or lands while either player is inside the safe
  ring (`world.safeRing`, radius 2 around spawn). A player is also protected for
  10 ticks after respawning, and a new character is protected until it gets a
  stick (then 10 more ticks), attacks, or 3:00 (300 ticks) pass. Attacking ends
  your own protection. New characters start at 20/30 HP.
- **The goal.** `state.goal {id, text, hint, action, waiting?}` is the same
  "First Day" chip the browser shows: `pick-berry`, `eat-berry`, `find-stick`,
  `wield-stick` (only with combat access), `reach-coast`. `action` is the next
  step as an action (`harvest {treeId}`, `eat {slot}`, `wield {slot}`,
  `move {x, z}`) or `null` while you walk, wait or harvest. After First Day it
  continues on the Coast: `gather-coast` ("Gather driftwood and 2 flint on the
  Coast (n/3)", action `harvest {treeId}` on the right node), `make-club`
  (action `craft {recipe}`), then `wield-club`; after that it is `null`. If
  you lose your stick, `find-stick` and `reach-coast` return first.
- **Wielding.** `POST /actions/wield {"slot": n}` wields the weapon in quick slot
  `n`. Slots outside 0..2 get `400`. A slot without a weapon gets `422`.
  `POST /actions/unwield {}` goes back to punching.
- **Losing the stick.** Moving it out of the quick slots, dropping it, or dying
  unwields it.
- **Player state.** Each player in state has `weapon: null` (punching) or
  `{ itemId, name, damage }`. Other players' weapons are public, because the stick
  is drawn in their hand. Inventories stay private.

API version **1.2.0** (M2) added `craft`, `harvest {nodeId | kind}`,
`state.nodes` and `state.recipes`. API version **1.1.0** removed the rock-paper-scissors `stance` action and the
`stance`/`fightState` player fields. `/actions/stance` now returns 404
(`unknown_action` from the Node gateway, `not_found` at the Cloudflare edge).

To revoke a player as the gateway operator:

```sh
npm run agent:revoke -- PLAYER_ID
```

The world owner can also call `revoke_player` directly. The API checks the
live player before returning state or sending actions. Restarting the API
invalidates its in-memory bearer tokens; the database independently enforces
permit expiration if the API process crashes.

## Abuse controls

| Boundary | Enforced limits |
| --- | --- |
| Admission | Single-use invite; separate identity per session; server permit required even for direct SDK calls |
| Session | At most 1 hour total, 10 minutes idle, 1024 distinct action receipts |
| Actions | 1 attempt/second, burst 4; invalid arguments and denied scopes consume the same budget |
| Session requests | 2/second, burst 10 |
| IP requests | 2/second, burst 60; all paths and failed authentication count |
| IP joins | 1/minute, burst 5, including invalid invite attempts |
| Global requests | 20/second, burst 200; 64 requests in flight; 128 HTTP connections |
| API sessions | 16 total, 4 per IP, including pending connections |
| Database | 32 active agent permits; 128 online players; 4 connections per identity; 10,000 historical players/permits |
| Existing gameplay | 5 committed inputs/tick, server movement/combat/harvest/eating rules; 3-second chat cooldown |
| Payloads | 4 KiB JSON bodies; 8 KiB headers; strict fields, types, bounds and action allowlist; body deadline 3 seconds |

Tokens contain 256 random bits. Only session-token hashes are retained by the
HTTP service. Credentials are accepted only in Authorization headers; query
strings are rejected. Responses use `no-store`. Logs contain event type, public
session/player IDs, action and status; they omit tokens, headers, request bodies,
chat text, and upstream errors. Player names/chat are labeled untrusted in state.
Inventory is scoped by both the database visibility filter and the API response.

## Deployment boundary

Run **one API process** per admitted world with its private data directory on a
persistent local disk. Invite redemption is durable, but sessions and rate
buckets are process-local. Multiple replicas require a shared session/limiter
service and a coordinated invite store before they are supported.

Bind the service to loopback (the default), use an HTTPS reverse proxy, and
proxy `/api/agent` on the frontend origin to it. Serve `/agent.md` as a static
`text/plain; charset=utf-8` file so browsers display it inline, and rewrite
`/agent` to the frontend entrypoint. Configure
`BERIGAME_AGENT_ORIGIN=https://your-game-origin.example`.

The API ignores forwarded IP headers by default. If behind a proxy, set
`BERIGAME_AGENT_TRUSTED_PROXY_IPS` to the exact connecting proxy addresses. Those
proxies must **overwrite** X-Forwarded-For with one validated client address, and
the API port must be reachable only by those proxies. Header chains are rejected.
Without this setting, clients behind the same proxy intentionally share IP limits.

Add connection/request limits at the public reverse proxy for **both the API
and the raw SpacetimeDB endpoint**. Application limits constrain admitted play;
they cannot absorb network floods or eliminate the cost of rejected WebSocket
handshakes. Direct reducer validation also cannot charge rejected calls to a
persistent counter because reducer errors roll back their transactions.

[`deploy/nginx-agent-api.conf.example`](../deploy/nginx-agent-api.conf.example)
provides a single-origin HTTPS example with request and connection limits on
both services, overwritten client IP headers, and logs that omit query strings.
It is a deployment template, not an enabled or deployment-validated config;
replace its domain, certificate paths, frontend root and database name in the
WebSocket allowlist, then run `nginx -t` on the target host. Keep both upstream
ports private. Only identity creation and that world's subscription endpoint
are public; publish and administer databases over loopback or an SSH tunnel.
Do not proxy all SpacetimeDB routes: standalone servers otherwise allow remote
database creation. See the [SpacetimeDB self-hosting guide](https://spacetimedb.com/docs/how-to/deploy/self-hosting/).
Its WebSocket limits cover
handshakes and connection counts, not messages within an established socket.
The directives follow nginx's [request limiting](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html),
[connection limiting](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html),
and [WebSocket proxying](https://nginx.org/en/docs/http/websocket.html) documentation.

Environment: `BERIGAME_AGENT_URI`, `BERIGAME_AGENT_DB`, `BERIGAME_AGENT_DATA`,
`BERIGAME_AGENT_HOST` (default 127.0.0.1), `BERIGAME_AGENT_PORT` (default 3001),
`BERIGAME_AGENT_ORIGIN`, `BERIGAME_AGENT_TRUSTED_PROXY_IPS`. Remote SpacetimeDB
connections require WSS. Never expose gateway files in the frontend build,
commit them, or use a world-owner credential for the service.

## Verification

`npm test` includes simulation/reducer tests, frontend tests and API abuse tests.
Run `npm run agent:typecheck --prefix frontend` and
`npm run build --prefix frontend` as well.

`frontend/agent-api/integration.ts` drives the actual HTTP API against an isolated
SpacetimeDB server at `127.0.0.1:3010`. It requires
`BERIGAME_AGENT_INTEGRATION=1`, a database name starting with
`berigame-agent-api-check`, `BERIGAME_AGENT_TEST_OWNER` pointing to its disposable
owner credential JSON, and `BERIGAME_AGENT_TEST_DATA` pointing to its private test
directory. It checks real gameplay, separate identities, invite replay, scope
enforcement, direct connection rejection, revocation and throttling. Wielding a
berry must be rejected. The stick wield/unwield round trip runs only when its
first harvest happened to find a stick; otherwise it prints `SKIP`. It never
targets the ordinary game world.
