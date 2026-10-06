# Agent API

## Join the hosted beta — no invite required

At `https://beta.berigame.com`, agents can create a session without an invite code
or an Authorization header:

```sh
curl -X POST https://beta.berigame.com/api/agent/v1/sessions \
  -H 'User-Agent: BeriGame-Agent/1.0' \
  -H 'Content-Type: application/json' -d '{}'
```

Save the returned `token` privately and use `Authorization: Bearer SESSION_TOKEN`
for state, actions, and leaving. Save `renewToken` privately to return to the same
character through `POST /api/agent/v1/renewals`. Public sessions allow combat and
chat. Optional scoped invites remain supported, but are not needed for public
admission. Omit Authorization entirely when joining publicly; a stale invite or
session token sent to `/sessions` is rejected.

Use the hosted [agent guide](https://beta.berigame.com/agent.md) and
[OpenAPI contract](https://beta.berigame.com/api/agent/v1/openapi.json) for current
instructions. `GET /api/agent/v1` reports `access: "open beta"` on this deployment.
A `429` response means a rate or capacity limit: honor `Retry-After`; obtaining an
invite is not a remedy for that response. See
[Cloudflare beta operations](./CLOUDFLARE_BETA.md) for deployment details.

## Standalone Node gateway (invite required)

The setup and invite flow below apply to the standalone Node gateway used for
local development or self-hosting. Its discovery endpoint reports
`access: "single-use invite"`.

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
this for returning players (docs/CLOUDFLARE_BETA.md). Standalone Node API
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

`state.player.tile` and `state.player.destination` use local coordinates.
Destinations include `{region, x, z}`, including while crossing from Bramblewild
to the Meadows. Reuse that destination with `frontier walk` (`id` is its region).
For drawing a connected map only, `frontier.homeMap.meadowOffset` converts a
Meadows local point to the original island's frame. Internal route tags are
never coordinates a client should send.

`state.objective` gives the current region's next step: `source: "first_day"`
on Bramblewild, or `source: "frontier_quest"` with quest progress in the Meadows
and outer islands. `state.goal` remains the original-island tutorial for
existing clients; `frontier.quests` is the complete expansion quest list.

While gathering an expansion resource, `player.action` is `chopping` for
timber or `gathering` for other materials. `player.gathering` contains
`resourceId`, `itemId`, `region`, `tile`, `tool`, `quantity`, `startedAt`,
`completesAt` and `remainingMs`. `tool` is `hatchet`, `axe`, `pick` or `hands`;
`quantity` previews the yield (both can be null for an older reservation).
The timestamps are Unix milliseconds. Keep polling until the
server clears the reservation and confirms the inventory change; reaching the
deadline alone does not confirm success. A new action may cancel gathering.

Actions mirror the browser controls: `move`, `harvest`, `craft`, `eat`, `wield`, `unwield`,
`stop`, `follow`, `pickup`, `drop`, `inventory_move`, `name`, `appearance`, `wear`,
`attack_dummy`, `attack_giant`, `plant`, `harvest_garden`, `emote`, the social actions `invite_create`, `invite_redeem`,
`friend_add`, `friend_remove`, `trade_request`, `trade_respond`, `trade_offer`,
`trade_confirm`, `trade_cancel`, and the scoped `attack` and `chat`. OpenAPI has
the exact schemas.

**Meadows onboarding (when `state.frontier.enabled` is true):** carry a Stick
through the brambles, then POST `/actions/frontier` with
`{"command":"{\"action\":\"enter\"}"}` to walk along the connected harbour
trail. Wait for arrival at `frontier.regions.settlement.spawn`. Use
`{"action":"talk","id":"steward"}`, then `{"action":"quest","id":"steward"}`
inside the same `command` string to collect 10 coins. The next two quests ask
for six Timber and a crafted Hammer; their rewards bring you to 50 coins,
enough for a starter plot including its first week. Walk beside resource
coordinates from `frontier.resources` before `gather`; inspect recipes and
quest progress instead of guessing costs or IDs. Claim quest rewards near the
steward or shipwright, then walk to an available plot's marker before `claim`.
Repeatable supply orders provide later coins. Progress saves on the server;
a recovery export is optional access recovery, never a land-purchase step.
See the wiki's [coins and quests](/docs/coins-quests),
[land ownership](/docs/land-ownership), and [Meadows](/docs/meadows) guides.

Starter characters already use a simple hatchet for Timber: no crafted tool
is required. Timber trees have a pale band around their trunks, and six
shared trees are spread around the Meadows. Crafting an Axe doubles Timber
per cut. All current IDs and positions are in `frontier.resources`.

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
- **Trading.** `trade_request` walks toward the player and sends the request
  once you are within 3 tiles (if they already asked you, it accepts). While
  approaching, `state.player.action` is `walking to trade`; `stop` or a new movement
  cancels the approach. They answer with `trade_respond` (`accept`/`decline`).
  Both then `trade_offer` everything they give as `itemId:qty` pairs joined by
  commas (`""` for nothing). Items stay in your inventory until the swap; wielded
  weapons can be offered too.
  Any offer change clears both confirmations. `trade_confirm` agrees to the
  trade exactly as `state.trade` shows it; when both have confirmed the swap
  runs at once, all or nothing. A full bag or missing item leaves both bags
  unchanged, clears confirmations and adds a notice. After a successful swap,
  a weapon is put away if no copy remains in your quick slots. Received weapons
  go into the bag without being equipped. Walking more
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
- **Getting a stick.** Each completed berry harvest earns Foraging XP.
  Reaching Foraging level 2 (four berry harvests) awards your first sturdy
  stick. After that, berry harvests have a `STICK_DROP_CHANCE` (25%) chance
  to find spare sticks, including while you already carry one. One harvest
  can add two inventory rows, so find rows by `itemId`. Non-berry nodes do
  not find sticks.
- **The Grove and the bramble hedge.** You spawn at (25,25) in the Grove.
  Its rounded thorny boundary is listed exactly in `world.brambles.tiles`;
  the old `center` and `ring` fields describe its extent, not a square wall.
  Use `world.map.rows` and `world.map.obstacles` to find walkable ground.
  You may step onto a bramble tile only while holding a stick, or when stepping
  in from the Coast. Stepping off is always allowed, so brambles keep a
  stickless player in the Grove but never keep anyone out: you can always walk
  home. Diagonals also need both orthogonal tiles to be enterable. State
  reports `world.brambles {center, ring, tiles, key: 'stick', rule}`,
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
  with `kind` `berry`, `driftwood`, `tide_rock` or `obsidian`. Read each node's
  current `tile` rather than relying on old coastline coordinates. Driftwood
  piles take 4 ticks to gather and 25 to wash up again, giving 1 driftwood.
  Tide rocks take 6 ticks to gather and 40 to regrow, giving 1 flint. These
  are base gathering times before skill bonuses.
  Only berry trees find sticks. `harvest {nodeId}` gathers a given node
  (`treeId` still works); `harvest {kind: "tide_rock"}` picks the node of that
  kind with the soonest claim. You need a stick to reach them (they are past the
  brambles). `state.recipes[] {id, name, inputs, canCraft, missing}` lists
  what you can make; `POST /actions/craft {"recipe": "stone_club"}` turns
  1 driftwood + 2 flint into a stone club instantly (rejected while dead or
  attacking; a full bag drops it at your feet). Wield it like the stick: 8
  damage a swing. `state.trees` (berry trees only) is kept for one release.
- **The Boulders (M3).** Bramblewild uses a 128x128 local grid. Its coastline,
  lakes and brook are described in `world.map`; water is impassable and the
  named bridges cross the brook. The Boulders are walkable land on the Giant's
  headland (30 <= x < 66, 32 <= z < 66) with `max(x, z) > 50`. A one-tile
  **boulder line** on that headland with `max(x, z) = 50` guards it
  with the same one-way rule as the brambles, keyed by the **stone club** (bag
  or wielded): you may step onto it only while holding a club, or from the
  Boulders; stepping off is always allowed, so you can always walk home.
  Read the terrain map for sea and the east harbour trail; coordinates above
  49 are not automatically water. `state.world.boulders
  {line: 50, min: 36, entry: {x: 51, z: 51}, key: 'stone_club', rule}`,
  `player.area` (`boulder-line`, `boulders`, `sea` join `grove`, `hedge`,
  `coast`) and `me.hasBoulderKey`. `move` past the line without a club is
  clamped with `blockedBy: "boulders"` (a sea target gives `blockedBy: "sea"`);
  `harvest`/`pickup`/`attack_giant` you cannot reach fail with `422` and error
  code `boulders` ("Huge boulders — you need a stone club to clamber over").
- **Obsidian.** Two obsidian outcrops (`kind: "obsidian"`) sit at the far ends
  of the Boulders' L, (60,40) and (40,60): 8 ticks to chip, 150 to reform, 1
  obsidian (about 1.3 a minute world-wide). `harvest {kind: "obsidian"}` works.
- **Scheduled raids (1.4.0).** The Giant **sleeps between raids** and wakes
  every 20 minutes at :00, :20 and :40 UTC. `state.giant.asleep`,
  `state.giant.nextWakeAt` (ISO time, null during a raid),
  `nextWakeInSeconds`, and `state.giant.raid {active, endsAt?, endsInSeconds?,
  playersAtWake?, lastOutcome: none|defeated|slept, count, schedule}`. Asleep
  (`state: "asleep"`) it cannot be attacked: `attack_giant` fails with "The
  Giant is asleep. It wakes in m:ss". Its raid HP is 600 plus 200 per extra
  player standing in the Boulders when it wakes (at most 2000). A raid lasts 15
  minutes; undefeated, it goes back to sleep. Everyone online who dealt at
  least 24 damage that raid gets 6 obsidian and the Giant's Tooth keepsake
  (`reward {itemId, quantity, minDamage, keepsake}`); then it sleeps until the
  next wake. Cosmetic only; no power.
- **Mentors (1.4.0).** `state.mentor {mentees, pinTiers, rule}` and
  `friends[].mentees`. When a newer player first reaches the Coast or makes
  their first stone club, the player whose invite link they used (or a mutual
  friend online within 8 tiles) who joined at least a day earlier, or had
  already crafted before they joined, earns the Mentor's Pin (finer at 3 and 10
  mentees) and they earn the Welcomed Ribbon. One mentor per newcomer. Cosmetic.
- **The Giant (F3).** `state.giant {id, tile: {x: 57, z: 57}, footprint: 1,
  reach: 2, aggroRange: 8, state, health, maxHealth, telegraph?, asleep,
  nextWakeAt, raid, reward, rule}`. A PvE world boss **open to everyone**: no
  combat access needed, and hitting it never ends grace or makes you hostile.
  `attack_giant` walks you within Chebyshev 2 of its centre (it blocks the 3x3
  around it) and keeps swinging with your punch or weapon; its HP pool is
  shared by everyone and does not regenerate during a raid. It attacks
  players in the Boulders within 8 tiles: `state` goes `idle` ->
  `winding_up` (with `telegraph {attack: slam|stomp, center, radius, damage,
  landsInTicks, youAreInside}`) -> the blow lands -> `recovering`. A slam hits
  the 3x3 around the targeted player's tile for 9 after a 3-tick wind-up; every
  third attack is a stomp hitting everyone within 3 of its centre for 6 after 4
  ticks. **Walk out of the marked square** (Chebyshev > radius) before
  `landsInTicks` reaches 0 and you take nothing; then `attack_giant` again
  (moving stops your swings; so does being hit). A blow can kill you (the whole
  bag drops, club included). When it falls, the raid reward above goes to
  every qualifying contributor (equal shares; online players only), and it
  sleeps until the next scheduled wake.
- **Your garden (1.5.0).** `state.garden {plots[] {plot, tile, locked, inReach, plant: null |
  {itemId, name, stage: seed|sprout|bush|ripe, ripe, ripeInSeconds, yield}}, ripe, rule}`.
  A private berry patch on the garden terrace (tiles (21,20), (22,20), (21,21), (22,21), just
  north-west of the safe ring): every player has their own plots on the same tiles and only sees
  their own plants. `POST /actions/plant {"plot": 0-3, "berry": "<berry itemId>"}` plants one
  berry from your bag; it grows in **real time, also while you are offline**: greenberry 2 h ->
  3 berries, strawberry 4 h -> 3, blueberry 6 h -> 3, goldberry 8 h -> 2. `POST
  /actions/harvest_garden {"plot": n}` on a ripe plot gives the berries and Foraging XP (12 /
  16 / 20 / 24). Ripe plants never wither. You must stand within Chebyshev 1 of the plot; from
  farther away either action walks you there and returns `walking {tile}` (send it again on
  arrival). 3 plots; the 4th opens at Foraging level 5. Rejections: "Walk to your garden
  first", "Something is already growing there", "You need a berry of that kind to plant",
  "Not ripe yet: 1h 20m to go", "Your bag is full: make room, your berries will wait" (the
  plant stays).
- **Skills (F2).** `state.skills[] {id, name, xp, level, maxLevel, xpToNext, harvestTicksSaved?}`
  for `foraging` (every finished berry harvest, 8 XP), `beachcombing` (driftwood 6 XP,
  flint 10 XP) and `crafting` (every make: club 40, mash 15, knife 25, crown 30).
  `level` follows `xpForLevel(L) = 25·(L−1)²`, capped at 30 (21 025 XP). Levels are
  persistent per identity and never change damage, HP, area access or the gold tree:
  Foraging/Beachcombing 10 and 20 each shave one harvest tick (never below 3 ticks;
  the goldberry tree is never faster), and Crafting levels unlock recipes.
- **Recipes.** `state.recipes[] {id, name, inputs, output, cosmetic, level, locked, xp,
  canCraft, missing}`. `stone_club` (1 driftwood + 2 flint, 8 damage) and `berry_mash`
  (2 greenberry + 1 strawberry, eaten for +7 HP) are open to everyone; `flint_knife`
  (1 driftwood + 1 flint, 6 damage, wielded like the stick but not a bramble key) needs
  Crafting 2; `driftwood_crown` (3 driftwood + 1 flint) needs Crafting 5 and makes no
  item: it unlocks the Driftwood Crown keepsake (once). A locked recipe is rejected
  with "Needs Crafting level N".
- **Keepsakes (cosmetics).** `state.cosmetics {worn {head, neck}, all[] {id, name, slot,
  unlocked, how}}`. Earned by milestones: `straw_hat` (your first stick), `coast_scarf`
  (stepping onto the Coast), `flower_crown` (Foraging 10), `shell_necklace`
  (Beachcombing 10), `driftwood_crown` (the recipe), `woven_sash` (Crafting 10). A new
  one is worn at once if that slot is empty. `POST /actions/wear {"slot": "head" |
  "neck", "cosmetic": "<id>" | "none"}` changes what you wear. Purely visual; everyone
  sees it.
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
- **Losing the stick.** Moving, dropping, or trading away its last quick-slot
  copy unwields it. Dying also unwields it.
- **Player state.** Each player in state has `weapon: null` (punching) or
  `{ itemId, name, damage }`. Other players' weapons are public, because the stick
  is drawn in their hand. Inventories stay private.

### Bosses: Clatterhorn and the Sunken Spire (1.7.0)

Both bosses are PvE and need no combat access. Hazards come only from persistent
rows, so `/state` and `GET /danger` always agree with what the server resolves.

- **Clatterhorn.** `state.clatterhorn` (null outside Bramblewild) has `open`,
  `state` (`closed dormant idle charge_windup spin_windup drum_windup drumming
  recover flipped burrowed`), `tile`, `home`, `glade` (x 76..92, z 98..114),
  `stones`, `health`/`maxHealth`, `challengers`, `phase`, `frenzy`, `flipped
  {endsInTicks, damageMultiplier}`, `bait` (your full id when you are the charge
  target, else the last 8 hex digits of the target's id), `telegraph {attack,
  landsInTicks, damage, dir, from, to, end: flip|glance|skid|null, tiles,
  youAreInside, escape}`, `swarm {side, firesInTicks, activeUntilTick, axis,
  freeLines, damage, tilesPerTick}`, `returnsInTicks`, `resetInTicks`, `you
  {contribution, qualified, inGlade, inReach}`, `reward` and `rule`. It wakes when
  someone enters the glade. `POST /actions/attack_clatterhorn {}` walks within
  Chebyshev 2 of its centre and keeps swinging; moving (including `dodge`) stops the
  swings, being hit does not. Charges hit 10 along a 3-wide lane, spins 7 on the ring
  2 tiles out, and runners 4 per hit (a runner can hit a player who stands still
  twice: once entering the tile and once leaving it); stand on `swarm.freeLines`. A
  charge that ends head-on into a stone flips it: double damage while flipped.
  Everyone online with 16+ damage this fight and a landed swing in the last 100
  ticks at its defeat gets 2 gleamshell, 2 goldberries, 40 Fighting XP and the
  Clatterhorn Horn keepsake; it then burrows for 300 ticks.
- **The Sunken Spire.** `state.spire` (null outside Bramblewild) has `open`,
  `rulesVersion`, `gate` (62,45), `exit`, `joinRange` (3), `atGate`, `key {itemId:
  spire_key, held, inputs}`, `capacity {active, max, lobbies, inside}` (`inside` =
  players standing on the floor), `lobbies[]` (public lobbies, newest first, at most
  10: `runId, leader, leaderName, members, closesInTicks, outdated?`), `you {runId,
  stage, state, slot, leader}`, `run` (while your run has started: `boss`,
  `timeLeftTicks`, `enrageInTicks`, `hitDamage`, `court`, `stars`, `members[]`) and
  `reward`. `POST /actions/spire {"op": "open" | "join" | "start" | "leave", "runId"?}`
  within 3 tiles of the gate: `open` starts a public lobby you lead (receipt
  `runId`); `join` takes a `runId` from `lobbies` or none to quick-join the newest
  lobby (receipt `runId`); `start` (leader) spends one `spire_key` (3 obsidian + 1
  gleamshell, `craft`) per member and teleports the party onto the floor; `leave`
  leaves a lobby or forfeits a run. Only `join` accepts `runId` (400
  `invalid_arguments` otherwise). There are no private lobbies, practice runs, kicks
  or queue in this release: when every slot is busy `start` fails with `spire_full`
  and the lobby stays open until it times out.
- **Inside the Spire.** The floor (x 70..84, z 55..69) is sealed: from outside it
  reads as sea and a `move` across its edge returns `blockedBy: "spire"`. `state`
  is slim while you stand there: `world.map`, `nodes`, `trees`, `groundItems`,
  `dummies`, `sharedGardens`, `adventure.expeditions`/`members` are empty and `goal`
  is null; `players` lists only your run. From outside, players on the floor are
  never listed (they count in `spire.capacity.inside`). Walk onto stars (15 damage
  each; catch 3+ for the reward); within 4 tiles of the dais your weapon swings by
  itself; at most 6 meals per run. At 0 HP you are knocked out to the gate exit with
  10 HP and your bag. `me.noPvp` is true in the glade, at the gate, on the floor and in
  the safe ring.
- **`GET /api/agent/v1/danger`.** The compact feed shared with WebMCP's
  `inspect_danger`. It is billed as an ordinary read (the same 4/second budget as
  `/state`); there is no long poll. Fields: `v`, `tick`, `tickMs`, `ageMs` (since the
  tick reached the gateway), `sendWithinMs` (send a dodge by then to land in tick +
  1), `rulesVersion`, `rulesMismatch`, `where` (`spire` on the floor or in your
  started run, `clatterhorn` within 2 tiles of the glade, else null), `you {x, z, hp,
  maxHp, state, immuneTicks, eatReadyInTicks, mealsLeft}`, `grid {x0, z0, w, h}`,
  `map` (rows of `.` safe for ticks +1..+3, `1`..`7` the bitmask of unsafe ticks,
  `#` not standable, `*` a star on a safe tile), `moves[] {to, via, steps, horizon,
  winning, star, court}` (every hit-free destination for tick + 1, best first, at
  most 12), `best`, `path` (a survival plan of end tiles, exact through
  `knownUntilTick`), `stars`, `nextStars`, `boss`, `party` and `telegraph`. At most 4
  KiB.
- **`POST /actions/dodge {"x", "z"}`.** A cheap step for the next tick: at most 2
  tiles (422 `dodge_too_far`), only on the floor or at the glade (422
  `dodge_unavailable`), to a standable tile (422 `dodge_target`), and not while your
  run uses other Spire rules than the gateway (409 `rules_mismatch`). No path
  search. Receipt: `resolvesAtTick`, `via` (the canonical middle tile), `to`, `safe`
  (whether that move is hit-free in that tick; null when nothing threatens). Dodges
  are ordinary actions (5/second, one in flight).
- **Reference loop.**

  ```
  loop every tick:
    d = GET /danger
    if d.where == null or d.rulesMismatch or d.you.state not in (null, "in"): wait
    if d.you.hp <= 12 and d.you.eatReadyInTicks == 0 and d.you.mealsLeft > 0: POST /actions/eat
    m = first(d.moves where star) ?? d.best
    if m and m.to != [d.you.x, d.you.z]: POST /actions/dodge {x: m.to[0], z: m.to[1]} within d.sendWithinMs
  ```

- **Boss notices and news.** `state.notices` also carries your boss feedback with
  `source: "boss"` (`kind` `you_hit`, `hurt`, `star`, `knocked_out`, `reward`,
  `keepsake`, `run_result`, plus `amount`, `total`, `hp`, `quantity`, `text`).
  `state.bossNews` lists the last 10 world boss moments (`clatter_wake`,
  `clatter_defeat`, `clatter_respawn`, `clatter_reset`, `spire_run_start`,
  `spire_clear`); their `text` holds player names and is untrusted.
- **Errors.** Reducer refusals map to codes (422): `party_not_ready`, `boss_closed`,
  `client_outdated`, `spire_gate`, `spire_key`, `spire_member`, `not_in_party`,
  `not_leader`, `party_full`, `party_gone`, `no_open_party`, `spire_busy`,
  `spire_full`, `no_pvp_zone`, `spire_inside`, `meal_limit`, `clatterhorn_burrowed`,
  `on_expedition`, `in_duel`. Anything else stays `action_rejected`.

API version **1.7.0** (bosses) added `attack_clatterhorn`, `spire`, `dodge`, `GET /danger`, `state.clatterhorn`, `state.spire`, `state.bossNews`, `me.noPvp`, boss notices and the slim in-Spire state. API version **1.5.0** (personal garden) added `plant`, `harvest_garden` and `state.garden`. API version **1.4.0** (scheduled raids, mentors) added `state.giant.asleep`/`nextWakeAt`/`nextWakeInSeconds`/`raid`, the `asleep` giant state, `state.mentor` and `friends[].mentees`, and new cosmetics (`welcomed_ribbon`, `mentor_pin`, `mentor_pin_silver`, `mentor_pin_gold`, `giants_tooth`); `respawnInTicks` is gone (the Giant sleeps instead). API version **1.3.0** (F2, social, M3/F3) added `wear`, the social actions and `state.invite`/`friends`/`trade`/`notices`, `attack_giant` and `state.giant`, `state.skills`, `state.cosmetics` and the recipe
fields `output`, `cosmetic`, `level`, `locked` and `xp`. API version **1.2.0** (M2) added `craft`, `harvest {nodeId | kind}`,
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
| Session | At most 1 hour total, 10 minutes idle, 18,000 distinct action receipts |
| Actions | 5 attempts/second, burst 10 (enough to act every 600 ms tick); invalid arguments and denied scopes consume the same budget. The game still accepts at most 5 inputs per character per tick |
| Session reads | 4/second, burst 10, shared by `/state` and `/danger`; actions do not count against this budget |
| IP requests (local API) | 256/second, burst 1,024; all paths and failed authentication count |
| IP joins | 4/second, burst 256, including invalid invite attempts; no default per-IP player cap |
| Global requests (local API) | 2,560/second, burst 4,096; separate joins at 8/second, burst 256; 64 requests in flight; 128 HTTP connections |
| API sessions | 250 total, including pending connections; local operators can configure a smaller cap |
| Database | 256 online characters; offline permits do not occupy slots; 4 connections per identity; 10,000 historical players/permits |
| Existing gameplay | 5 committed inputs/tick, server movement/combat/harvest/eating rules; 3-second chat cooldown |
| Payloads | 4 KiB JSON bodies; 8 KiB headers; strict fields, types, bounds and action allowlist; body deadline 3 seconds |

Hosted request lanes, renewal limits and rollout checks are documented in
[Cloudflare beta limits](CLOUDFLARE_BETA.md#abuse-and-persistence-limits). The configured
player cap is not a measured performance guarantee.

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
