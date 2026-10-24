# The Long Season

Content for a crowded world that people play every day. The target is 2000
players on one server, each able to make real progress for 8 hours a day,
every day, for a month. When this file and the code disagree, the code wins:
fix this file.

| Area | File |
|---|---|
| Tier nodes, season items, placement | `shared/sim/season.ts` |
| Node kinds, level gate, season recipes, connectivity repair | `shared/sim/nodes.ts` |
| Level curve to 99, season cosmetics | `shared/sim/skills.ts` |
| Daily ledger rules | `shared/sim/ledger.ts` |
| Server | `spacetimedb/src/reducers/harvest.ts` (gate), `reducers/tick.ts` (claim gate, seeding), `reducers/ledger.ts`, `lib/progress.ts` (Paragon Sash) |
| Pacing and placement tests | `shared/sim/__tests__/season.test.ts`, `season-server.test.ts`, `ledger-server.test.ts` |

## 1. What was wrong

- Skills capped at level 30, which takes about 5 hours (`skills.test.ts`). A
  player playing 8 hours a day was done on day one.
- The island had 83 nodes, and each serves one harvester at a time. The 47
  berry nodes are saturated by about 10 foragers. 2000 players would each get
  one harvest every few minutes.
- Nothing asked a player to come back tomorrow except the energy meter's
  rested bonus.

## 2. Levels to 99

The curve to 30 is unchanged (`25·(L−1)²`, L30 = 21,025). Past 30:

```
xp(L) = 21 025 + 1450·(L−30) + A·(L−30)^2.5     A chosen so xp(99) = 3,000,000
```

| Level | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 99 |
|---|---|---|---|---|---|---|---|---|
| Total XP | 21k | 59k | 180k | 423k | 816k | 1.38M | 2.14M | 3.00M |

No step past the knee is cheaper than level 30 was, and none is over 4% of
the climb, so no single level stalls for days. The last level costs about
105k XP. The cap fits a u32 column 1400 times over. Existing XP is kept
exactly: everyone at 30 starts climbing again.

The harvest speed perk is unchanged: −1 tick at L10, −2 at L20, never below 3.

## 3. Tier nodes

There are ten new node kinds (`tree.kind` 4–13), two per tier: a Foraging
plant inland and a Beachcombing find on the shore. Each needs a level in its
skill. The server rejects a harvest below that level
(`nodeLevelRejection`), and the tick never claims a node for an under-level
waiter.

| Tier | Level | Foraging | Beachcombing | Ticks (harvest / regrow) | XP | XP per harvest second | Where (biome) |
|---|---|---|---|---|---|---|---|
| — | 1 | berry tree | driftwood, tide rock | 5/50, 4/25, 6/40 | 8, 6, 10 | 2.5–2.8 | Grove and Coast |
| 1 | 15 | wild honey hive → honeycomb | oyster bed → pearl | 6 / 8 | 14 | 3.9 | Bramblewild's Coast, 17+ tiles from spawn |
| 2 | 30 | glowcap ring → glowcap | coral shelf → coral | 7 / 9 | 21 | 5.0 | Hearthvale and Glimmerfen |
| 3 | 45 | sunpeach tree → sunpeach | amber seam → amber | 8 / 10 | 29 | 6.0 | Sunscorch Dunes |
| 4 | 60 | starblossom → starpetal | moonstone vein → moonstone | 9 / 11 | 40 | 7.4 | Frostpine Heights |
| 5 | 80 | dreamvine → dreamplum | fallen star → star iron | 10 / 12 | 54 | 9.0 | Starfall Reach |

- **Energy is untouched.** Every second of harvest still spends one point, so
  a higher tier levels faster without paying out more gathering. The rules in
  `ECONOMY.md` apply unchanged.
- **Levels never buy strength.** No season item is a weapon. The two edible
  fruits heal 4, less than a blueberry. Recipe outputs neither heal nor hit
  (`season.test.ts`).
