# BeriGame roadmap: earn a sturdy stick in the first 3 minutes, then the Beacon and the coast (M1 to M3)

Status: design only. Owner decisions recorded in §3.
Baseline (in flight on this branch): every swing hits, punch 3, stick 6, a swing every 4 ticks (600 ms tick), `MAX_HP` 30, melee range 1, 2 tiles of movement a tick on a 50×50 grid, spawn at (25,25).
Trees (id): strawberry 1 (40,30) +3, greenberry 2 (30,35) +2, goldberry 3 (20,30) +10, blueberry 4 (30,25) +5, strawberry 5 (15,20) +3, greenberry 6 (25,15) +2. Harvest 5 ticks, regrow 50, one harvester per tree, 25% bonus stick today (`STICK_DROP_CHANCE`; M1 lowers it to 10% and adds the stick meter).
Quick bar = bag slots 1–3 (keys 1–3). Eat cooldown 3 ticks. Death drops the whole bag. Beta characters last at most 1 hour.

---

## 1. Vision and rules of thumb

*"The first island": a cheerful, low-poly tropical brawler on a readable 600 ms tick, where every player gathers, eats and fights under the same rules.*

1. **Fewest concepts.** Before 3:00 a new player needs gather and the quick bar; eat and fight are taught in context. Each milestone adds at most one new verb.
2. **Something meaningful by 3:00: the sturdy stick.** It is the first real reward and it is earned, not handed out: about 5 harvests of work. A new character finds one within three minutes even on a busy server (up to 6 newcomers arriving together, §2). **The stick is earned: a visible meter, luck can only make it sooner.** The newcomer's queue place and grace are protected until they find it.
3. **Equal starts.** Combat power comes from preparation (weapon, food, position), never from time played.
4. **Players are players.** No rule, score or reward depends on whether a player is a human or an agent; there is no reliable proof of personhood. Caps are per player, and only where farming matters.
5. **PvP is optional.** Every goal has a gatherer route. Players without the combat grant cannot be attacked, so the ring and grace do nothing for them. Their First Day is 2 steps (find a sturdy stick, then a goldberry); they may still wield the stick, and it pays off against the F3 Giant. They can finish every later goal except "land a hit".
6. **Session-sized, world-persistent.** A visit is a one-hour arc; the world (the Beacon) remembers.
7. **Mobile-first, cheap tick.** One goal chip, no new toolbar buttons. No per-tick movers or per-tick writes; schema changes are appended columns with defaults or new tables.

## 2. The first 3 minutes

The goal chip (M1) replaces the GatherShortcut button. It shows one line: the step, progress, and "tap to do it".

**"First Day"**, three steps (two without the combat grant):

| # | Chip text | Done when | Verb taught |
|---|---|---|---|
| 1 | Find a sturdy stick — gather berries n/5 | A stick in the bag or wielded | gather |
| 2 | *(combat grant)* Wield your stick: "Tap the stick in your quick bar" (desktop adds its key) | `player.weapon === 'stick'` | quick bar |
| 3 | *(combat grant, and an attackable player online)* Land a hit outside the ring. *Everyone else:* Pick a goldberry, the island's best food | A Hit with you as attacker / a goldberry in the bag | fight / gather (contested) |

- **One rule for the grant:** step 2 and "Land a hit" need the combat grant. Without it, First Day is step 1 then "Pick a goldberry"; wielding still works but is not a step.
- Step 3 is re-derived live: if the last attackable player leaves, a fighter's step 3 turns into "Pick a goldberry". Step 3 is done when whichever form is showing is satisfied; once it is in the done set, First Day stays done (an attackable player joining later does not reopen it).
- `n` is the public `player.stickSearch` (0–4). The key shown in step 2 comes from the stick's actual quick slot, not a fixed "2".
- Eat is not a First Day step: grace lasts until you find your stick (plus 6 s to wield), so a newcomer meets fights armed. Eating is taught in the fight: while hostile and HP < 15, the CombatHud hint reads "Tap Goldberry (1) to heal +10" (best berry in the quick bar, its key, its heal).

