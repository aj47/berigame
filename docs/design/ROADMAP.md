# BeriGame roadmap: items, progression and goals (M1 to M4)

Status: design only. This plan assumes the stance-removal change has shipped: every swing hits, punch 3, stick 6, swing every 4 ticks, `MAX_HP` 30, melee range 1.
It merges three proposals (skills, goals, mvp) and two judge reviews. The mvp sequencing is the spine. Ideas from the other two are grafted onto it.

---

## 1. Vision and pillars

*"The first island": a cheerful, low-poly tropical brawler with a readable 600 ms tick, where humans and AI agents gather, build and fight side by side.*

1. **Equal starts.** Combat power comes from preparation (weapon, shield, food, position), never from time played.
2. **Two ways to play, both complete.** Every goal has a gatherer route. Agents default to gather-only, so PvP is always an optional branch.
3. **Session-sized, world-persistent.** A beta character lasts at most 3600 s, so a visit is built as a one-hour arc, and the world remembers what players did (Beacon, chronicle).
4. **Mobile-first and tappable.** No new toolbar buttons. Progress shows as one goal chip, toasts and tabs inside existing panels.
5. **Cheap tick.** No new per-tick movers before M5. All state is lazy, dirty-only, and lives outside the `player` row.
6. **Carved driftwood and berry juice.** Props are code primitives sharing one material, and icons use the existing prompt pack.

## 2. Core progression model (decision)

**Gear and goals now. XP skills after the persistence gate.**

| Layer | Ships in | Persists through | Why |
|---|---|---|---|
| Craftable gear ladder (weapon, shield, food) | M2 | nothing, it drops on death | Real power with real risk, consistent with the equal-start pillar |
| Quest and aim progress (`quest_progress`) | M3 | death (separate table) | Gives direction and a record, and needs no identity continuity to be useful |
| World goals (Beacon, chronicle, Warden) | M3–M4 | characters and guest churn | A 1-hour guest still leaves a mark |
| XP skills, bank, titles, dyes | after the gate | account | Only worth building once a returning player keeps their identity |

Why no XP in M1–M4:
- Guest identities expire every hour (`worker.ts` `lifetimeSeconds: 3600`), so a level ladder would reset each visit.
- Any gated harvest (for example, goldberry behind a level) would turn time played into combat power, because goldberry at 4.17 HP/s out-heals every weapon.

Completed quests are recorded from M3 onward. Once identities persist, titles and unlocks are **granted retroactively** from those records, so nothing is wasted.

**Post-gate skills sketch (for planning only):**
- **Skills:** Foraging, Beachcombing (includes fishing), Crafting.
- **XP curve:** `xpForLevel(L) = 25·(L−1)²`, giving L5 = 400, L10 = 2 025, L20 = 9 025 and a first-island cap of L30 = 21 025. At about 70 XP a minute, reaching 30 takes roughly 5 hours per skill.
- **What levels unlock:** recipes and rare drops (heartwood, dyes) and harvest speed (−1 tick at L10 and L20, never below 3).
- **What levels never unlock:** damage, HP or access to the goldberry tree.

## 3. The next items (in unlock order)

All numbers assume the M1 balance: `EAT_COOLDOWN_TICKS` = 4 and swing interval = 4 ticks (2.4 s).
- Item ids are permanent.
- Materials stack to 99 (`MAX_STACK`).
- Each item gets a 128 px icon at `frontend/public/items/<id>.png`.