- **Placement** is one deterministic pass shared by the server and every
  client:
  - It walks the Coast tiles of each tier's biomes (`TIER_BIOMES`, biomes from
    `expanse.ts` `biomeOf`) in a fixed hashed order. Tier 1 also stays 17
    tiles from spawn, outside the Grove's first ring. See `WORLD.md`.
  - It skips tiles within 2 of a trail, within 4 of a landmark, in a boss zone
    or the glade clearing, or within 3 of a drop box or waystone.
  - Tier nodes keep a gap of 2 from each other, 3 from the hand-placed trees
    and nodes, and 2 from scenery.
  - Kinds in a tier take turns choosing tiles. Each prefers its own ground
    (shore or inland) and uses the other only when its own runs out.
  - A flood fill then drops any node that walls off walkable land. The
    survivors keep their ids. Each kind owns a block of 1000 ids from 1000.
    Never reorder `TIER_NODES` or reuse an id.
- **1028 tier nodes** are placed, every one of `TIER_NODES[].count` (1111
  nodes and trees in all, against 83 before).
  - Per kind: 64 honey hives, 64 oyster beds, 120 glowcap rings (60 in
    Hearthvale, 60 in Glimmerfen), 120 coral shelves (58 and 62), 110 sunpeach
    trees, 110 amber seams, 120 starblossoms, 120 moonstone veins, 100
    dreamvines and 100 fallen stars.
  - Each tier lives in its own biomes, farther down the road each time, so a
    crowd spreads across the Expanse as it levels.

### Server cost

- Seeding used to cost 2 primary-key finds per seed per tick. It now reads the
  tree map the tick already loads: no extra finds (`season-server.test.ts`).
- The tick's single `tree.iter()` and blocked set grow from 83 rows to 1111.
  The static blockers (forest, ridges, stones) are keyed once
  (`social.ts` `staticBlockedKeys`), so only the nodes are added per tick.
- The client mounts non-berry nodes only near the local player.

## 4. Season goods

Crafting XP per make is half the gathering XP of the raw materials it uses.
That keeps Crafting at the average pace of the two gathering skills. Each
good is an input to the next tier or a ledger request (`season.test.ts`).

| Level | Make | From |
|---|---|---|
| 12 | Beeswax Candle | 2 honeycomb, 1 driftwood |
| 15 | Pearl Charm | 2 pearl, 1 flint |
| 20 | Pearl Strand (keepsake) | 6 pearl, 1 driftwood |
| 28 | Glowcap Lantern | 2 glowcap, 1 candle, 1 driftwood |
| 32 | Coral Totem | 3 coral, 1 pearl charm |
| 42 | Sunpeach Preserves | 3 sunpeach, 1 honeycomb |
| 46 | Amber Inlay | 3 amber, 1 coral totem |
| 50 | Amber Amulet (keepsake) | 4 amber, 2 pearl charms |
| 58 | Starpetal Incense | 3 starpetal, 1 lantern |
| 62 | Moonstone Lens | 3 moonstone, 1 amber inlay |
| 78 | Dream Tonic | 3 dreamplum, 1 incense |
| 82 | Star Iron Ingot | 3 star iron, 1 moonstone lens |
| 85 | Star Iron Helm (keepsake) | 3 ingots, 20 ledger seals |
| 95 | Tidewright's Medallion (keepsake) | 2 ingots, 2 tonics, 10 pearl, 40 ledger seals |

Keepsakes (cosmetics 16–29; bits 30 and 31 are still free):

- Skill milestones at 30, 60 and 99 in each skill: Glowcap Cap, Coral
  Circlet, Artisan's Kerchief, Starpetal Garland, Moonstone Torc, Artisan's
  Goggles, Dreamvine Crown, Starfall Diadem and Master's Laurel.
- The four made keepsakes above.
- The Paragon Sash, for reaching 99 in every skill.

## 5. The Island Ledger

Each character gets three commissions per UTC day, handed in within 3 tiles
of any of four clerks (`LEDGER_CLERKS`): the Sunberry Market (35, 37),
Crossroads (172, 124), Kingsgate (146, 25) and Fenhold (34, 182). All four
take the same commissions.

