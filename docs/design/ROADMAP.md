# BeriGame roadmap: the Grove, a lucky stick, and the way out (M1 to M3)

Status: design only. Owner decisions recorded in §4.
Baseline (live): every swing hits, punch 3, stick 6, a swing every 4 ticks (600 ms tick), `MAX_HP` 30, melee range 1, 2 tiles of movement a tick on a 50×50 grid, spawn at (25,25). A finished berry harvest finds a stick 25% of the time (`STICK_DROP_CHANCE`, `ctx.random`). Found weapons go to the quick bar (slots 1–3, keys 1–3).
Trees (id): strawberry 1 (40,30) +3, greenberry 2 (30,35) +2, goldberry 3 (20,30) +10, blueberry 4 (30,25) +5, strawberry 5 (15,20) +3, greenberry 6 (25,15) +2. Harvest 5 ticks, regrow 50, one harvester per tree. Eat cooldown 3 ticks. Death drops the whole bag. Beta characters last at most 1 hour.

---

## 1. Vision and rules of thumb

*"The first island": a cheerful, low-poly tropical brawler on a readable 600 ms tick. You wash up in a grove ringed by brambles; a sturdy stick gets you out, and each area gives you the key to the next.*

1. **Fewest concepts.** Before 3:00 a new player needs gather, eat, the quick bar and one rule: brambles need a stick. Each milestone adds at most one new verb.
2. **Something meaningful by 3:00.** You have gathered and eaten, and about 3 in 4 players (near-worst case, busy server) hold a sturdy stick. The stick is **pure luck: 1 in 4 berry harvests, no meter, no guarantee.**
3. **Keys open areas.** The stick lets you push through the bramble hedge to the Coast; the Coast's materials make the stone club, the key to Area 3. A key works while you carry it (bag or wielded). No key is stored on your character, and dying drops it.
4. **Equal starts.** Combat power comes from preparation (weapon, food, position), never from time played.
5. **Players are players.** No rule, score or reward depends on whether a player is a human or an agent; there is no reliable proof of personhood.
6. **PvP is optional.** Players without the combat grant cannot be attacked and skip the wield step; every area and key is open to them.
7. **Mobile-first, cheap tick.** One goal chip, no new toolbar buttons. No per-tick writes; schema changes are appended columns with defaults or new tables; static map data lives in `shared/sim`.

## 2. The map: the Grove, the bramble hedge, the Coast

The whole 50×50 grid is land (`GroundPlane.tsx`: a 50×50 plane over a 52×52 sand shelf), so the shore is the grid edge. North is −z (away from the default camera). `ring(t) = chebyshev(t, SPAWN_TILE)`.

| Area | Tiles | Rule |
|---|---|---|
| **The Grove** | `ring ≤ 16`: x and z in 9–41, 33×33 = 1089 tiles (1083 walkable; 6 trees) | Spawn, the safe ring (`ring ≤ 2`, 25 tiles) and all 6 berry trees |
| **Bramble hedge** | `ring == 17`: x or z = 8 or 42, one tile thick, **136 tiles** | Enter only while holding a stick; see the movement rule below |
| **The Coast** | `ring ≥ 18`: **1275 tiles**, a band 8 deep on the west and north (0–7), 7 deep on the east and south (43–49) | No food, no safe ring. M2 adds driftwood and flint |

```
.........................
.R..........d..........R.
.........................
.........................
....##################...
....#                #...
....#                #...
....#       g        #...
....#                #...
....#                #...
....#  s             #...
....#      ooo       #...
.d..#      o@o b     #.d.
....#      ooo       #...
....#                #...
....#     G         s#...
....#                #...
....#          g     #...
....#                #...
....#                #...
....#                #...
....##################...
.........................
.R..........d..........R.
.........................
```

1 char = 2×2 tiles, north up. `@` spawn, `o` safe ring, `#` bramble hedge, `.` Coast; trees `G` gold, `b` blue, `s` straw, `g` green; M2 nodes `d` driftwood, `R` tide rock.

- **Why ring 17:** the farthest tree is strawberry 1 at ring 15, so its harvest tiles reach ring 16 and one free column stays between it and the hedge (1-tile clearance). Every other tree is at ring 5 or 10.
- **No gaps, by construction:** a step changes `ring` by at most 1, so every path out of the Grove sets foot on a ring-17 tile. No diagonal can skip it.
- **Distances:** spawn to the hedge is 17 tiles (9 ticks, 5.4 s); no Grove tile is more than 9 ticks from the hedge; the strawberry 1 tree is 2 tiles from it. The north worn path (`frontend/src/Objects/GroundPlane.tsx`) already ends on the hedge at world z −17. Lengthen the east, west and south paths by 1 so all four end on the hedge at (25,8), (42,25), (25,42) and (8,25): the natural crossing points.
- **Connectivity:** the Coast is an annulus at least 7 tiles wide, so it is connected; M2's 8 single-tile nodes, 20+ tiles apart, cannot split it (tested anyway).

