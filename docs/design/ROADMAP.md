# BeriGame roadmap: the first 3 minutes, then the Beacon and the coast (M1 to M3)

Status: design only. Owner decisions recorded in §3.
Baseline (in flight on this branch): every swing hits, punch 3, stick 6, a swing every 4 ticks (600 ms tick), `MAX_HP` 30, melee range 1, 2 tiles of movement a tick on a 50×50 grid, spawn at (25,25).
Trees (id): strawberry 1 (40,30) +3, greenberry 2 (30,35) +2, goldberry 3 (20,30) +10, blueberry 4 (30,25) +5, strawberry 5 (15,20) +3, greenberry 6 (25,15) +2. Harvest 5 ticks, regrow 50, one harvester per tree, 25% bonus stick (`STICK_DROP_CHANCE`).
Quick bar = bag slots 1–3 (keys 1–3). Eat cooldown 3 ticks. Death drops the whole bag. Beta characters last at most 1 hour.

---

## 1. Vision and rules of thumb

*"The first island": a cheerful, low-poly tropical brawler on a readable 600 ms tick, where every player gathers, eats and fights under the same rules.*

1. **Fewest concepts.** Before 3:00 a new player needs gather and the quick bar; eat and fight are taught in context. Each milestone adds at most one new verb.
2. **Something meaningful by 3:00.** A new character is armed and holding the island's best food within three minutes, even on a busy server (up to 5 newcomers arriving together, §2). No luck in drops; the newcomer's queue place and grace are protected.
3. **Equal starts.** Combat power comes from preparation (weapon, food, position), never from time played.
4. **Players are players.** No rule, score or reward depends on whether a player is a human or an agent; there is no reliable proof of personhood. Caps are per player, and only where farming matters.
5. **PvP is optional.** Every goal has a gatherer route. Players without the combat grant cannot be attacked, so the ring, grace and the stick do nothing for them: their First Day is 2 steps (a berry, then a goldberry), and they can finish every later goal except "land a hit".
6. **Session-sized, world-persistent.** A visit is a one-hour arc; the world (the Beacon) remembers.
7. **Mobile-first, cheap tick.** One goal chip, no new toolbar buttons. No per-tick movers or per-tick writes; new state lives outside the `player` row.

## 2. The first 3 minutes

The goal chip (M1) replaces the GatherShortcut button. It shows one line: the step, progress, and "tap to do it".

**"First Day"**, three steps plus one for fighters:

| # | Chip text | Done when | Verb taught |
|---|---|---|---|
| 1 | Pick a berry | Any berry in the bag | gather |
| 2 | Wield your stick: "Tap the stick in your quick bar" (desktop adds its key) | `player.weapon = 'stick'` | quick bar |
| 3 | Pick a goldberry, the island's best food | A goldberry in the bag | gather (contested) |
| 4 | *(combat grant, and an attackable player online)* Land a hit outside the ring | A Hit with you as attacker | fight |

- Players without the combat grant skip steps 2 and 4.
- With no attackable player online, step 4 is skipped and the chip reads **"First Day done"**.
- The key shown in step 2 comes from the stick's actual bag slot, not a fixed "2".
- Eat is not a First Day step: grace lasts until the goldberry, so a newcomer is rarely hurt. It is taught in the fight: while hostile and HP < 15, the CombatHud hint reads "Tap Goldberry (1) to heal +10" (best berry in the quick bar, its key, its heal).

**Script.** Walking times use Chebyshev distance to the tree's nearest free tile at 2 tiles a tick. "Busy" means 10 players online and every tree just claimed when you spawn, which is the worst case for one newcomer.