| # | id | Name | Source | Recipe | Stats | Purpose | M |
|---|---|---|---|---|---|---|---|
| 1 | `palm_frond` | Palm Frond | Palm node, 2 per harvest | – | material; Beacon fuel 1 | Cord input | M2 |
| 2 | `palm_cord` | Palm Cord | Craft | 2 frond → 1 | material | Binder in every gear recipe | M2 |
| 3 | `driftwood` | Driftwood | Driftwood pile (coast) | – | material; fuel 2 | Sticks, shield, Beacon | M2 |
| 4 | `stick` *(existing)* | Stick | 25% bush bonus, **plus a new recipe** | `whittle_stick`: 2 driftwood → 1 | 6 dmg / 4 t = 2.50 HP/s; fuel 3 | A guaranteed first weapon (world supply goes from 2.7 to about 14 per minute) | M2 |
| 5 | `coconut` | Coconut | 15% palm bonus | – | food, heals 6 (2.50 HP/s) | Mid-tier food that needs no station | M2 |
| 6 | `flint` | Flint Shard | Tide rock (4 corners only) | – | material | The **contested** gear input, which pulls fights to the edges | M2 |
| 7 | `stone_club` | Stone Club | Craft | 1 stick + 1 flint + 1 cord | 8 dmg / 4 t, reach 1, one-handed = 3.33 HP/s | Tier-2 melee that pairs with a shield | M2 |
| 8 | `driftwood_shield` | Driftwood Shield | Craft | 4 driftwood + 2 cord | offhand; armor 2 (minimum 1 damage per hit); allows Brace from M4 | Defence; the key-art shield | M2 |
| 9 | `flint_spear` | Flint Spear | Craft | 1 stick + 2 flint + 2 cord | 7 dmg / 4 t, **reach 2**, two-handed = 2.92 HP/s | Opening strike; gives up the shield slot | M2 |
| 10 | `seashell` | Seashell | 10% driftwood bonus, 5% fishing bonus, aim rewards | – | currency-like material | Requests escrow, Maro's shop, later bank fees | M3 |
| 11 | `fishing_line` | Fishing Line | Craft, or Maro for 6 shells | 1 stick + 2 cord | tool; must be in the bag to fish | Unlocks fishing spots | M3 |
| 12 | `raw_fish` | Raw Fish | Fishing spot | – | food, heals 2 | Grill input | M3 |
| 13 | `grilled_fish` | Grilled Fish | Grill at a **Lit** Beacon | 1 raw fish → 1 | food, heals 5 (2.08 HP/s) | Repeatable blueberry-tier food and a reason to keep the Beacon lit | M3 |

**Post-gate tier (reserved ids):**
- `heartwood`: 2% driftwood bonus at Beachcombing 15.
- `heartwood_club`: 10 dmg / 5 t = 3.33 HP/s; slow and telegraphed, so it is the natural target for Brace.
- `dye_blue|red|green|gold`: 10 berries each, gives a robe colour unlock.
- `woven_basket`: death insurance, needs reconsideration (§7).

**Cut from the source proposals:**
- `berry_jam` at 11 HP: 4.58 HP/s beats every weapon.
- The 5-damage driftwood spear: lower DPS than its own stick input.
- `heavy_branch`: about one per 17 minutes worldwide; nobody sees it.
- Minted bounty goldberries: a faucet for the best food.

**Combat matrix** (30 HP target, no eating; time to kill counted from the first hit):

| Weapon | HP/s | Hits / TTK | Vs shield (armor 2) |
|---|---|---|---|
| Punch 3 | 1.25 | 10 / 21.6 s | 1 dmg, 30 hits |
| Stick 6 | 2.50 | 5 / 9.6 s | 4 dmg, 8 hits (1.67 HP/s) |
| Flint spear 7 | 2.92 | 5 / 9.6 s | 5 dmg, 6 hits (2.08 HP/s) |
| Stone club 8 | 3.33 | 4 / 7.2 s | 6 dmg, 5 hits (2.50 HP/s) |

**Food ladder at a 4-tick eat:** greenberry 0.83, raw fish 0.83, strawberry 1.25, blueberry 2.08, grilled fish 2.08, coconut 2.50, goldberry 4.17 HP/s.

What the ladders mean in a fight:
- A stick now beats blueberry sustain.
- A shield plus blueberries out-sustains a stick.
- A club breaks a shield plus blueberries.
- Goldberry beats everything, but it comes from one tree (about 1 a minute), so it is the king-of-the-hill prize.

## 4. Goals

### 4.1 First-session chain: "Washed Ashore" (M3; the M1 chip previews steps 2–5)

**Quest giver:** Old Maro, a static NPC at (23,23) inside the safe ring (§5 M1). He is the grey-bearded hermit from the fan art.
- Talk works from Chebyshev ≤ 2, so a crowd of newcomers cannot body-block him.
- Every step is advanced by hooks that already fire: harvest done, eat, pickup, wield, craft, contribute, hit.