**Movement rule (stateless, per player, per step):** a player may step onto a bramble tile only if they hold a stick (bag or wielded) **or** they step in from the Coast (`ring(from) ≥ 18`). Stepping off a bramble tile is always allowed.
- In words: *without a stick, brambles keep you in the Grove but never keep you out of it.* A player who drops their stick on the Coast walks home; nobody is ever stranded.
- Standing on a bramble tile without a stick (you dropped it there, or it was crafted away): you can step straight across to either side, not along or diagonally (the orthogonal tile of a diagonal is bramble). On a corner tile ((8,8), (42,8), (8,42), (42,42)) you can only step outward (then walk home through any other hedge tile).
- Trees stay the only hard blocks; brambles are a passability predicate, not blocked tiles, so items can still drop on them and be picked up from an adjacent tile (either side).

## 3. The first 3 minutes

The goal chip (M1) replaces the GatherShortcut button: one line, "tap to do it".

**"First Day"**, five steps (four without the combat grant):

| # | Chip text | Done when | Teaches |
|---|---|---|---|
| 1 | Pick a berry | Your first HarvestDone (or a berry in the bag) | gather |
| 2 | Eat it: tap the <berry> in your quick bar | Your first Eat (or HP full) | eat, quick bar |
| 3 | Search the berry trees for a sturdy stick | A stick in the bag or wielded (skipped if harvest 1 found one) | luck, persistence |
| 4 | *(combat grant)* Wield your stick: tap it (desktop adds its key) | `player.weapon === 'stick'` | wield |
| 5 | Push through the brambles to the Coast | You stand on a tile with `ring ≥ 18` | the hedge rule |

- **New characters wash ashore tired: 20/30 HP** (first insert only; respawns and reconnects are unchanged), so step 2 heals for real. No count on step 3; the Help panel says "about 1 harvest in 4 turns one up".
- Steps come from state plus a remembered done set, so eating or losing the stick never un-completes a step. After First Day, a player holding no stick (a death drop) sees steps 3 and 5 again: they respawned in the Grove and need a new key.

**Script.** Walking uses Chebyshev distance at 2 tiles a tick; the player taps the chip on the tick after each harvest. "Busy, near-worst": 10 players online and every tree claimed on the tick you spawn, so every tree ripens and is re-claimed in lock-step (one harvest per 55 ticks), with newcomer priority (below).

| Quiet | Busy, near-worst | What happens |
|---|---|---|
| 0:00 | 0:00 | Spawn at (25,25), **20/30 HP**, a **Safe** badge. Chip: **Pick a berry**. |
| 0:03–0:07 | 0:03–0:36 | Tap (tick 5). Quiet: 2 ticks to (21,29), harvest the goldberry, done tick 12. Busy: parked at the gold tree, "Waiting: ripe in 30 s", harvest 0:33–0:36. 25% chance the stick comes now. |
| 0:08 | 0:37 | **Eat it** → 30/30 (goldberry +10). |
| 0:14 … 1:00 | 1:09, 1:42, 2:15, 2:48 | **Search for a stick.** Quiet: the chip hops to the tree with the soonest claim, a harvest every ~6.6 s (done 0:14, 0:20, 0:26, 0:34, 0:41, 0:47, 0:54, 1:00, …; 26 harvests by 3:00). Busy: one harvest per 33 s, 5 by 3:00. |
| on a find | on a find | Banner **"You found a sturdy stick! Tap it to wield — hits twice as hard"**, a sparkle on its slot. Grace ends 6 s later. Then **Wield** (grant only) and **"Push through the brambles to the Coast"**: at most 9 ticks (5.4 s) of walking. |

**Luck** (P(stick within k harvests) = 1 − 0.75^k; average 4 harvests, median 3):

| Harvests k | 1 | 2 | 3 | 4 | 5 | 8 | 10 | 16 | 26 |
|---|---|---|---|---|---|---|---|---|---|
| P(stick) | 25% | 44% | 58% | 68% | **76%** | 90% | 94% | 99% | 99.9% |
| Quiet, by | 0:07 | 0:14 | 0:20 | 0:26 | 0:34 | 0:54 | 1:07 | 1:47 | 2:55 |
| Busy near-worst, by | 0:36 | 1:09 | 1:42 | 2:15 | **2:48** | — | — | — | — |