**Script.** Walking times use Chebyshev distance to the tree's nearest free tile at 2 tiles a tick; the player taps the chip again on the tick after each harvest. "Busy" means 10 players online and every tree just claimed when you spawn. Every tree then ripens and is re-claimed on the same tick (every 55 ticks), so moving gains nothing: this is the same as waiting at one tree, and a near-worst case for one newcomer (5 × 55 ticks). If a tree is instead claimed on the tick you arrive (a veteran takes the gold tree at tick 7, so it ripens at 62), the 5th claim is at 282 and the 5th harvest is done by about tick 287 (2:52), still inside priority. Times assume no lucky find; each harvest has a 10% chance to end the search early.

| Time (quiet) | Time (busy, near-worst) | What the player sees and does |
|---|---|---|
| 0:00 | 0:00 | Spawn at (25,25) in the sand ring. HP 30/30, empty bag, a **Safe** badge on the HP bar. Chip: **1/3 Find a sturdy stick — gather berries 0/5** (1/2 without the grant). |
| 0:03–0:07 | 0:03–0:36 | Tap the chip (tick 5). Quiet: it walks you to the tree with the soonest claim, the goldberry at (20,30): 4 tiles to (21,29), 2 ticks (the blueberry is equally close; the lower tree id wins). Harvest bar, 5 ticks. **+1 goldberry**, meter **1/5**. Busy: nothing is ripe; every tree ripens at 0:33, so the chip parks you at the nearest, the gold tree: "Waiting: ripe in 30 s". Newcomer first, you harvest 0:33–0:36. |
| 0:08–0:26 | 0:37–2:15 | Harvests 2–4, meter **2/5 … 4/5**. Quiet: the nearest ripe tree each time, a 4–5 tick walk plus 5 ticks: greenberry (30,35) done 0:13, blueberry (30,25) done 0:19, strawberry (40,30) done 0:26. The bag is now goldberry, greenberry, blueberry, strawberry in slots 1–4. Busy: the same tree's next ripenings, done 1:09, 1:42, 2:15. |
| 0:34 | 2:48 | Harvest 5 always finds it. Quiet: greenberry (25,15), 7 ticks away, done 0:34; the greenberry stacks, and the stick takes quick slot 3 (the blueberry moves to slot 5). Busy: done 2:48, stick in slot 2. Banner: **"You found a sturdy stick! Press <key> to wield — hits twice as hard"** (quiet: 3, busy: 2; touch: "Tap it in your quick bar"), a sparkle on its slot and the "+ Stick" float. **Your grace ends 6 s later** (10 ticks to wield and step back); newcomer priority ends at once. |
| 0:34 | 2:49 | **2/3 Wield your stick.** The weapon chip reads "Stick · 6 dmg". |
| 0:34–3:00 | 2:49–3:00 | **3/3.** With the combat grant and an attackable player online: "Land a hit": a stick kills an unarmed player in 9.6 s, while their punches need 21.6 s. Otherwise "Pick a goldberry", already in the bag from harvest 1 in both timelines, so the chip reads **"First Day done"**. **In M1 a solo player has nothing more to do after about 0:34.** M2's Beacon fixes that (about 4 minutes of solo feeding to start a Bloom). |

- **Luck.** Chance of finding the stick on harvest 1–4: 10%, 9%, 8.1%, 7.3%; 66% of players need all five. Average 4.1 harvests. Average find: about 0:27 quiet, about 2:18 busy.
- **Busy but staggered** (the usual case: trees ripen at different ticks): the chip hops to the tree with the soonest claim, about one harvest every 18 ticks, so the stick comes at roughly 1:00. The lock-step case above is the bound.