| Time (quiet) | Time (busy, worst case) | What the player sees and does |
|---|---|---|
| 0:00 | 0:00 | Spawn at (25,25) in the sand ring. HP 30/30, empty bag, a **Safe** badge on the HP bar. Chip: **1/3 Pick a berry**. |
| 0:03 | 0:03 | Tap the chip (tick 5). It walks you to the nearest ripe tree: the goldberry at (20,30), 4 tiles to its nearest free tile (21,29), 2 ticks. The blueberry at (30,25) is equally close; the lower tree id wins. Busy: nothing is ripe, so it walks you to the tree that ripens soonest and reads "Waiting: ripe in 29 s". |
| 0:04–0:07 | 0:33–0:36 | Harvest bar, 5 ticks (3.0 s). **+1 berry** in slot 1 and **+1 stick** in slot 2 (the stick is guaranteed, see below). Toast: "You found a stick". |
| 0:09 | 0:38 | **2/3 Wield your stick.** Tap it in the quick bar. The weapon chip reads "Stick · 6 dmg". |
| 0:10 | 0:38–1:09 | **3/3 Pick a goldberry.** Quiet: the first tree was gold, so this is already done (about 0:16 if it was not). Busy: if your first berry was not gold, the chip parks you at the gold tree and newcomer-first gives you its next ripening, by 1:09 at the latest. **First Day done:** armed (6 damage against a punch's 3), holding a +10 goldberry, and you know gather and the quick bar. Your grace ends here. |
| 0:10–3:00 | 1:10–3:00 | Open play. With the combat grant and an attackable player online, step 4 reads "Land a hit": a stick kills an unarmed player in 9.6 s, while their punches need 21.6 s. Otherwise the chip reads "First Day done". **In M1 a solo player has nothing more to do after about 0:10.** M2's Beacon fixes that (about 4 minutes of solo feeding to start a Bloom). |

**The guarantees (M1, no schema change):**
- **Stick: the carry-none rule.** A finished harvest always yields a stick when the harvester has no stick in the bag. Otherwise the 25% roll applies as before.
  - The `ctx.random` draw still happens on every harvest, so the draw order and replay fixtures are unchanged.
  - Bounded: at most one stick per harvest, only to someone holding none.
- **Contention: wait-and-claim, newcomer first, then first come first served.** `startHarvest` on a regrowing or claimed tree no longer throws. It queues `Pending.Harvest`, and the player waits on the adjacent tile.
  - On the tick a tree ripens, the waiter claims it in this order: newcomers first (`p.state === Alive && p.respawnTick > T`, true only during first-spawn grace, because after a death `respawnTick ≤ T` once you are alive), then earliest `lastInputTick`, then `s.order`.
  - Any input while waiting moves you to the back.
  - The chip shows "Waiting: ripe in N s" and never promises a place: a tree just claimed is 55 ticks (33 s) away, plus 33 s for each waiter ahead of you.
  - State needed: none new. Work is done only for waiting players, on the tick their tree ripens.
- **Safety: one Safe badge.** The ring, first-spawn grace and respawn grace show as one "Safe" badge on the HP bar.
  - The ring: x and z both in 23–27 (25 tiles).
  - Respawn grace: 10 ticks after a death (`tick < respawnTick + 10`).
  - First-spawn grace: `respawnTick = now + 290` at insert, so the same rule gives 300 ticks (3:00). It ends early on your first goldberry HarvestDone (`phaseHarvest` sets `respawnTick = 0`) or when you attack.
  - Grace covers the whole First Day, so a hit (which clears `pending` via `interrupt()`) cannot cost a newcomer their place in line or their bag.
- **Bound.** The goldberry is the limit: one per 33 s, about 1.8 a minute. The k-th newcomer arriving together finishes at 0:36 + (k−1)·33 s, which is under 3:00 for **k ≤ 5**. Sustained, the promise holds for **up to about 1.8 newcomers a minute**. Hourly churn at 30 online is about 0.5 a minute, which fits; a launch of 10 agents at once does not, and the 6th to 10th finish after 3:00.
- **Acceptance test** (sim, newcomers follow `state.goal`):
  - (a) 10 gather bots saturating all 6 trees, 1 newcomer: done before tick 300.
  - (b) 10 bots, 3 of them with the combat grant attacking the nearest attackable player, 1 newcomer: done before tick 300.
  - (c) 5 newcomers inserted on the same tick among the bots of (a): all done before tick 300.

## 3. Decisions (owner, recorded)

| # | Question | Decision | Where it lands |
|---|---|---|---|
| 1 | Persistent identity for returning browsers | Yes, in the future | Future F1 (the gate) |
| 2 | XP skills after the gate | Yes, in the future | Future F2 |
| 3 | Safe ring of radius 2 plus 10-tick respawn grace, with the blueberry tree outside it | Yes, now | M1 |
| 4 | Keep the full-bag drop on death | Yes | Unchanged through M3 |
| 5 | Humans-vs-agents tally | No: there is no reliable proof of personhood. Every mechanic that separates humans from agents for scoring or rewards is removed. | Everywhere (§1.4) |
| 6 | Future PvE Giant open to players without the combat grant | Yes, in the future | Future F3 |

Owner direction: the base is very simple, easy to understand, and meaningful in the first 3 minutes.

**Open questions (new):**
1. **A training dummy in the ring, so a solo player can land a first hit?** *Default: no in M1. Yes if more than 50% of sessions start with ≤1 other combat player online.*
2. **First-spawn grace length?** *Default: until your first goldberry or 3:00, whichever comes first; attacking ends it.*
3. **More than 5 newcomers at once (an agent launch) overrun 3:00 at the gold tree. Accept, or add a fallback?** *Default: accept in M1 and watch the time-to-First-Day metric; the M2 Bloom raises berry supply but not goldberry supply.*

## 4. Progression model

**World goal and gear now. Identity, then skills, in the future.**

| Layer | Ships in | Survives death? | Why |
|---|---|---|---|
| First Day chip | M1 | Yes (state plus a remembered done set) | Direction in the first 3 minutes |
| The Beacon | M2 | World-level | A solo goal, open to every player; a 1-hour guest still leaves a mark |
| Gear: stone club | M3 | No, it drops | Real power with real risk; equal starts |
| Persistent identity, then skills, titles and the bank | Future | Account | Only worth building once a returning player keeps their identity |

Why no XP now:
- Guest identities expire every hour (`lifetimeSeconds: 3600`), so a level ladder would reset each visit.
- Gating any harvest behind a level would turn time played into power. Goldberry out-heals every weapon.

## 5. Milestones

Codes: never reuse a shipped code (EventKind 0–7, Pending 0–2); a new one takes the next free number when it merges.

### M1 "The first 3 minutes" (no schema change)

What a new player sees in M1: movement and camera; the goal chip; ripe/regrowing trees and the harvest bar; "Waiting: ripe in N s"; the quick bar and wield toggle; eating (heal value, cooldown, full-HP block, the delay to your next swing); HP and the Safe badge; death drops the bag and ground pickup; attack/follow/stop; 4 berry heal values. Queue priority is invisible.

- **Safe ring:** `SAFE_RADIUS = 2`, a Chebyshev ring around `SPAWN_TILE` (x and z both in 23–27).
  - `attack` is rejected if either side is inside the ring.
  - `phaseSwings` lands no damage if either side is inside it, so an attacker who chases into the ring cannot hit someone just outside.
  - The blueberry tree (30,25) and the gold tree (20,30) stay outside. The gold tree's nearest tile (21,29) is 1 tick from the ring edge, so fights lost at the gold tree end in retreats into the ring. Accepted.
- **Grace:** a player is untargetable while `tick < respawnTick + 10`.
  - New characters: `respawnTick = now + 290` at insert (3:00). `phaseHarvest` sets `respawnTick = 0` on the first goldberry HarvestDone; `attack` sets it to 0 too.
  - The client shows the Safe badge while the ring or grace applies. The respawn timer UI stays keyed on `state = Dead`.
- **Stick guarantee:** the carry-none rule (§2). `harvestFindsStick(roll, hasStick)` returns `!hasStick || roll < STICK_DROP_CHANCE`, and the draw stays unconditional.
- **Wait-and-claim:** `startHarvest` queues on a regrowing or claimed tree instead of throwing. A pre-pass in `phaseHarvest` resolves ripening trees with several waiters: newcomer, then earliest `lastInputTick`, then `s.order`.
- **Goal chip:** `GatherShortcut` becomes `GoalChip`.
  - One line; tapping performs the step. On a gather step it goes to the ripe tree, or else the one that ripens soonest.
  - Steps come from one shared pure function in `shared/sim/goals.ts`, using state only: a berry in the bag, `player.weapon === 'stick'`, a goldberry in the bag, plus a remembered "done" set. (`combat_event` is an event table, so nothing is stored and a reload loses past events.)
  - The done set lives in `localStorage` per identity (wrapped in try/catch), so eating a berry never un-completes a step. If storage is empty it re-derives, and the worst outcome is a repeated step.
  - Step 4 appears only with the combat grant and an attackable player online.
- **CombatHud:** while hostile and HP < 15, the hint becomes "Tap <best berry> (<key>) to heal +N". (`GatherShortcut` and the chip are hidden while hostile, so the hint cannot live on the chip.)
- **Copy to update:** the Help panel ("Harvesting a berry tree can turn up a stick"; the gather step "Open your bag, select a berry, then Eat") and the LoadingScreen tip ("Harvesting can turn up a stick") must match the stick guarantee and the quick bar.
- **Art:** a sand ring decal (one mesh, no texture), the Safe badge and stick tooltips. No new models.
- **Agent API:**
  - `state.goal {id, text, progress, total, hint}` comes from the same `goals.ts`; the done set lives in the gateway session.
  - `harvest` may return `waiting {treeId, ripeInTicks}`.
  - Document the carry-none rule, the ring and grace in `agent.md`.
- **Tests (`server-reducers.test.ts` plus a new sim test):**
  - Attack is rejected, and no damage lands, when either side is in the ring.
  - Respawn grace ends at +10 ticks; a new character is protected until insert + 300 ticks; the first goldberry and attacking each clear grace.
  - An empty-bag harvest always yields a stick, and the draw count is unchanged against the fixture.
  - Waiters: a newcomer beats a veteran; among veterans, earliest `lastInputTick`, then `s.order`.
  - The §2 acceptance scenarios (a), (b) and (c).
  - `mobile-check.mjs` passes with the chip at 320×568.
- **Not in M1:** crafting, new items, NPCs, currencies, balance changes. The eat cooldown stays at 3 everywhere, in every milestone.

### M2 "The Beacon" (one new verb: feed)

- **Schema** (appended, with defaults):
  - `tree.kind u8 = 0` (0 berry, 1 driftwood; tide rock is added in M3).
  - `world_project(id u32 PK, projectId string, x, z, fuel u16, bloomUntilTick u32, lastFedBy string)`: public.
- **Seeding:** the tick seeds missing node ids (101+) when `tree.count() < NODE_SEEDS.length`. Idempotent, no version column.
- **Driftwood** (`shared/sim/nodes.ts`): 8 piles, 2–3 tiles in from the coast, each blocking its tile with a 1-tile gap to the next. Harvest 4, regrow 25, yields 1 driftwood (about 28 a minute world-wide).
- **The Beacon** sits at (27,27), inside the ring, and blocks its tile. It can be fed from inside the ring.
  - Fuel is **driftwood only, 1 each**. No decay.
  - Reaching **60 fuel** starts the **Goldberry Bloom** and resets fuel to 0: berry regrow drops from 50 to 38 ticks for 1000 ticks (10 min). Reaching 60 again during a Bloom extends it by 1000 ticks. World berries go from about 11 to about 14 a minute.
  - Solo cost: about 60 × 7 ticks, roughly 4 minutes of gathering and feeding.
- **Reducer:** `contribute(projectId, slot, qty)` via a new Pending code (reach 1). It emits a Contribute event, plus a BloomStart event, and sets `lastFedBy`.
- **No scores:** the panel shows "Last fed by <name>" and the recent Contribute events this client has seen. Nothing is minted or ranked, so no cap is needed.
- **UI:**
  - Tapping the Beacon opens a panel (fuel bar, Bloom timer, last fed by, Feed button).
  - After First Day, the chip continues with "Gather driftwood" and "Feed the Beacon (N/60)". This is the solo arc and works without the combat grant.
  - `ClickDropdown` gains a Gather label for driftwood.
- **Art:** driftwood as 3 instanced cylinders; the Beacon as a log pile with 3 emissive cones scaled by fuel. One icon (`frontend/public/items/driftwood.png`). No lights, no particles.
- **Agent API:** `harvest {nodeId?|kind?}` and `contribute {projectId, slot, qty}`. State: `nodes` (keep the `trees` alias for one release) and `projects`. Run `stdb:generate` and `beta:types`.
- **Tests:**
  - Seeding twice is a no-op.
  - Per-kind harvest and regrow ticks.
  - Only driftwood is accepted as fuel; 60 starts Bloom and resets fuel; 60 during Bloom extends it.
  - Regrow is 38 during Bloom and 50 after.
  - Contribute out of reach is rejected.
  - BFS reachability over the whole grid with all nodes placed.

### M3 "The Club" (one new verb: make)

- **Schema:** none new (`tree.kind` 2 = tide rock).
- **Tide rocks:** 4, one near each corner. Harvest 6, regrow 40, yields 1 flint (about 9 a minute world-wide). The corners are contested.
- **Stone club** = 1 stick + 2 flint, 8 damage, one-handed. Instant, works anywhere, rejected while dead or hostile. When you hold the inputs, a **"Make club"** button appears on the chip. Crafting the club leaves you with no stick, so the next harvest gives one.
- **Items:** add `description` to `ItemDef`. The club wields like the stick (quick bar only, put away if moved or dropped).
- **Art:** 2 icons (flint, club); the tide rock is a flat-shaded dodecahedron; the club is the stick with a lashed head. Shared vertex-colour material, no textures.
- **Agent API:** `craft {recipe}`; state `recipes[] {id, inputs, canCraft, missing}`.
- **Tests:** craft input handling and overflow to the ground; `smoke.ts` makes a club end to end.

### Future (owner-approved, not scheduled)

- **F1 Persistent identity (the gate).** Returning browsers keep their identity, using a scoped token in localStorage reused across the 1-hour grant renewals. Nothing below starts before this lands.
- **F2 XP skills.**
  - Skills: Foraging, Beachcombing and Crafting.
  - Curve: `xpForLevel(L) = 25·(L−1)²`, capped at L30 (21 025 XP, about 5 h per skill).
  - Levels unlock recipes, cosmetics and at most −2 harvest ticks (never below 3). They never grant damage, HP or access to the gold tree.
- **F3 The Giant.** A PvE world boss, open to every player, including those without the combat grant. The combat grant stays PvP-only.

## 6. Items and combat numbers

Item ids are permanent. Materials stack to 99 (`MAX_STACK`); the stick stacks to 1.

| id | Name | Source | Stats | M |
|---|---|---|---|---|
| `stick` *(existing)* | Stick | Any harvest if you hold none; otherwise 25% | 6 dmg / 4 t = 2.50 HP/s | M1 rule |
| `driftwood` | Driftwood | Driftwood pile | material; Beacon fuel 1 | M2 |
| `flint` | Flint Shard | Tide rock (corners) | material; the contested input | M3 |
| `stone_club` | Stone Club | 1 stick + 2 flint | 8 dmg / 4 t = 3.33 HP/s, one-handed | M3 |

**Combat matrix** (30 HP, no eating; time to kill from the first hit; swing every 2.4 s):

| Weapon | HP/s | Hits / TTK |
|---|---|---|
| Punch 3 | 1.25 | 10 / 21.6 s |
| Stick 6 | 2.50 | 5 / 9.6 s |
| Stone club 8 | 3.33 | 4 / 7.2 s |

**Food sustain** (eat cooldown 3 ticks, all milestones): greenberry +2 = 1.11 HP/s, strawberry +3 = 1.67, blueberry +5 = 2.78, goldberry +10 = 5.56.

Each eat also delays your next swing by 3 ticks, so a player who eats is not hitting.

What the numbers mean in a fight:
- **M1:** a stick doubles your damage against a punch. Berries are the tempo trade: heal now or swing now.
- **Eating is a delay, not a stalemate.** Blueberries against a stick net +0.28 HP/s, and a stack of 10 lasts about 18 s. Goldberry out-heals every weapon, but it comes from one tree (about 1.8 a minute), so it is the natural hill to hold.
- **M3:** a club kills in 4 hits instead of 5.

## 7. Balance and economy

- **World output per minute:**

  | Berries | Goldberries | Sticks | Driftwood | Flint |
  |---|---|---|---|---|
  | about 11 (about 14 in Bloom) | about 1.8 | about 2.7 from the roll, plus one per harvest by a player with no stick in the bag (at most about 11) | about 28 (M2) | about 9 (M3) |

- **Faucets are node items only.** Nothing is minted from nothing. The carry-none stick is the only per-player guarantee, capped at one per harvest, for someone holding none. Sticks are not Beacon fuel, so the guarantee cannot fuel the Bloom.
- **Sinks:**
  - Death drops (ground piles last 500 ticks).
  - Beacon fuel (driftwood, M2).
  - Crafting (M3).
- **Per-player caps that matter:**
  - The existing `MAX_INPUTS_PER_TICK` 5.
  - The agent API's 1 request a second.
  - One tree claim at a time.
  - No new caps are needed because nothing is scored or minted.
- **Knobs to tune first:**
  - First-spawn grace: until the first goldberry or 3:00.
  - The Bloom threshold of 60 driftwood.
  - Bloom length of 1000 ticks.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Veterans camp trees and new players starve | Wait-and-claim, newcomer first; the §2 acceptance scenarios include armed bots |
| More than 5 newcomers at once (e.g. an agent launch) | Bounded by the goldberry, about 1.8 a minute; the 6th and later finish after 3:00; watch the time-to-First-Day metric (open question 3) |
| Throwaway characters use grace or newcomer priority at the gold tree | New identities are free in beta, so this is bounded, not prevented: both end at the first goldberry or 3:00, attacking ends grace, one harvester per tree |
| Drop-and-reharvest stick farming | Bounded by harvest rate; sticks are not fuel; the stick stacks to 1 |
| Reusing `respawnTick` for new-character grace confuses the client | Respawn UI keyed on `state = Dead`; fall back to an appended `graceUntilTick` column |
| Solo players have nothing to do after First Day in M1 | M2's Beacon is a solo goal; the dummy per open question 1 |
| EventKind or Pending codes collide with in-flight branches | Never reuse a shipped code; take the next free number at merge |
| Node seeding bugs on the live beta | Seed only missing ids; "seeding twice is a no-op" test; publish with `--delete-data=never` |
| Mobile HUD overflow | One-line chip, the Safe badge on the HP bar, no new toolbar buttons or panel tabs |

## 9. Parked (cut from the earlier draft, each until a playtest shows the need)

| Idea | Why parked |
|---|---|
| Driftwood shield, offhand slot, armor | A second slot, wield rules and a turtle risk; the club is enough gear for now |
| Chronicle and "Island news" | "Last fed by" covers the mark a guest leaves; no stored prose to trim or sanitise |
| Old Maro NPC, talk, seashells, shop | The chip already gives direction; a currency needs sinks we do not have |
| Palm, frond, cord, coconut | An extra crafting step that teaches nothing new |
| Flint spear | Reach 2 and two-handed are two new concepts |
| Brace | A new button and a timing mind-game |
| Fishing and grill | A tool, spots and a station to add a food tier berries already cover |
| Requests board, Tides, visit aims, Warden crown | Economy and scoring layers; the gold tree is already the hill |
| Raft, dyes, bank, heartwood, basket insurance | After F1 at the earliest |