- **By 3:00:** quiet, 99.9% (median find 0:20). Busy but staggered (the usual busy case): about 7–9 harvests by 3:00, roughly 9 in 10 (bots already standing at a ripe free tree claim at once, so newcomer priority only helps among waiters). Busy near-worst (lock-step, acceptance test (a)): 5 harvests, **76%, about 3 in 4**, the floor. Everyone has gathered and eaten by 0:08 (quiet) or 0:37 (busy).
- **Bad luck is real:** 1 player in 18 needs more than 10 harvests. That is the owner's call (no guarantee); the knob is `STICK_DROP_CHANCE` (open question 1).
- **No spare sticks:** while you hold a stick (bag or wielded), finished harvests do not find another. The `ctx.random` draw still happens on every harvest, so the draw order is unchanged.

**Safety: one Safe badge** (the ring or any grace):
- **Safe ring:** `SAFE_RADIUS = 2` (x and z both in 23–27). `attack` is rejected and no swing lands if either side is inside. The blueberry (30,25) and gold (20,30) trees stay outside.
- **Respawn grace:** 10 ticks after a death (`tick < respawnTick + 10`).
- **First-spawn grace: until you get a stick, attack, or 3:00.** On first insert `respawnTick = now + 290` (same rule → 300 ticks). Getting a stick while `respawnTick > T` (a find or a pickup) sets `respawnTick = T`: 10 more ticks (6 s) to wield and step back. An accepted `attack` sets it to 0. A reconnect does not reset it. About 1 in 4 players on a near-worst busy server meet 3:00 unarmed, in the Grove, next to the safe ring.