**The guarantees (M1, one appended column):**
- **Stick: the meter.** Every finished harvest by a player without a stick either finds one or adds 1 to `player.stickSearch`.
  - Pure helper: `harvestFindsStick(roll, harvestsWithoutStick)` returns `roll < STICK_DROP_CHANCE || harvestsWithoutStick + 1 >= STICK_GUARANTEE_HARVESTS` (0.10 and 5). So the 5th stick-less harvest always finds one, and luck can only make it sooner.
  - A find grants the stick and resets the counter to 0. The counter survives death, so a stick lost in a death drop is earned again through the same meter.
  - **While you hold a stick (bag or wielded), harvests neither advance the meter nor find one; the draw still happens.** No spares pile up, and nobody can find sticks to hand out.
  - The `ctx.random` draw still happens on every finished harvest, so the draw order is unchanged; fixtures' expected stick outcomes are regenerated.
  - Supply: one stick guaranteed within 5 of your own harvests, at most one per harvest, about 1 per 4.1 on average.
- **Contention: wait-and-claim, newcomer first, then first come first served.** `startHarvest` on a regrowing or claimed tree no longer throws. It queues `Pending.Harvest`, and the player waits on the adjacent tile.
  - On the tick a tree ripens, the waiters claim it in this order: newcomers first (`p.state === Alive && p.respawnTick > T`, true only during first-spawn grace, because after a death `respawnTick ≤ T` once you are alive), and among newcomers the higher `stickSearch` first, then earliest `lastInputTick`, then `s.order`. Newcomers sharing a tree therefore do not rotate: the one nearest a stick finishes first.
  - Newcomer priority ends when you find your stick or attack, or at insert + 290 (2:54). That covers the busy 5th ripening (275–282) only if you tap the chip within about 5 s of spawning.
  - Any input while waiting resets your `lastInputTick`, so it moves you behind waiters of the same rank.
  - The chip picks the tree with the soonest claim for you: max(ripening tick, your arrival tick) plus 55 ticks for each waiter who would claim before you (read from the public player rows: `pending`, `pendingId`, `respawnTick`, `stickSearch`, `lastInputTick`), then nearest, then lowest id. This spreads newcomers across trees.
  - While Waiting, the chip (and the gateway for `state.goal`) re-ranks every tick and re-targets when another tree now gives a claim at least 55 ticks sooner. Newcomers who spawn on the same tick all pick the gold tree at first, then spread out on the next ticks.
  - It shows "Waiting: ripe in N s" and never promises a place: a tree just claimed is 55 ticks (33 s) away, plus 33 s for each waiter ahead of you.
  - Work is done only for waiting players, on the tick their tree ripens.
- **Safety: one Safe badge.** The ring, first-spawn grace and respawn grace show as one "Safe" badge on the HP bar.
  - The ring: x and z both in 23–27 (25 tiles).
  - Respawn grace: 10 ticks after a death (`tick < respawnTick + 10`).
  - First-spawn grace: `respawnTick = now + 290` when the player row is first inserted (not on reconnect), so the same rule gives 300 ticks (3:00). The first meter find sets `respawnTick = T` (`phaseHarvest`, only while `respawnTick > T`): the same rule then gives exactly 10 ticks (6 s) to wield and step back, and newcomer priority ends at once. You are safe until you are armed.
  - Attacking ends any grace: an accepted `attack` sets `respawnTick = 0`, which ends first-spawn grace, respawn grace and newcomer priority. A rejected attack changes nothing.
  - A stick picked up from the ground completes step 1 but does not end first-spawn grace; grace ends only at a meter find, an attack or insert + 300.
  - Grace covers the whole stick search, so a hit (which clears `pending` via `interrupt()`) cannot cost a newcomer their place in line or their bag before they are armed.