| # | Chip text | Completes when | Teaches | Reward |
|---|---|---|---|---|
| 1 | Speak to Old Maro by the fire | `talk(maro)` | Tapping NPCs; the safe ring | – |
| 2 | Gather 3 berries | 3 HarvestDone events for self | Gather shortcut, tree cooldowns | +1 greenberry |
| 3 | Eat a berry from your quick bar | Eat event for self | Quick bar and healing | – |
| 4 | Get a stick (harvest, pickup, or whittle driftwood) | A stick is in the bag | Bonus drops, the coast, crafting | **Pity:** after 4 stick-less harvests, Maro offers one (`ask_stick`, once per character) |
| 5 | Wield the stick | `wield('stick')` | 3 vs 6 damage | – |
| 6 | Tie palm cord | Craft `palm_cord` | Palms, crafting | 1 coconut |
| 7 | Feed the Beacon | Contribute ≥ 3 fuel | Shared world project | Name on the Beacon list, +2 seashells |
| 8 | Choose your path | **Islander:** craft a driftwood shield or harvest a goldberry · **Brawler:** land 3 hits on a combat-enabled player | Risk vs. preparation | 1 goldberry, chronicle line "X washed ashore and became an Islander/Brawler", 3 seashells; title granted once the persistence gate lands |

- **Target time:** 10–15 minutes with 5–10 players online.
- **Gather-only agents:** always take the Islander branch.
- **Follow-up chain "Armed and Ready":** take flint from a tide rock → craft a club or spear → carry a shield → catch and grill a fish.

### 4.2 Recurring aims (M4)

**Visit aims.** Each player gets 3 aims per hour.
- Aim index = `hash(identity, floor((tick − startedTick)/6000))` over a pool of about 15.
- Anchoring to the character's first `quest_progress.startedTick` means a guest always gets a full hour and never straddles a boundary.
- The picker is pure (no `ctx.random`), so client, server and agents all compute the same aims.
- Rewards: 3 shells per aim, plus a 5-shell bonus for all three.
- Combat aims (for example "land 15 hits") are only drawn for players who hold the combat grant.

**Island aim, per Tide.** A Tide is `floor(tick/6000)`, computed rather than stored.
- The goal is to keep the Beacon Lit for ≥ 45 of 60 minutes.
- Decay is 5 fuel a minute, so this takes steady work from 2–3 gatherers.
- On success, every contributor that Tide gets +2 shells.

**Gold Warden (king of the hill).**
- Harvesting the gold tree twice in a row without dying takes the crown.
- The crown is lost on death, or when someone else takes it.
- Holding it requires the combat grant, so the crown can always be fought over.
- Holding it at a Tide boundary earns a chronicle line.

### 4.3 Long-term aims

- **Beacon Blaze** (≥ 80 fuel): a group push that triggers the Goldberry Bloom, where berry regrow drops from 50 to 38 ticks for 1000 ticks.
- **Chronicle records:** first goldberry of a Tide, most fuel contributed in a Tide, Warden reign length.
- **Post-gate:**
  - The Raft, a staged world project (200 driftwood → 100 cord → 50 coconuts) that unlocks the volcano island.
  - Skills to level 30.
  - The Big Giant world boss.

### 4.4 Social, PvP and agent goals

- **Requests board (M4).** Players post "want N of X, pay M of Y" using item ids only; the reward is held in escrow.
  - Anyone can fulfil a request remotely.
  - Expired requests are refunded in the 10-tick sweep.
  - This gives agents a way to be quest-givers and merchants without an LLM. Limit: 3 open requests per poster.
- **Humans vs agents tally (M4).** Points come from contributions and completed aims.
  - Each player scores at most 20 points per Tide.
  - The comparison is the **average per participant**, so an agent fleet cannot swamp it.
  - Each Tide result goes into the chronicle.
- **Gifts:** food you drop that someone else picks up (`ground_item.droppedBy`, not `droppedOnDeath`) counts toward the "share 3 gifts" visit aim.
- **PvP:** the Warden crown, brace mind-games (M4), and combat aims. None of these is ever required.
- **Agents:** all quests and aims use structured option ids and expose a `hint.action` field, so an agent polling once a second can complete everything except the Brawler branch.

## 5. Milestones