- **The draw.** It is a pure function of identity, day and skill levels
  (`ledgerFor`), so the server, the HUD and the agent API agree without
  storing a list. Each slot leans to one of the top four commissions
  unlocked in its skill.
- **The reward.** About twice the gathering XP the goods are worth, paid to
  the commission's skill, plus one ledger seal. The third hand-in adds two
  more seals: 5 a day.
- **Seals.** They come only from the ledger, and the two seal keepsakes need
  60 between them, about 12 full days. Seals are bag items, so they can be
  traded.
- **Storage.**
  - Each record is `{ id, day, done }` in `frontier_private`, kind `ledger`.
  - The owner sees it through `frontier_view`, source `ledger:<hex>`, in the
    same way as the energy meter.
  - A missing row means nothing has been handed in yet.
  - The schema did not change and no row-level-security filter was added.
- **Where it shows.** The new reducer is `deliver_commission(slot)`. The
  menu has a Ledger panel, the Skills panel shows the next unlock for each
  skill, and the agent API and WebMCP expose both.
- **Carrying risk.** Goods walked to a clerk are bag items, so the load
  glow and drop-on-defeat apply on the way.

## 6. Pacing

`season.test.ts` simulates a player on 8-hour days with the energy meter:

- 16 hours away fill the meter.
- Half of each session is spent harvesting, alternating 30 minutes per
  gathering skill at the best node unlocked.
- Everything gathered is crafted.
- The ledger is finished every day.

There is no contention in the simulation, so this is the fastest honest pace;
a crowd is slower.

| | Day 1 | Day 30 | Every skill at 99 |
|---|---|---|---|
| Lowest skill level | about 35 | 80–98 (asserted) | 40–100 days (asserted); about 45 at this pace |

At least one level is gained somewhere on every one of the first 30 days. In
practice regrow waits, travel and contention stretch the cap to roughly two
months, and the seal keepsakes add a separate daily track.

## 7. Capacity for 2000 players

**What the content supports.**

- A node keeps one harvester busy for harvest / (harvest + regrow) of the
  time. Summed over the 1028 tier nodes, that is about 457 players harvesting
  at once (27 per tier-1 kind, 52 per tier-2 kind, 49, 54 and 45 for tiers
  3–5), plus about 9 on the 83 original nodes and trees.
- A player harvests about half the time, so about 930 gatherers can work
  without queueing. Low levels share the original nodes plus 128 tier-1 nodes.
- The other activities have no shared supply limit:
  - crafting
  - ledger runs
  - gardens (real-time)
  - trading
  - PvP
  - Clatterhorn (credit for up to 120 challengers)
  - the Sunken Spire (up to 32 parties of 4 if the owner raises `spireMaxRuns`)
  - the Meadows' 94 patches
- So about a quarter of 2000 can gather at any moment and everyone else has
  something to do.

**What the content cannot change.**

- `MAX_ONLINE_PLAYERS` is 2048 per world (`shared/sim/admission.ts`), raised from 256 with the scaling work in `docs/LOAD_TEST.md`.
- The beta's gateway Durable Object has reset at about 100–190 agents.
- 2000 on one server therefore needs infrastructure work that is not in this
  change:
  - raising the admission cap;
  - load-testing the 600 ms tick with 2000 player rows. Movement is cheaper
    than it was: walks aim A* at the goal and reuse the planned route between
    ticks (`pathfinding.ts` `routePath`), but a fresh spawn-to-Crater search
    still costs about 7–14 ms in Node;
  - sharding subscriptions;
  - fixing the gateway.
- Until then, 2000 players means about 8 worlds of 250, and this content
  supports each of them comfortably.

**Space.** The world is 256 × 256 with 35,813 land tiles: 9,318 on the
original island and 3,967 to 7,169 in each mainland biome. Tier 2–5 nodes sit
about one per 29 land tiles of their biomes (900 on 26,495), so each biome could take more
nodes before packing gets tight. More capacity now means raising
`TIER_NODES[].count`, not more land. See `WORLD.md`.