- **Bound.** Saturated, the island yields 6 harvests per 55 ticks (about 11 a minute), and newcomers take them first.
  - k newcomers arriving together, each at their own tree, finish by tick 5 + 55·max(5, ⌈5k/6⌉) at worst: **k ≤ 6 all by 2:48**; the 7th needs a 6th ripening (3:21 at best), and by then their priority has ended.
  - Sustained, the promise holds for **up to about 2.2 newcomers a minute** (5 harvests each; about 2.7 at average luck). Hourly churn at 30 online is about 0.5 a minute, which fits. A launch of 10 agents at once does not: the 7th to 10th finish after 3:00.
- **Acceptance test** (sim, newcomers follow `state.goal`; "done" = a stick found and wielded):
  - (a) 10 gather bots saturating all 6 trees, 1 newcomer: done before tick 300.
  - (b) 10 bots, 3 of them with the combat grant attacking the nearest attackable player, 1 newcomer: done before tick 300.
  - (c) 6 newcomers inserted on the same tick among the bots of (a): all done before tick 300.

## 3. Decisions (owner, recorded)

| # | Question | Decision | Where it lands |
|---|---|---|---|
| 1 | Persistent identity for returning browsers | Yes, in the future | Future F1 (the gate) |
| 2 | XP skills after the gate | Yes, in the future | Future F2 |
| 3 | Safe ring of radius 2 plus 10-tick respawn grace, with the blueberry tree outside it | Yes, now | M1 |
| 4 | Keep the full-bag drop on death | Yes | Unchanged through M3 |
| 5 | Humans-vs-agents tally | No: there is no reliable proof of personhood. Every mechanic that separates humans from agents for scoring or rewards is removed. | Everywhere (§1.4) |
| 6 | Future PvE Giant open to players without the combat grant | Yes, in the future | Future F3 |

Owner direction: the base is very simple, easy to understand, and meaningful in the first 3 minutes. Sticks are the first meaningful reward and are not easy.

**Open questions (new):**
1. **A training dummy in the ring, so a solo player can land a first hit?** *Default: no in M1. Yes if more than 50% of sessions start with ≤1 other combat player online.*
2. **First-spawn grace length?** *Default: until your first meter find (plus 10 ticks to wield) or 3:00, whichever comes first; attacking ends it.*
3. **More than 6 newcomers at once (an agent launch) overrun 3:00. Accept, or add a fallback?** *Default: accept in M1 and watch the time-to-stick metric; the M2 Bloom speeds regrow for every tree, which raises the saturated harvest rate.*
4. **Stick meter knobs: `STICK_DROP_CHANCE` 10% and `STICK_GUARANTEE_HARVESTS` 5?** *Default: 10% and 5 (quiet 0:34, busy near-worst 2:48). If the median quiet time-to-stick passes 1:00 or players leave during the meter, drop the guarantee to 4 first (quiet 0:26, busy worst 2:15), then raise the chance.*

## 4. Progression model

**World goal and gear now. Identity, then skills, in the future.**

