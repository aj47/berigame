# Content roadmap: runway first

The overseer's content plan from week 2 of the Agent Studio run (`AGENT_STUDIO.md`, "Content: the overseer's main job"). One drop a week, each shipped closed and opened as an event. Week 1 runs 2026-11-07 to 2026-11-14, and week n starts 2026-11-07 plus 7(n−1) days. When this file and the code disagree, the code wins: fix this file.

## 1. Why runway comes first

On Nov 5 all six agents had all 27 landmarks and all 6 biomes in about 30 minutes, and Opus beat all three bosses (the Giant, Clatterhorn, the Sunken Spire) 17 minutes after that became the goal. The target in `AGENT_STUDIO.md` is a new boss that takes the best seat 2+ days to first clear and an endgame that takes weeks. So the order below puts new things to beat ahead of everything else, and the sinks for today's boss loot ride along with them.

The order is a guess. The week-1 baseline (2026-11-07 to 2026-11-14) replaces it: section 5 says which reading moves which item.

## 2. Rules every drop follows

- **Owner decisions stand** (`ROADMAP.md` §4). The ones content touches most: the full bag drops on death (4); no rule or reward depends on human or agent (5); levels never buy damage, HP or area access (F2); the Spire knockout, not death, is the precedent for a bag-safe loss (20). A design that needs one changed gets a needs-you card and waits; other content keeps shipping.
- **New power comes only from items you earn and can lose.** Power recipes stay at Crafting level 1 (`nodes.ts`: "only non-power recipes are gated") and take no level-gated input. Tier materials (glowcap and up) and season goods can go into cosmetics and conveniences, not into damage or HP.
- **Sinks ship with or before the faucets they balance.** Every new material ships with at least one repeatable recipe that burns it. A drop that mints coins ships with a coin sink in the same deploy.
- **Boss loot gets a daily cap.** Boss rewards ignore the energy meter (`ECONOMY.md` §1 touches gathering only), so a 24/7 seat can collect them all day. Every new boss pays materials for at most a set number of qualifying defeats per character per UTC day, then XP and the keepsake only. It is the same rule for everyone, like the orders' 60-coin cap and the ledger's three commissions.
- **Everything ships closed.** Each boss gets an open switch in owner config, added additively (a new table or row, never a dropped or renamed column), and opens with an announced time.
- **Keepsake bits are nearly gone.** `player_cosmetic.unlocked` is a u32 and bits 0–29 are taken (`skills.ts`); 30 and 31 are left. The week-2 and week-3 drops can use them. From week 4 a second mask needs an additive table first.
- **Arenas move tier nodes.** `season.ts` placement skips boss no-PvP zones. A new zone over placed tier nodes shifts placement in that biome, so each arena is drawn on tiles with no node, and `season.test.ts` and `expanse.test.ts` must still pass with the published counts.
- **The gate is the one in `AGENT_STUDIO.md`.** Simulation in `shared/sim/` with tests, a fairness validator for any pattern boss, the load test for anything a crowd gathers at, and the 2-hour A/B soak.

## 3. Today's faucets and sinks (from code)

These are ceilings for one character that never stops, computed from the constants. The week-1 observatory numbers replace them.

| Item | Faucets per day | Repeatable sinks | Gap |
|---|---|---|---|
| `obsidian` | Outcrops ~1,870 world-wide (2 nodes, 158-tick cycle); Giant raids 6 per qualifier, 72 raids: ≤432 per character | Spire key 3 per member per run; Shard Circlet 2 (once, it is a keepsake) | One raider's 432 keys 144 runs; balance depends on how many characters run the Spire, and each key also needs a gleamshell |
| `gleamshell` | Clatterhorn 2 per qualifier, ~17 defeats an hour: ≤816 per character | Spire key 1 per member per run (≤360 at 15 runs an hour) | Mints 2 for every 1 the Spire burns |
| `prism_shard` | Spire clear 1 per qualifier: ≤360 per character | Shard Circlet 5, once | No repeatable sink |
| `berry_goldberry` | Goldberry tree ~1.8 a minute; Clatterhorn 2; Spire 4 per clear (≤60 an hour); garden ≤12 | Eating | Boss goldberries feed the 20+ goldberry carrier problem |
| `ledger_seal` | 5 per character | Star Iron Helm 20, Tidewright's Medallion 40, once each | The sinks run out after ~12 days of seals |
| Coins | Steward quests 190 once (18 quests); orders 10 each, ≤60 per character | Deed 20; land tax 30/60/100 a week; upgrades 100 and 250; challenge deposit (half back on failure); specialization switch 20, 50 early | A max-tier landholder on full orders mints ~420 a week and burns 100 |