Reserved codes, all append-only, **locked in M1** as comments in `shared/sim/types.ts`, whatever the ship order:
- **EventKind:** 8 Craft · 9 Contribute · 10 Block · 11 ProjectMilestone · 12 LevelUp (post-gate)
- **Pending:** 3 Talk · 4 Contribute · 5 Station (grill)
- **NodeKind:** 0 berry · 1 palm · 2 driftwood · 3 tide rock · 4 fishing spot

### M1 "Why am I here?" (no schema change)

- **Balance:**
  - `EAT_COOLDOWN_TICKS` 3 → 4.
  - `ItemDef` gains `kind`, `description` (the #27 tooltips), `swingTicks?`, `reach?`, `armor?`, `twoHanded?`, `toolFor?` and `fuel?`.
  - New helpers `swingTicksOf`, `reachOf` and `armorOf` replace the global `SWING_INTERVAL_TICKS` / `MELEE_RANGE` in `phaseSwings` and in the approach logic.
  - The existing stick gets `description`.
- **Safe ring:**
  - Add `SAFE_RADIUS = 2`, a Chebyshev ring around (25,25) covering tiles 23–27.
  - `attack` is rejected if either side is inside the ring.
  - `phaseSwings` lands no damage on a defender inside the ring.
- **Respawn grace:** a player is untargetable while `tick < respawnTick + 10`, using the existing column. Attacking ends the grace early.
- **Loot refactor:** replace `harvestFindsStick` with `rollNodeLoot(kind, itemId, roll)`, which uses **one** `ctx.random` draw over cumulative ranges. The berry-bush stick stays at `roll < 0.25`, so behaviour is byte-identical.
- **UI:**
  - `GatherShortcut` becomes **GoalChip**, a single line showing "Next: …" and progress (for example 3/7).
  - Tapping the chip performs the step.
  - Starter steps are derived from inventory, `player.weapon` and events: harvest → eat → stick → wield → 3 berries in the quick bar → all 4 berry kinds.
  - The chip's final step forks: 10 hits (combat grant) or 20 berries (gather-only).
  - Draw a sand ring decal (one mesh, no texture).
- **Agent API:** add `state.goal {id,text,progress,total,hint}`, computed with the same shared function as the chip (one source of truth, in `shared/sim/goals.ts`). Confirm that the stance removal already delivered wield/unwield parity.
- **Art:** ring decal; tooltips in `Inventory.tsx`. No new models.
- **Tests (`server-reducers.test.ts`):**
  - An attack inside the ring is rejected, and no damage lands on a defender inside it.
  - Grace ends at +10 ticks.
  - The eat cooldown is 4.
  - The `rollNodeLoot` draw count is unchanged against the current fixture.
  - `mobile-check.mjs` passes with the chip at 320×568.

### M2 "The Coast" (nodes, crafting, gear ladder)

- **Schema** (appended, with defaults):
  - `tree.kind u8 = 0`.
  - `world.contentVersion u16 = 0`. The tick calls `seedContent` whenever the version is below `CONTENT_VERSION`; seeding is idempotent and upserts by node id (101+). The world row is written every tick anyway.
  - `player.offhand string = ''`. It is public so other clients can render the shield.
- **Nodes** (`shared/sim/nodes.ts`, `NODE_KINDS[kind] = {harvestTicks, regrowTicks, yieldQty, loot[], toolReq?}`). Every node blocks its tile and keeps a 1-tile gap from the next.

  | Kind | Count, placement | Harvest | Regrow | Yield | Bonus (single draw) | World rate |
  |---|---|---|---|---|---|---|
  | Palm | 6 in the empty ring (tiles 8–12 / 38–42) | 5 | 30 | 2 frond | 15% coconut | about 34 fronds a minute |
  | Driftwood | 8, 2–3 tiles in from the coast | 4 | 25 | 1 driftwood | 10% seashell (M3) | about 28 a minute |
  | Tide rock | 4, one near each corner | 6 | 40 | 1 flint | – | about 9 a minute |

- **Reducers:**
  - `craft(recipeId, times 1–10)` is instant and works anywhere except station recipes. It is rejected while dead or hostile. It consumes the exact inputs, calls `giveItem` (overflow drops to the ground) and emits Craft=8.
  - `wield` routes by `kind`: shields go to `offhand`, and a two-handed weapon clears `offhand`.
  - The offhand obeys the same rules as the weapon: it must be in the quick bar, and it is put away if moved, dropped or lost on death.
  - The `harvest` reducer checks `toolReq`.
- **Tick:** `phaseHarvest` reads the harvest and regrow ticks from the node kind. `phaseSwings` uses reach, swing ticks, and `max(1, dmg − armorOf(offhand))`.
- **UI:**
  - The Bag panel gets **Bag | Craft** tabs. Craft lists recipes with input icons, greys out what you can't make, and offers Make 1 / Make 5.
  - `ClickDropdown` gets Chop / Gather / Mine labels.
  - The chip moves on to a "Coast list": driftwood → 2 fronds → cord → flint → club/spear → shield.
- **Art:**
  - 8 icons.
  - `ResourceNode.tsx` switches on kind, using one shared vertex-colour material: a palm (curved cylinder, 5 plane fronds, 2 spheres), driftwood (3 instanced cylinders) and a tide rock (flat-shaded dodecahedron).
  - Club: the stick with a lashed dodecahedron head.
  - Spear: a long cylinder with a cone tip, using the **BlockCounter** clip as its jab.
  - Shield: a disc with a torus rim on the left-hand bone. The **Block** clip plays as the hit reaction while a shield is equipped.
  - The **GrabReady/Grab** clips are used for gathering driftwood and fronds.
  - Budget: +4 geometries, 0 textures.
- **Agent API:**
  - `harvest {nodeId?|kind?}` (default: the nearest ready node the agent can harvest).
  - `craft {recipe,times}`.
  - `wield` accepts shields.
  - State: `trees` becomes `nodes` (with `kind`; the `trees` alias is kept for one release), plus `self.offhand`, `players[].offhand`, and `recipes[] {id,inputs,output,canCraft,missing}`.
  - Update `agent.md` and WebMCP, then run `stdb:generate` and `beta:types`.
- **Tests:**
  - `seedContent` run twice is a no-op, and a v0 fixture upgrades to v1.
  - Per-kind harvest and regrow ticks.
  - Craft input and overflow handling.
  - Spear hits at distance 2 but not 3.
  - Armor minimum of 1.
  - A two-handed weapon clears the offhand.
  - BFS reachability over the whole grid with all nodes placed.
  - `smoke.ts` crafts a club end to end through the agent API.

### M3 "The Hearth" (Maro, the quest chain, the Beacon, fishing)

- **Schema** (new tables, free to add):
  - `npc(id u32 PK, kind u8, x, z, name)`: public and static.
  - `quest_progress(id u64 PK, owner idx, questId string, step u8, count u16, startedTick u32, doneTick u32)`: **private**, using the same visibility filter as `inventory_slot`.
  - `world_project(id u32 PK, projectId string, x, z, fuel u16, fuelTick u32, state u8, eventUntilTick u32, litTicks u32, tide u32, holder option<identity>)`: public.
  - `project_contribution(id, projectId, owner idx, tide u32, amount u16)`.
  - `chronicle(id u64 autoInc, tick, kind u8, actor identity, actorName string, itemId string, value u32)`: keeps the last 200 rows and is rendered **from kind templates**, never from stored prose.
  - `seedContent` v2 adds Maro, the Beacon at (27,27) (it blocks its tile, inside the ring) and 4 fishing spots on edge tiles at the middle of each side (harvest 6, regrow 30, about 11 fish a minute).
- **Beacon:**
  - Lazy fuel: `fuel_now = max(0, fuel − floor((tick − fuelTick)/20))`, which is 5 per minute (1 per 12 s) and needs **zero per-tick writes**.
  - States: Lit ≥ 10, Blaze ≥ 80. Crossing into Blaze sets `eventUntilTick` for the Goldberry Bloom.
  - `litTicks` is updated lazily on each write and at the Tide boundary.
  - Fuel values: stick 3, driftwood 2, frond 1, any berry 1, coconut 1.
- **Reducers:**
  - `talk(npcId, optionId)` via `Pending.Talk`. Options: `hello`, `ask_stick`, `shop_line` (6 shells → a fishing line), `hand_over`.
  - `contribute(projectId, slot, qty)` via `Pending.Contribute`, within reach 1. It emits Contribute=9, plus ProjectMilestone=11 when a state changes.
  - Grilling uses `Pending.Station` (pendingId = the recipe index in the append-only `RECIPES` list) and needs a Lit Beacon.
  - `questBump(ctx, owner, key, n)` is called from the existing hooks and touches only the owner's active rows.
- **UI:**
  - Maro is tappable, with a menu of fixed options.
  - The chip follows the Washed Ashore chain.
  - Toasts come from diffing private `quest_progress` rows, **not** from `combat_event`.
  - Tapping the Beacon opens a Beacon panel (fuel bar, state, top contributors, Contribute button).
  - The Help panel gains an "Island news" tab showing the chronicle.
- **Art:**
  - Maro uses the adventurer rig with an appended grey hair/beard index (marked NPC-only) and grey robes, so no new material.
  - The Beacon: a log-pile primitive with 3 emissive cones whose scale follows the fuel state; no lights and no particles.
  - Fishing spot: an animated ripple ring.
  - The Grab clip loops while grilling.
  - 4 icons: seashell, fishing line, raw fish, grilled fish.
- **Agent API:**
  - Actions: `talk {npcId,optionId}`, `contribute {projectId,slot,qty}`, `craft` (also handles station recipes).
  - State: `npcs`, `quests[] {id,step,text,hint}`, `projects`, and `chronicle` (last 20, flagged as untrusted text).
- **Tests:**
  - A walkthrough of the whole chain.
  - The pity stick is given exactly once.
  - Lazy decay at boundary ticks.
  - The Blaze threshold and bloom end tick.
  - `quest_progress` is invisible to other clients (0 rows).
  - Chronicle trimming.
  - Grilling is refused when the Beacon is Cold.

### M4 "Hold Your Ground" (brace, Tides, Requests, Warden) and the persistence gate

- **Schema:**
  - Append `player.braceUntilTick u32 = 0`. The brace cooldown is derived from it, so no second column is needed.
  - New table `request(id, poster, wantItem, wantQty u8, rewardItem, rewardQty u8, expiresTick)`: public.
  - New table `tide_tally(tide u32, side u8, points u32)`.
  - Aims and the Warden streak are stored as `quest_progress` rows. The crown is the `world_project('gold_crown').holder`.
- **Brace** (tuned per review so it cannot turtle):
  - Requires a shield in the offhand.
  - `braceUntilTick = tick + 2`, and the bracer's own next swing is pushed back 2 ticks.
  - Cooldown: 12 ticks from the start, which means at most 1 in 3 of a 4-tick attacker's swings.
  - The first hit that lands during the brace deals 0 damage, pushes the attacker's next swing back 2 ticks, and emits Block=10.
  - Both columns involved are public, so the counter-play is to see the raised shield and hold or eat instead of swinging. That brings back the "read your opponent" pillar without any twitch timing.
- **Reducers:** `brace`, `request_post`, `request_fulfil`, `request_cancel` (escrow uses `removeFromSlot` / `giveItem`; the refund runs in the expiry sweep).
- **Tick:** only the Tide boundary adds work: once per 6000 ticks it closes the tally, awards the island aim and writes the chronicle entries.
- **UI:**
  - The combat strip shows a Brace button, with a cooldown ring, whenever a shield is in the quick bar. At 320 px it replaces Stop during combat.
  - The Bag panel gets a **Goals** tab: the 3 aims, the chain, and the Requests board.
  - The Beacon panel shows the Tide timer and the tally.
  - A crown icon appears on the Warden's nameplate.
- **Art:** the **Guard** clip for the brace hold, the **Block** clip for the brace impact, the reused `stance-guard` icon for the Brace button, and a crown primitive on the nameplate.
- **Agent API:**
  - Actions: `brace`, `request_post|fulfil|cancel`.
  - State: `aims`, `tide`, `requests`, `self.braceUntilTick`, `players[].braceUntilTick`, `warden`.
- **Tests:**
  - Brace absorbs exactly one hit and staggers the attacker by 2.
  - The 12-tick brace cooldown is enforced.
  - Escrow round trip: fulfil, expire and refund, with no item duplication.
  - The aim hash is deterministic.
  - The tally applies the per-player cap.
  - The crown is only held by combat-enabled players.
- **GATE (owner decision, before anything post-M4):** returning browsers keep their identity (a scoped token in localStorage, reused across the 1-hour grant renewals). Only then do skills, the bank at Maro (#30), titles, dyes, the heartwood tier, the Raft and the Giant follow.

## 6. Balance notes and economy sinks

- **World output per minute:**

  | Berries | Fronds | Driftwood | Flint | Fish | Sticks (bush) | Sticks (whittled) |
  |---|---|---|---|---|---|---|
  | about 11 | about 34 | about 28 | about 9 | about 11 | about 2.7 | up to about 14 |

  Flint is the bottleneck on purpose. It sits at the corners, far from spawn.
- **Sinks, ordered by volume:**
  1. Death drops (gear is lost; ground piles last 500 ticks).
  2. Crafting consumption.
  3. Beacon fuel: about 300 fuel an hour just to stay Lit, and it burns sticks, which lowers violence.
  4. Grilling.
  5. Requests escrow.
  6. Maro's shell shop.
  7. Post-gate: dyes and bank fees.
- **Faucets are items only.** Shells are the only thing minted from nothing (aims, Warden), and they buy tools and cosmetics, never food or damage.
- **u8 caps:** damage stays ≤ 10 and slot quantities ≤ 99. `fuel` is u16, clamped at 255 to keep the flame scale bounded.
- **Bag pressure is low** with 99-stacks across 28 slots. That is acceptable, because crafting and the Beacon drain materials. Revisit if hoarding appears.
- **Knobs to tune first:**
  - The 4-tick eat cooldown.
  - Shield armor 2.
  - Grilled fish heal 5 (not 7).
  - The fishing-spot regrow of 30.
  - Beacon decay of 1 per 20 ticks.
  - The brace window of 2 and cooldown of 12.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Guests last an hour, so long goals go unseen | M1–M4 fit within one visit or persist at world level; the gate comes before skills, bank and unlocks |
| Tree contention with 30+ players stalls onboarding step 2 | Ship M2's coastal nodes before any marketing push; the pity stick; the whittle recipe |
| A reach-2 spear snipes harvesters (damage interrupts the harvest) | Movement is 2 tiles a tick, so reach buys only one opening swing; the spear gives up the shield; the spawn ring is safe |
| Agent fleets dominate tallies and projects | Per-player caps of 20 points per Tide, scoring by per-capita average, and the existing 1 request/s limit |
| Brace plus blueberries turtles | Brace blocks at most 1 in 3 swings; the club breaks a shield plus blueberries; tune the knobs above |
| EventKind or Pending codes collide with in-flight branches | Reserve 8–12 and 3–5 in M1 as comments; any code, once used, is never reused |
| `seedContent` bugs on the live beta | Idempotent upserts by id; a v0 fixture test; publish with `--delete-data=never`, then bump `CONTENT_VERSION` |
| Maincloud tick cost | No movers before the Giant; lazy Beacon; one write per Tide boundary; nodes are written only on claim and regrow |
| Chronicle or name injection reaching agents | Rows are template-rendered and flagged as untrusted; no LLM NPCs in M1–M4 |
| Mobile HUD overflow | The one-line chip, tabs in Bag and Help, and a Brace button that replaces Stop at 320 px |

## 8. Open questions for the owner

1. **Persistent beta identity for returning browsers?** *Default: yes, decided before M4 ships.* It unlocks skills, the bank, titles and dyes.
2. **XP skills after the gate: Foraging, Beachcombing and Crafting, capped at L30 (about 5 hours each), never giving combat stats?** *Default: yes. Brawling gives titles only.*
3. **A safe ring of radius 2 plus 10-tick respawn grace, with the blueberry tree left outside it?** *Default: yes.*
4. **Keep the full-inventory drop on death through M4, and revisit the basket and bank insurance after the gate?** *Default: yes.*
5. **Should the humans-vs-agents tally be public and in the chronicle?** *Default: yes, scored per participant with a cap, and framed as friendly rivalry.*
6. **Future PvE (the Giant): open to gather-only players, with the combat grant staying PvP-only?** *Default: yes.*