| Layer | Ships in | Survives death? | Why |
|---|---|---|---|
| First Day chip and the stick meter | M1 | Yes (state plus a remembered done set; the meter's count is on the player row) | Direction and a first earned reward in the first 3 minutes |
| The Beacon | M2 | World-level | A solo goal, open to every player; a 1-hour guest still leaves a mark |
| Gear: stone club | M3 | No, it drops | Real power with real risk; equal starts |
| Persistent identity, then skills, titles and the bank | Future | Account | Only worth building once a returning player keeps their identity |

Why no XP now:
- Guest identities expire every hour (`lifetimeSeconds: 3600`), so a level ladder would reset each visit.
- Gating any harvest behind a level would turn time played into power. Goldberry out-heals every weapon.

## 5. Milestones

Codes: never reuse a shipped code (EventKind 0–7, Pending 0–2); a new one takes the next free number when it merges.

### M1 "The first 3 minutes" (one appended column)

What a new player sees in M1: movement and camera; the goal chip and its stick meter; the stick-find banner; ripe/regrowing trees and the harvest bar; "Waiting: ripe in N s"; the quick bar and wield toggle; eating (heal value, cooldown, full-HP block, the delay to your next swing); HP and the Safe badge; death drops the bag and ground pickup; attack/follow/stop; 4 berry heal values. Queue priority is invisible.

- **Schema:** `player.stickSearch: t.u8().default(0)`, appended last. An append-only migration with a default, but like the `weapon` column the Maincloud publish needs `--yes=remote,skip-login,break-clients` with `--delete-data=never`, followed immediately by the Worker/static deploy (`docs/CLOUDFLARE_BETA.md`). Run `stdb:generate` and `beta:types`.
- **Stick meter:** `STICK_DROP_CHANCE` 0.25 → 0.10; new `STICK_GUARANTEE_HARVESTS = 5`; `harvestFindsStick(roll, harvestsWithoutStick)` in `shared/sim` (§2).
  - `phaseHarvest` draws `ctx.random` on every HarvestDone as today. If the harvester holds a stick (bag or wielded), nothing else happens. Otherwise, on a find: grant the stick, set `stickSearch = 0`, and if `respawnTick > T` (first-spawn grace) set `respawnTick = T` (10 more ticks of grace, priority ends). Otherwise `stickSearch += 1`.
- **Stick slot:** `addItem` puts a weapon in the first empty quick slot (1–3). If all three are full, it takes quick slot 3 and moves that stack to the first free bag slot (overflow to the ground as today); if slot 3 already holds a weapon, the new one goes to the bag as today. This applies to finds and to ground pickups.
- **Safe ring:** `SAFE_RADIUS = 2`, a Chebyshev ring around `SPAWN_TILE` (x and z both in 23–27).
  - `attack` is rejected if either side is inside the ring.
  - `phaseSwings` lands no damage if either side is inside it, so an attacker who chases into the ring cannot hit someone just outside.
  - The blueberry tree (30,25) and the gold tree (20,30) stay outside. The gold tree's nearest tile (21,29) is 1 tick from the ring edge, so fights lost at the gold tree end in retreats into the ring. Accepted.
- **Grace:** a player is untargetable while `tick < respawnTick + 10`.
  - New characters: `respawnTick = now + 290` when the row is first inserted, never on reconnect (3:00). The first meter find sets it to `T` (above). An accepted `attack` sets it to 0, ending any grace and newcomer priority.
  - A ground-picked stick does not touch `respawnTick`.
  - The client shows the Safe badge while the ring or grace applies. The respawn timer UI stays keyed on `state = Dead`.
- **Wait-and-claim:** `startHarvest` queues on a regrowing or claimed tree instead of throwing. A pre-pass at the start of `phaseMovement`, before any `resolvePending`, resolves every tree that ripens this tick among its adjacent waiters (a walker arriving that tick joins the same ordering): newcomers first, and among newcomers the higher `stickSearch` first, then earliest `lastInputTick`, then `s.order`. `resolvePending` keeps `Pending.Harvest` when the claim fails instead of clearing it.
- **Goal chip:** `GatherShortcut` becomes `GoalChip`.
  - One line; tapping performs the step. On a gather step it goes to the tree with the soonest claim for you (§2). While Waiting, the chip (and the gateway for `state.goal`) re-ranks every tick and re-targets when another tree now gives a claim at least 55 ticks sooner.
  - Steps come from one shared pure function in `shared/sim/goals.ts`, using state only: a stick in the bag or wielded, `player.stickSearch`, `player.weapon === 'stick'`, a goldberry in the bag, the combat grant, plus a remembered "done" set. (`combat_event` is an event table, so nothing is stored and a reload loses past events.)
  - The done set lives in `localStorage` per identity (wrapped in try/catch), so eating a berry or losing the stick never un-completes a step. If storage is empty it re-derives, and the worst outcome is a repeated step.
  - After First Day, if you hold no stick (a death drop), the chip shows the meter again: "Find a sturdy stick — gather berries n/5".
- **Stick find:** the banner "You found a sturdy stick! Press <key> to wield — hits twice as hard" (touch: "Tap it in your quick bar"), a short CSS sparkle on the stick's quick-bar slot, and the existing "+ Stick" float.
- **CombatHud:** while hostile and HP < 15, the hint becomes "Tap <best berry> (<key>) to heal +N". (`GatherShortcut` and the chip are hidden while hostile, so the hint cannot live on the chip.)
- **Copy to update:** the Help panel ("Harvesting a berry tree can turn up a stick"; the gather step "Open your bag, select a berry, then Eat") and the LoadingScreen tip ("Harvesting can turn up a stick") must describe the meter ("Every harvest searches for a sturdy stick; the 5th harvest without one always finds one") and the quick bar.
- **Art:** a sand ring decal (one mesh, no texture), the Safe badge, the sparkle and stick tooltips. No new models.
- **Agent API:**
  - `state.goal {id, text, progress, total, hint}` comes from the same `goals.ts` (progress `n/5` on step 1); the done set lives in the gateway session.
  - `harvest` may return `waiting {treeId, ripeInTicks}`.
  - Document the stick meter, the ring and grace in `agent.md`.
- **Tests (`server-reducers.test.ts` plus a new sim test):**
  - `harvestFindsStick`: counter 0–3 finds only when `roll < 0.10` (roll = 0.10 is not a find); counter 4 always finds.
  - `phaseHarvest`: the counter rises by 1 per stick-less harvest, resets to 0 on a find, the 5th stick-less harvest always finds one, and the counter survives death; while holding a stick the counter does not move and nothing is found; one `ctx.random` draw per harvest, draw count unchanged against the fixture (expected stick outcomes updated).
  - A stick found with quick slots 1–3 full lands in slot 3 and the displaced stack moves to the first free bag slot.
  - Attack is rejected, and no damage lands, when either side is in the ring.
  - Respawn grace ends at +10 ticks; a new character is protected until insert + 300 ticks; the first meter find sets `respawnTick = T`, so grace ends 10 ticks later and priority at once; an accepted attack clears any grace; a ground-picked stick and a find during respawn grace change nothing; a reconnect does not reset first-spawn grace.
  - Waiters: a newcomer beats a veteran; among newcomers, the higher `stickSearch` wins; then earliest `lastInputTick`, then `s.order`; a walker arriving on the ripening tick does not beat a waiter of the same rank.
  - The §2 acceptance scenarios (a), (b) and (c).
  - `mobile-check.mjs` passes with the chip at 320×568.
- **Not in M1:** crafting, new items, NPCs, currencies, balance changes beyond the stick meter. The eat cooldown stays at 3 everywhere, in every milestone.

### M2 "The Beacon" (one new verb: feed)

- **Schema** (appended, with defaults):
  - `tree.kind u8 = 0` (0 berry, 1 driftwood; tide rock is added in M3).
  - `world_project(id u32 PK, projectId string, x, z, fuel u16, bloomUntilTick u32, lastFedBy string)`: public.
- **Seeding:** the tick seeds missing node ids (101+) when `tree.count() < NODE_SEEDS.length`. Idempotent, no version column.
- **Driftwood** (`shared/sim/nodes.ts`): 8 piles, 2–3 tiles in from the coast, each blocking its tile with a 1-tile gap to the next. Harvest 4, regrow 25, yields 1 driftwood (about 28 a minute world-wide). Driftwood harvests do not advance the stick meter; only berry trees search for sticks.
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
- **Stone club** = 1 stick + 2 flint, 8 damage, one-handed. Instant, works anywhere, rejected while dead or hostile. When you hold the inputs, a **"Make club"** button appears on the chip. Crafting uses up your stick; the meter finds the next one.
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
| `stick` *(existing)* | Sturdy stick | The stick meter, only for players without a stick: 10% a berry harvest, always on the 5th without one (about 1 per 4.1 harvests); death-drop piles | 6 dmg / 4 t = 2.50 HP/s | M1 meter |
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
- **M1:** a stick doubles your damage against a punch, which is why it is earned. Berries are the tempo trade: heal now or swing now.
- **Eating is a delay, not a stalemate.** Blueberries against a stick net +0.28 HP/s, and a stack of 10 lasts about 18 s. Goldberry out-heals every weapon, but it comes from one tree (about 1.8 a minute), so it is the natural hill to hold.
- **M3:** a club kills in 4 hits instead of 5.

## 7. Balance and economy

- **World output per minute:**

  | Berries | Goldberries | Sticks | Driftwood | Flint |
  |---|---|---|---|---|
  | about 11 (about 14 in Bloom) | about 1.8 | at most about 2.7, only players without a stick find them (1 per 4.1 of their berry harvests on average: about the same as today's plain 25% roll (without the earlier draft's carry-none rule); the meter changes how finds are spread out and removes the free first stick, not the total supply) | about 28 (M2) | about 9 (M3) |