## 4. The order

| Week (starts) | Item | Metric it moves | Prediction |
|---|---|---|---|
| 2 (11-14) | First biome boss (design in `BOSSES.md`): **Glimmerfen** | Content runway; boss first-clear attempts | Best seat needs 10–50 attempts and 2+ days to first clear; exhaustion under 20% |
| 3 (11-21) | Heroic Spire tier (heroic keys) | Boss win rates; faucet vs sink for gleamshell and prism shards | Spire with 4 players stays 50–70% on normal and drops to 20–40% on heroic; prism shards gain their first repeatable sink |
| 4 (11-28) | Second biome boss: **Sunscorch Dunes** | Content runway; gear and goal depth | A second material and 3+ live goals per seat |
| 5 (12-05) | World boss at **Starfall Crater** (Starfall Reach's boss slot) | Content runway; boss win rates | Cannot be cleared by fewer than ~8 players; the best seat's first clear waits for a crowd |
| 6 (12-12) | Endgame item line v1, with coin sinks v2 (crafting fees, repairs) | Gear and goal depth; coin supply growth; time past level 30 | 3+ live goals per seat; coin supply growth under 10% a week |
| 7 (12-19) | PvP ladder and seasonal arena | Kill share of the top killer; repeat kills; safe-ring stall time | Top killer under 35%; repeat kills under 10%; stalls under 60 s median |
| 8 (12-26) | Biome boss: **Frostpine Heights** | Content runway | Same attempt target as week 2 |
| 9 (01-02) | Biome boss: **Hearthvale** | Content runway | Same attempt target as week 2 |

Long-term coin sinks are not one drop. Stage 1 (entry costs) ships with week 2, stage 2 (crafting fees and repairs) with week 6, and stage 3 (arena entry) with week 7.

## 5. What would reorder it

| Week-1 reading | Move |
|---|---|
| Gleamshell or prism shard faucet over sink by more than 20% | Heroic Spire stays at week 3, since it is their sink. If both are within 20%, the Dunes boss moves to week 3 and heroic to week 4 |
| Spire with 4 players over 70%, or the best seat clears Clatterhorn in under 10 attempts | Heroic Spire stays at week 3, and Clatterhorn and Spire HP go up through `configure_bosses` as daily tuning |
| Coin supply growth over 10% a week | Coin sinks stage 2 leaves week 6 and ships as daily balance changes in week 3, ahead of any new coin faucet |
| Agent value per online hour over 50% of a human's | No new boss ships until daily caps are retrofitted to Clatterhorn, the Spire and the Giant. The world boss (contribution split) slips a week |
| Top killer over 35% of kills, repeat kills over 10%, newcomer deaths up, or safe-ring stalls over 60 s | The PvP ladder moves to week 4 (once `kill_log` is in), and weeks 4–6 slip one each |
| Fewer than 3 live goals per seat | The endgame item line swaps with the world boss (weeks 5 and 6), as long as two biome materials exist |
| A 20+ goldberry carrier wins over 75% of even fights | No new drop pays goldberries or heals; the endgame line gets no food |
| Top 10% of characters hold over 50% of wealth | Sinks that scale with holdings (land tiers, fees on the costliest recipes) come before the next faucet |
| The Glimmerfen boss falls in under 10 attempts | The Dunes boss gets an extra staging week; heroic Spire moves to week 4 to fill the slot |

## 6. Items

### Week 2: first biome boss (design in `BOSSES.md`)

A boss in Glimmerfen with its own mechanic and its own material, built in the Clatterhorn pattern: a design section, an integer simulation, a fairness validator, a staging playtest, then deploy closed and open as an event. Another dev is designing it now; this file only sets its slot and budget.

- **Metric:** content runway and first-clear attempts. Prediction: 10–50 attempts and 2+ days for the best seat.
- **Faucets:** its material, about 2 per qualifying helper per defeat, capped at 4 paid defeats per character per day (≤8 a day each, roughly 50–100 a day across the cast and active humans). Fighting XP and a keepsake on bit 30. No goldberries.
- **Sinks:** at least one repeatable recipe that burns the new material from launch. The entry or summon cost burns today's surpluses, gleamshell and obsidian, plus coins (coin sinks stage 1).
- **Dependencies:** bit 30; an open switch in owner config; an arena on Glimmerfen tiles with no placed tier node.
- **Constraints:** death in the arena is an ordinary overworld death (decision 4) unless the design uses the Spire knockout precedent. Any recipe that adds power takes no glowcap or coral.

### Week 3: heroic Spire tier

A harder Shardmother run behind a heroic key, with new bullet patterns, more HP and a rarer drop. It reuses the Spire's floor, scheduler and validator, so it is the cheapest week of new runway, and it gives gleamshell and prism shards the repeatable sink they lack.

- **Metric:** Spire win rate by party size, and faucet vs sink for gleamshell and prism shards. Prediction: heroic with 4 players clears 20–40%; prism shard sink reaches at least half its faucet.
- **Faucets:** a heroic-only material at about 1 per qualifier per clear, capped at 3 paid clears per character per day. A keepsake on bit 31.
- **Sinks:** the heroic key: one `spire_key` plus about 2 `prism_shard` and 1 `gleamshell`, spent at the start. Refunds follow decision 21.
- **Dependencies:** every new pattern passes the exhaustive validator (`spireValidate.ts`, the 46,464-instance pattern); `SPIRE_RULES_VERSION` bumps; a heroic open switch.
- **Constraints:** HP 0 stays a knockout (decision 20). Rewards stay non-power.

### Week 4: Sunscorch Dunes boss

The second biome boss. The Dunes have no ledger clerk, two landmarks, and one pass through the Redwall (Redwall Gap, 122,190), which suits a boss whose mechanic works a chokepoint. The Oasis has a waystone and a drop box, so corpse runs stay short and field deposits stay risky.

- **Metric:** content runway; gear and goal depth. Prediction: a second boss material, and seats pursuing 3+ goals.
- **Faucets:** a second material on the week-2 budget (≤8 per character per day). A keepsake from the second cosmetic mask.
- **Sinks:** a repeatable recipe that burns it from launch, plus an entry cost in coins.
- **Dependencies:** the second cosmetic mask (additive table); the same arena rule.
- **Constraints:** as week 2.

### Week 5: world boss at Starfall Crater

A boss that needs many players at once, so agents and humans have to cooperate. It sleeps on a schedule like the Giant (decision 14), wakes a few times a day at announced UTC times, and scales HP with the players present. Rewards are equal shares above a contribution threshold, like the Giant. It sits at Starfall Crater ("Bring friends"), the smallest and emptiest biome (3,967 land tiles, one landmark), and it takes Starfall Reach's biome-boss slot.

- **Metric:** content runway; boss win rates. Prediction: unbeatable under ~8 players; a few clears a day with a crowd.
- **Faucets:** a world-boss material, about 3 per qualifier per raid at 3 raids a day (≤9 per character per day); Fighting XP; a keepsake.
- **Sinks:** none of its own beyond the endgame line. The material is held, not used, until week 6, so the cap keeps the stockpile small: under ~60 per character.
- **Dependencies:** the load test with a crowd at one spot (`docs/LOAD_TEST.md`). The beta gateway resets at about 100–190 agents, so the HP curve has to cap well below that crowd.
- **Constraints:** no top-damage bonus (decision 13). The schedule comes from the reducer timestamp, so it grants no power from time played.

### Week 6: endgame item line v1, and coin sinks stage 2

The first items that add power past level 30, crafted from boss materials: Glimmerfen's, the Dunes', the world boss's and the heroic Spire drop. They are bag items, drop on death, and light the load glow, so holding power means carrying risk and banking matters.

- **Metric:** gear and goal depth; coin supply growth; PvP first-swing win rate. Prediction: 3+ live goals per seat, coin growth under 10% a week, first-swing win rate still 50–60%.
- **Power budget:** on 30 HP the iron club (9) kills in 4 swings, and a 10-damage weapon would kill in 3. No new weapon goes above 9. New power comes from other axes within today's ceilings, for example max HP up to the settlement maximum of 36, or less damage taken. One axis per item.
- **Faucets:** the items themselves, at a few a week per active character, bounded by the boss caps on their inputs.
- **Sinks:** boss materials; a coin crafting fee of roughly 50–150 per item; repairs. Slots are `{ itemId, quantity }` with no durability, so wear needs a worn variant id or an additive table, and the item line's design picks one. Ground piles that expire after 500 ticks burn items too.
- **Dependencies:** at least two biome materials (weeks 2 and 4); the world-boss and heroic materials; coin fees debited from the frontier profile through `money()` with a `fee:<recipe>` reason, so `coinReasons` in `adminStats.ts` reports them. The kit exemption in `carriedValue` (the first copy of a weapon is not counted) must not hide these items.
- **Constraints:** recipes at Crafting level 1 with no level-gated input (F2). Losable on death (decision 4).

### Week 7: PvP ladder and seasonal arena

A seasonal ranking that gives fighting a goal beyond loot. It is fed by an opt-in arena and by open-world kills, discounted for repeat kills. A season lasts four weeks and pays keepsakes and titles, never power.

- **Metric:** top killer's share, repeat kills, safe-ring stall time, newcomer deaths. Prediction: hunters move into the arena; open-world newcomer deaths do not rise.
- **Faucets:** season keepsakes. No materials and no coins beyond a small prize.
- **Sinks:** an arena entry fee in coins (coin sinks stage 3). Part of the fee goes into a prize pot, which is a transfer; the rest is burned.
- **Dependencies:** the `kill_log` table proposed for weeks 2–3; without it, repeat kills and first-swing rate are estimates.
- **Constraints:** if arena defeats keep the bag, that leans on decision 20's knockout precedent and needs AJ's sign-off as a needs-you card. Open-world death stays full-bag (decision 4).

### Weeks 8 and 9: Frostpine Heights, then Hearthvale

The last two biome bosses, on the week-2 budget and pattern. Frostpine is the nearest biome (Kingsgate is 123 steps from spawn) on the King's Road, the island's main road exit. It waits until the ladder has shown where hunters go, so a boss crowd does not land on the newcomers' first mainland road blind. Hearthvale holds Crossroads, the main market town and clerk, and goes last so weeks 1–8 of traffic show whether a boss zone near it is safe.

- **Faucets and sinks:** a material each, capped as in week 2, feeding endgame line v2.
- **Dependencies:** the second cosmetic mask; an arena clear of tier nodes; Hearthvale's arena kept off Crossroads' clerk, drop box and waystone.

## 7. Why Glimmerfen goes first

- **It is the only mainland biome with nothing of its own.** It shares tier 2 (glowcap, coral) with Hearthvale (`TIER_BIOMES`), and has one landmark, Fenhold. Frostpine has three, Hearthvale two, the Dunes two. A boss gives it its own material and a reason to go there.
- **Its material meets the most characters.** Tier 2 is the level-30 band, where a player is after about 5 hours. That is the band where the Long Season runs thin on goals.
- **The risk loop is already built.** Fenhold has a clerk, a drop box (31,181) and a waystone (30,186). A defeat respawns nearby, and loot can be banked in the field with risk, so the new material is carried and contested.
- **It is close but off the main road.** Fenhold is 161 steps from spawn, against 192 for Crossroads and 254 for the Oasis, so the opening event fills fast. The Fenway is the island's second exit, so the crowd stays off the King's Road where newcomers first cross.
- **The ground gives a new mechanic.** Glimmer Water, four fen lakes and two boardwalks give water and narrow crossings to build on, unlike Clatterhorn's open glade and the Spire's sealed floor.
- **Starfall Reach is kept for the world boss**, which matches the Crater's "Bring friends".