**Contention: wait-and-claim, newcomer first.** `startHarvest` on a regrowing or claimed tree queues `Pending.Harvest` instead of throwing; the player waits on the adjacent tile.
- On the ripening tick, waiters claim in this order: newcomers (alive with `respawnTick > T`, i.e. in first-spawn grace), then earliest `lastInputTick`, then `s.order`. Any input while waiting resets your `lastInputTick`.
- The chip (and the gateway's `state.goal`) picks the tree with the soonest claim for you: max(ripening, your arrival) + 55 ticks per waiter ahead of you, then nearest, then lowest id; while waiting it re-targets when another tree is ≥55 ticks sooner. It shows "Waiting: ripe in N s" and never promises a place.
- **Bound:** saturated, the Grove yields 6 harvests per 55 ticks (about 11 a minute). Up to 6 newcomers arriving together each get about 5 harvests by 3:00 (about 76% each); 12 together get about 2.5 each (about 51%). Finders drop out of the priority tier, so the unlucky ones get more than 2.5 each.

## 4. Decisions (owner, recorded)

| # | Question | Decision | Where it lands |
|---|---|---|---|
| 1 | Persistent identity for returning browsers | Yes, in the future | F1 (the gate) |
| 2 | XP skills after the gate | Yes, in the future | F2 |
| 3 | Safe ring of radius 2 plus 10-tick respawn grace | Yes, now | M1 |
| 4 | Keep the full-bag drop on death | Yes (it also drops your keys) | Unchanged |
| 5 | Humans-vs-agents tally | No: no reliable proof of personhood | Everywhere (§1.5) |
| 6 | Future PvE Giant open to players without the combat grant | Yes, in the future | F3, in Area 3 |
| 7 | Guaranteed stick (meter or pity) | **No: pure chance per harvest** | M1 |
| 8 | A way to progress after the stick | **Yes: the stick opens the next area** | M1 (hedge), M2 (Coast) |
| 9 | Brambles one-way or a strict wall | **One-way: you can always walk home without a stick** | M1 |
| 10 | Stick chance | **25% per finished berry harvest** | M1 |
| 11 | Training dummy: who may hit it, and where | **Decided: open to everyone (no combat grant), since it harms nobody. One static post at (28,28): ring 3, diagonal to the safe ring's SE corner, off the four worn paths, more than 2 tiles from every tree (harvest tiles stay clear). It blocks its tile; it takes hits and floats damage but never dies (60 HP that springs back to full, and back to full after 25 idle ticks, computed lazily). Swings work from the safe ring and in grace, and do not end grace. Server: `training_dummy` table plus `dummy_event` event table; the tick does one primary-key lookup (seeding it if missing) and writes only on a landed swing (no idle writes).** | Grove, now |
| 12 | Area 3 entry requirement | **Decided (M3 build): holding a stone club (bag or wielded), one-way, stateless, exactly like the stick and the brambles.** The club is the only item that needs both Coast inputs, so reaching the Boulders proves the Coast loop; no key is stored on the character and death drops it (§1.3). Grid grown, not carved (open question 2 resolved: default). | M3 |
| 13 | The Giant: numbers and fairness | **Decided (F3 build): 400 shared HP, telegraphed slam (3x3 on a player's tile, 9 dmg after 3 ticks) and every third attack a stomp (radius 3 around it, 6 dmg after 4 ticks), 3-tick recover, full regen after 100 idle ticks, respawn 500 ticks after defeat. Open to everyone, never ends grace or sets hostile; its blows skip players in grace. Reward: 3 obsidian to every online contributor with >= 16 damage that life (equal shares, no top-damage bonus: §1.4/§1.5).** | F3 |

Owner direction: the base is very simple, easy to understand, and meaningful in the first 3 minutes. Sticks are the first meaningful reward and are not easy.

**Open questions:**
1. **Club recipe: 1 driftwood + 2 flint (default) or 1 stick + 2 flint?** *Default driftwood: the stick stays your Grove key and driftwood has a use now that the Beacon is parked. If the stick is consumed, the club must also count as a bramble key.*
2. ~~**Area 3: grow the grid or carve it out of the Coast?**~~ *Resolved: grown (decision 12).*

## 5. Progression model

| Layer | Ships in | Survives death? | Why |
|---|---|---|---|
| First Day chip | M1 | Yes (state plus a remembered done set) | Direction in the first 3 minutes |
| Area keys: stick → Coast, stone club → Area 3 | M1, M2, M3 | **No, they drop** | Progress you can see on the map, with real risk; equal starts |
| Persistent identity, then skills, titles and the bank | Future | Account | Only worth it once a returning player keeps their identity |

Why no XP now: guest identities expire every hour, so a level ladder would reset each visit; gating harvests behind levels turns time played into power.

## 6. Milestones

Codes: never reuse a shipped code (EventKind 0 and 4–7, Pending 0–2); a new one takes the next free number at merge.

### M1 "The Grove" (no new verb, one new rule: the hedge)

What a new player sees: movement and camera; the goal chip; the stick-find banner; ripe/regrowing trees and the harvest bar; "Waiting: ripe in N s"; the quick bar and wield toggle; eating; HP and the Safe badge; the bramble hedge and its toast; death drops the bag.

- **Schema: none.** Grace reuses `respawnTick`; the brambles are static data. No `break-clients` publish.
- **Constants** (`shared/sim/constants.ts`): `HEDGE_RING = 17`, `SAFE_RADIUS = 2`, `RESPAWN_GRACE_TICKS = 10`, `FIRST_SPAWN_GRACE_TICKS = 300`, `FIRST_SPAWN_HP = 20`. `STICK_DROP_CHANCE` stays 0.25.
- **Map** (new `shared/sim/areas.ts`): `ringOf(t)`, `isBramble(t)`, `areaOf(t)` (`'grove' | 'hedge' | 'coast'`), `canEnter(from, to, hasStick)` = `!isBramble(to) || hasStick || ringOf(from) > HEDGE_RING`.
- **Pathfinding** (`shared/sim/pathfinding.ts`): `bfsPath`, `bfsNextStep` and `nearestReachableTile` take an optional `canEnter(from, to)`; `canStep` applies it to the destination and to both orthogonal tiles of a diagonal (no corner cutting through brambles). Default: allow all, so existing callers and tests are unchanged.
- **Server:** `holdsItem(slots, weapon, itemId)` in `shared/sim`. `setTarget`, `startHarvest`, `pickupItem` and `phaseMovement` (moves and follows) build the predicate from `holdsItem(…, 'stick')`. Cheap check first: `p.weapon === 'stick'` already means you hold one (the weapon stays in the quick bar), so `readSlots` (an owner-index filter, ≤28 rows) runs only for moving players not wielding it. `blocked.ts` stays trees-only. `bfsPath` is recomputed every tick, so dropping the stick mid-route makes it fail and clears the target: the player stops where they are (not re-clamped to ring 16).
- **Unreachable interactions:** if the interaction tile of `pickupItem` or `startHarvest` can't be reached under the player's predicate (a stick on the Coast from a death on the hedge, since `phaseDeath` drops onto `neighbors8`; an M2 node), the reducer throws `'Thorny brambles — you need a sturdy stick to push through'` and queues nothing. Today `nearestReachableTile` would clamp, the target clears and `Pending.Pickup`/`Harvest` would stay set forever.
- **Stick:** `harvestFindsStick(roll, holdsStick)` = `!holdsStick && roll < STICK_DROP_CHANCE`; `phaseHarvest` draws on every finished berry harvest as today.
- **Grace and ring:** as §3. First insert sets `hp = FIRST_SPAWN_HP` and `respawnTick = T + (FIRST_SPAWN_GRACE_TICKS − RESPAWN_GRACE_TICKS)` (= 290; never hard-code it); when a stick arrives during first-spawn grace, `phaseHarvest` and the pickup callers (`pickupItem`, and `resolvePending` via `p`) set `p.respawnTick = T`, not `takeGroundItem` (it only gets `ctx` and `owner`, and the tick writes its in-memory player copies back at the end, overwriting a write made inside it); an accepted `attack` sets 0. The client's respawn timer stays keyed on `state = Dead`.
- **Wait-and-claim:** as §3. A pre-pass at the start of `phaseMovement` resolves each tree that ripens this tick among its adjacent waiters; `resolvePending` keeps `Pending.Harvest` when the claim fails.
- **Goal chip:** `GatherShortcut` becomes `GoalChip`, driven by one pure function in `shared/sim/goals.ts` (state plus the done set, kept in `localStorage` per identity inside try/catch; if lost it re-derives and may repeat a step).
- **Hedge UI:** a click beyond the hedge without a stick walks to the nearest reachable tile (ring 16, as `nearestReachableTile` already does) and shows the toast **"Thorny brambles — you need a sturdy stick to push through"**. Arriving on the Coast the first time: toast "You pushed through to the Coast".
- **Art:** brambles as two instanced meshes (136 squashed flat-shaded icosahedra in dark olive, 0.5–0.6 tall with seeded jitter, plus ~400 small pale thorn cones), no pointer events (`raycast` disabled) so clicks reach the ground. A sand ring decal for the safe ring. Lengthen the east, west and south worn paths in `GroundPlane.tsx` by 1 (length 17) so they meet the hedge. Client move interpolation (`useTileMotion`) keeps the trees-only set: server tiles are authoritative.
- **Copy:** Help panel and LoadingScreen tip: "Harvests sometimes turn up a sturdy stick (about 1 in 4). A stick lets you push through the brambles." Agent onboarding and `contract.ts` text likewise.
- **Agent API:** `state.goal {id, text, hint}`; `state.me.area`; `state.world.brambles {center, ring: 17, key: 'stick'}`; `move` beyond the hedge without a stick returns the clamped tile plus `blockedBy: 'brambles'`; `harvest` may return `waiting {treeId, ripeInTicks}`. Document the hedge, grace and chance in `docs/AGENT_API.md`.
- **Tests** (sim plus `server-reducers.test.ts`):
  - Geometry: 136 bramble tiles; every tree and its 8 neighbours at `ring ≤ 16`; spawn inside.
  - Reachability: from spawn without a stick BFS reaches exactly the 1083 walkable Grove tiles; with a stick all 2494 walkable tiles. Coast only (flood limited to ring ≥ 18) from (0,0): 1275 tiles, 1267 with M2's 8 nodes. Without a stick from (0,0): 2494 (the way home is one-way).
  - A stick holder walks (25,25) → (2,25), crossing at (8,25): 23 steps, 12 ticks; without a stick the target clamps to ring 16 and the path stops there.
  - Dropping the stick on a hedge tile: the player can step orthogonally to ring 16 or 18, not along or diagonally; on a corner tile only outward. A stickless player on the Coast walks home.
  - `pickupItem` / `startHarvest` on a Coast target without a stick: throws the brambles message, no `Pending` set.
  - Follow and harvest pending respect the predicate: a stickless follower never paths onto brambles and stands still while the target is out of reach (`bfsPath` null keeps `combatTarget`; no fallback in M1).
  - `harvestFindsStick`: holders never find; otherwise `roll < 0.25` (0.25 is not a find); one draw per harvest, fixture draw count unchanged.
  - Grace: insert + 300; a find or pickup → 10 more ticks; attack → 0; reconnect keeps it; HP 20 on first insert only.
  - Waiters: a newcomer beats a veteran, then earliest `lastInputTick`, then `s.order`.
  - Acceptance (sim, newcomers follow `state.goal`; luck is not asserted, harvest opportunities are): (a) lock-step: 10 bots saturating all trees, 1 newcomer finishes ≥5 harvests before tick 300; (b) the same with 3 armed bots; (c) 6 newcomers together each finish ≥5 (finders leave the priority tier).
  - `mobile-check.mjs` passes with the chip at 320×568.
- **Not in M1:** crafting, new items, NPCs, currencies, balance changes beyond the no-spare rule. The eat cooldown stays 3.

### M2 "The Coast" (one new verb: make)

- **Schema:** `tree.kind u8 = 0` appended (0 berry, 1 driftwood, 2 tide rock). Publish like the `weapon` column: `--yes=remote,skip-login,break-clients` with `--delete-data=never`, then the Worker/static deploy right away (`docs/CLOUDFLARE_BETA.md`); run `stdb:generate` and `beta:types`.
- **Seeding** (`shared/sim/nodes.ts`): the tick seeds missing node ids (101+). Idempotent, no version column.
- **Driftwood:** 4 piles on the beach straight past each path crossing: (25,3), (46,25), (25,46), (3,25). Harvest 4, regrow 25, 1 driftwood (about 14 a minute world-wide).
- **Tide rocks:** 4, one per corner: (3,3), (46,3), (3,46), (46,46), 4–5 tiles past the hedge corners. Harvest 6, regrow 40, 1 flint (about 9 a minute). The corners are the contested spots: 2 ticks (4 steps) from the hedge corner to a tile next to the rock, 11 ticks (6.6 s, 21 steps) from the nearest path crossing.
- Only berry trees find sticks.
- **Stone club** = 1 driftwood + 2 flint (open question 3), 8 damage, one-handed, wields like the stick. `craft(recipe)` is instant, rejected while dead or hostile. When you hold the inputs, the chip shows **"Make a stone club"**.
- **Chip after First Day:** "Gather driftwood and 2 flint on the Coast" (progress `n/3`) → "Make a stone club" → (M3) "Take your club to the boulders".
- **Art:** driftwood as 3 instanced cylinders per pile; the tide rock a flat-shaded dodecahedron; icons for driftwood, flint, club. Shared vertex-colour material, no textures.
- **Agent API:** `harvest {nodeId? | kind?}`, `craft {recipe}`; state `nodes` (keep the `trees` alias for one release) and `recipes[] {id, inputs, canCraft, missing}`.
- **Tests:** seeding twice is a no-op; per-kind harvest and regrow; nodes never find sticks; craft inputs, rejection while hostile, overflow to the ground; Coast still connected with all nodes; `smoke.ts` makes a club end to end.

### M3 "The Boulders" (built; no new verb)

**As built.** `GRID_SIZE` 64 with `TILE_ORIGIN` 25 unchanged, so every existing tile, tree and node keeps its coordinates (`ISLAND_SIZE` 50 is the old island). A static land mask (`isLandTile`, `LAND_MASK` in `shared/sim/grid.ts`) makes every tile with x or z >= 50 sea, except the south-east L with both x and z >= 36: pathfinding (BFS, `canStep`, diagonal corner checks, `neighbors8` death drops) never enters the sea, so no blocked-set growth and no per-tick cost. `areaOf` adds `boulder-line` (`max(x, z) = 50`, 29 tiles), `boulders` (`max(x, z) > 50`, 559 tiles) and `sea`; the Coast stops at the old shoreline. `canEnter(from, to, hasStick, hasClub)`: the boulder line needs a club unless you step in from the Boulders (one-way, like the brambles); the tick reads the bag once per moving player for both keys (`heldKeys`). Obsidian: node kind 3, ids 109 (60,40) and 110 (40,60), harvest 8, regrow 150. Chip: after the club, "Take your club to the Boulders" (walks to (51,51)), then "Face the Giant", or "chip obsidian" while it rests; done once you hold obsidian. Art: two vertex-coloured ash-ground slabs and shelves, the ocean shader's shoreline follows the L, 29 instanced boulders plus fillers on the line, instanced rim rocks and pebbles (three draws, raycast off), an obsidian outcrop node model. The volcano glb dressing is still parked.

- **Land (original sketch):** grow `GRID_SIZE` to 64 with `TILE_ORIGIN` unchanged, so every existing tile, row and tree keeps its coordinates; the new strip lies east and south (x or z 50–63). Most of it is static water (a blocked mask in `shared/sim`); the south-east corner becomes **the volcano shore**, dressed with the unused `models/island-volcano.glb` (copy it into `frontend/public/models` to load it). `GroundPlane` centres a `GRID_SIZE` plane at world −0.5 and `IslandDetails` spreads cover over ±24, both assuming `GRID_SIZE/2 == TILE_ORIGIN`: the ground mesh and ground cover move to the new centre, and `areaOf` stops the Coast at the old shoreline.
- **Key:** a boulder band on the old south-east shoreline, passable while holding a stone club: the same stateless holding rule and one-way return as the brambles. Smashable boulders with stored state are parked.
- **Contents:** the Giant (F3), a rare resource (obsidian), and the natural home for a world goal if the Beacon returns.

### Future (owner-approved, not scheduled)

- **F1 Persistent identity (the gate). Done.** Returning browsers keep their identity via a scoped, rotating renewal token reused across the 1-hour grant renewals (30 days after the last visit; design and threat model in `docs/CLOUDFLARE_BETA.md`). Nothing below starts before this.
- **F2 XP skills. Done.** Foraging, Beachcombing, Crafting; `xpForLevel(L) = 25·(L−1)²`, capped at L30 (21 025 XP, about 5 h per skill). Levels unlock recipes, cosmetics and at most −2 harvest ticks (never below 3); never damage, HP, area access or the gold tree.
  - **Rules** (`shared/sim/skills.ts`): XP per finished harvest: berry 8 (Foraging), driftwood 6, flint 10 and obsidian 14 (Beachcombing; obsidian added at the M3 merge: scarce, 2 nodes on a 158-tick cycle, and its −2 tick cap takes 8 → 6, far below the 150-tick regrow); per make: club 40, mash 15, knife 25, crown 30 (Crafting). A berry every ~6.6 s is ~1.2 XP/s, so L30 is ~5 h. Harvest ticks −1 at L10 and −2 at L20 in the node's skill, never below 3 (driftwood 4 → 3, flint 6 → 4, berries 5 → 3); the goldberry tree is never faster.
  - **Schema** (additive): `player_skill {identity pk, foragingXp, beachcombingXp, craftingXp}` and `player_cosmetic {identity pk, unlocked (bit mask), head, neck}`, both public, created lazily, written only when XP or an unlock is earned (one PK write per finished harvest or craft; never per tick). Harvest length reads the level with one PK lookup when a claim starts.
  - **Recipes** (§7): power stays at level 1 (§1.4): the club, and new **Berry Mash** (2 greenberry + 1 strawberry → +7 HP in one bite, below a goldberry). **Flint Knife** (1 driftwood + 1 flint, 6 damage = a stick, not a bramble key) needs Crafting 2; the cosmetic **Driftwood Crown** recipe (3 driftwood + 1 flint, no item) needs Crafting 5. The bag lists locked recipes with their level. Future obsidian recipes append to `RECIPES` with their own level. The driftwood shield stays parked (§10).
  - **Cosmetics ("keepsakes")**: Straw Hat (first stick: a find or a pickup), Coast Scarf (first step from the hedge onto the Coast, or landing past the hedge via an invite link), Flower Crown (Foraging 10), Shell Necklace (Beachcombing 10), Driftwood Crown (the recipe), Woven Sash (Crafting 10). Two slots (head, neck); a new unlock is worn if its slot is empty; `wearCosmetic(slot, id+1 | 0)` changes it. One shared low-poly vertex-colour mesh per cosmetic on the `Head` / `Neck` bone (one draw call, no textures). Purely visual.
  - **Client**: Skills panel (Style → Skills tab, or K), blue "+8 Foraging" floaters over your own head, a level-up / keepsake banner with a synthesized fanfare (`levelup`), keepsakes in the Style panel. Agent API 1.3.0: `state.skills`, `state.cosmetics`, recipe `level`/`locked`, action `wear`.
- **F3 The Giant. Built** (decision 13). Server: `giant` (one row), private `giant_contribution` and the `giant_event` event table; `attack_giant` (no combat grant) queues `Pending.Giant` (4); `phaseGiant` in the tick does one primary-key read, player swings first, then `stepGiant` (pure, `shared/sim/giant.ts`): idle -> wind-up (telegraph) -> blow -> recover; writes only on transitions and hits. Client: a procedural stone giant (idle, wind-up, slam, stomp, flinch, topple), a red telegraph square that fills as the blow nears, a dust ring, an HP bar and a resting countdown; minimap marker; agent API `state.giant` and `attack_giant`.

## 7. Items and combat numbers

Item ids are permanent. Materials stack to 99; weapons stack to 1.

| id | Name | Source | Stats / role | M |
|---|---|---|---|---|
| `stick` *(existing)* | Sturdy stick | 25% of finished berry harvests, only for players holding none; death drops | 6 dmg; **key to the Coast** | M1 rule |
| `driftwood` | Driftwood | Driftwood pile (Coast) | club handle | M2 |
| `flint` | Flint Shard | Tide rock (Coast corners) | club head; the contested input | M2 |
| `stone_club` | Stone Club | 1 driftwood + 2 flint | 8 dmg, one-handed; **key to Area 3** | M2 |
| `berry_mash` | Berry Mash | 2 greenberry + 1 strawberry | food, +7 HP (below goldberry) | F2 |
| `flint_knife` | Flint Knife | 1 driftwood + 1 flint, Crafting 2 | 6 dmg (a stick's), not a key | F2 |

**Combat matrix** (30 HP, no eating, swing every 2.4 s): punch 3 = 1.25 HP/s, 10 hits / 21.6 s; stick 6 = 2.50 HP/s, 5 hits / 9.6 s; club 8 = 3.33 HP/s, 4 hits / 7.2 s.

**Food sustain** (eat cooldown 3 ticks): greenberry +2 = 1.11 HP/s, strawberry +3 = 1.67, blueberry +5 = 2.78, goldberry +10 = 5.56. Each eat delays your next swing by 3 ticks. Goldberry out-heals every weapon but comes from one tree (about 1.8 a minute): the hill to hold. All food is in the Grove, so Coast trips are provisioned trips.

## 8. Balance and economy

- **World output per minute:** berries about 11 (Grove only), goldberries about 1.8, sticks at most about 2.7 (25% of stickless players' harvests), driftwood about 14 (M2), flint about 9 (M2).
- **Faucets are node items only.** No meter, no pity: the only stick rule besides the roll is "none while you hold one", so no spares pile up to hand out.
- **Sinks:** death drops (ground piles last 500 ticks, keys included); crafting (M2; F2 adds the mash, the knife and the crown, which burns 3 driftwood + 1 flint once per player).
- **Obsidian (M3/F3):** outcrops about 1.3 a minute world-wide (2 nodes, 158-tick cycle); the Giant adds 3 per contributor per kill, at most one kill per ~5.5 minutes (500-tick respawn plus the fight: a lone club takes ~2 min, four clubs ~30 s). Obsidian has no recipe yet (parked: the next weapon or cosmetic), so it is a trophy and a stockpile, not power. Dying in the Boulders drops the club there; a friend can carry it out, or you craft another.
- **Levels never buy power (F2):** the strongest weapon (club) and all food stay level 1; the only gated item (the knife) matches the stick's damage. Harvest speed tops out at −2 ticks and skips the gold tree, so the hill to hold is unchanged.
- **Area flow:** armed players leave for the Coast, which thins the Grove where the unarmed newcomers are. Food pulls them back.
- **Per-player caps:** `MAX_INPUTS_PER_TICK` 5; the agent API's 1 request a second; one tree claim at a time; harvests find a stick only while you hold none.
- **Knobs, in order:** `STICK_DROP_CHANCE`; `HEDGE_RING` (17 is the minimum with 1-tile tree clearance); first-spawn grace length; flint regrow; then the Giant's `GIANT_MAX_HP`, wind-up ticks and slam damage (`shared/sim/giant.ts`).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Unlucky streaks (1 in 18 needs >10 harvests) feel unfair | Celebrate the find; Help says "about 1 in 4"; watch p75 time-to-stick, raise the chance first (open question 1) |
| Veterans camp trees and newcomers starve | Wait-and-claim, newcomer first; acceptance scenarios include armed bots |
| M1 ships before M2: the Coast is empty sand | Ship M2 right behind M1; in M1 the Coast is still a visible goal and the chip ends at step 5 |
| Stranded on the Coast without a stick | One-way brambles: you can always walk home |
| Stick hand-offs (a friend drops one at the hedge) | Accepted: co-op; harvests never find a spare, pickups may; sticks drop on death |
| Per-player pathing cost | One `readSlots` per moving player per tick; cache per tick if profiling asks |
| Throwaway characters use newcomer priority | Bounded: priority ends at a stick, an attack or 3:00; one harvester per tree; optional: no priority at the gold tree |
| Agents treat brambles as walls and get stuck | `blockedBy: 'brambles'` on `move`, the rule in `AGENT_API.md`, `state.me.area` |
| Reusing `respawnTick` for first-spawn grace confuses the client | Respawn UI keyed on `state = Dead`; fall back to an appended `graceUntilTick` |
| Node seeding bugs on the live beta | Seed only missing ids; "seeding twice is a no-op" test; `--delete-data=never` |
| Mobile HUD overflow | One-line chip, Safe badge on the HP bar, toasts only |

## 10. Parked (each until a playtest shows the need)

| Idea | Why parked |
|---|---|
| Stick meter, pity counter, guaranteed 5th harvest | Owner: the stick is not guaranteed |
| The Beacon and the Goldberry Bloom (feed driftwood, faster regrow) | The areas are now the solo arc; a second verb in M2. Candidate world goal for Area 3 |
| "Land a hit" First Day step | The Coast is the step after the stick for everyone. (The training dummy itself shipped: decision 11.) |
| Driftwood shield, offhand slot, armor | A second slot and a turtle risk; the club is enough gear |
| Chronicle, Old Maro NPC, seashells, shop | The chip gives direction; a currency needs sinks we do not have |
| Palm, frond, cord, coconut; flint spear; brace | Extra steps or new concepts that teach nothing new |
| Fishing and grill | A food tier berries already cover |
| Smashable boulders with stored state | The holding rule is stateless and consistent with the hedge |
| Raft, dyes, bank, heartwood, basket insurance | After F1 at the earliest |