- **Faucets are node items only.** Nothing is minted from nothing. The stick meter is the only per-player guarantee: one stick guaranteed within 5 of your own harvests, never more than one per harvest, and none while you hold one. Sticks are not Beacon fuel, so the meter cannot fuel the Bloom.
- **Sinks:**
  - Death drops (ground piles last 500 ticks).
  - Beacon fuel (driftwood, M2).
  - Crafting (M3).
- **Per-player caps that matter:**
  - The existing `MAX_INPUTS_PER_TICK` 5.
  - The agent API's 1 request a second.
  - One tree claim at a time.
  - The stick meter: on average 1 stick per 4.1 of your own harvests, at most 1 per harvest, none while you hold one; luck never beats your own harvest rate.
  - No other caps are needed because nothing is scored or minted.
- **Knobs to tune first:**
  - The stick meter: `STICK_DROP_CHANCE` 10% and `STICK_GUARANTEE_HARVESTS` 5 (open question 4).
  - First-spawn grace: until the first meter find (plus 10 ticks) or 3:00.
  - The Bloom threshold of 60 driftwood.
  - Bloom length of 1000 ticks.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Veterans camp trees and new players starve | Wait-and-claim, newcomer first; the §2 acceptance scenarios include armed bots |
| The meter grind feels slow (66% of players need all 5 harvests; busy near-worst 2:48) | Visible n/5 progress and a celebrated find; knobs: guarantee 5 → 4 first, then the chance; watch time-to-stick (open question 4) |
| More than 6 newcomers at once (e.g. an agent launch) | Bounded by saturated supply, 6 harvests per 55 ticks; the 7th and later finish after 3:00; watch time-to-stick (open question 3) |
| Throwaway characters use grace or newcomer priority to take harvests | New identities are free in beta, so this is bounded, not prevented: priority ends at the first stick, an attack or 2:54, grace at 3:00; the worst case is a throwaway taking up to 4 protected goldberries (untargetable, priority harvests at the gold tree before the guaranteed 5th ends its grace) and dropping them for a main; one harvester per tree. Optional mitigation: newcomer priority does not apply at the gold tree |
| Stick farming (die, drop, re-find; spares to hand out) | The meter caps finds at your own harvest rate: about 1 per 4.1 harvests, at most 1 per harvest; holders find none, so no spares build up; sticks are not fuel; the stick stacks to 1 |
| Reusing `respawnTick` for new-character grace confuses the client | Respawn UI keyed on `state = Dead`; fall back to an appended `graceUntilTick` column |
| The `stickSearch` column breaks connected clients on publish | Same path as `weapon`: `break-clients` with `--delete-data=never`, then the Worker/static deploy right away |
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
