# The world map and the Expanse

The map grew from 128 × 128 to 256 × 256 tiles. The original island keeps its
corner and five mainland biomes surround it. This file explains the layout and
why it is shaped this way. When it and the code disagree, the code wins: fix
this file.

| Area | File |
|---|---|
| Biomes, causeways, rivers, bridges, ridges, landmarks, waystones, roads | `shared/sim/expanse.ts` |
| Land field, `TERRAIN_MAP`, forest and ridge blockers, `TERRAIN_VERSION` | `shared/sim/terrain.ts` |
| Grid size (`GRID_SIZE` 256, `ISLE_SIZE` 128) | `shared/sim/constants.ts` |
| Tier placement by biome (`TIER_BIOMES`) | `shared/sim/season.ts` |
| Ledger clerks, drop boxes | `shared/sim/ledger.ts`, `shared/sim/banking.ts` |
| Respawn at the nearest waystone | `expanse.ts` `respawnPointFor`, `spacetimedb/src/reducers/tick.ts` `phaseRespawn` |
| Pathing | `shared/sim/pathfinding.ts`, `shared/sim/social.ts` |
| Client chunks | `frontend/src/Components/3D/world/chunks.ts`, `terrainChunks.ts`, `SceneryChunks.tsx` |
| Agent map | `frontend/agent-api/worldAtlas.ts` (`GET /world`) |
| Tests | `shared/sim/__tests__/expanse.test.ts` |

## 1. Size

- 256 × 256 = 65,536 tiles, 35,813 of them land.
- The original island (`biomeOf` returns `isle` for x and z below 128) has
  9,318 land tiles. It had 9,230 before. No tile was lost. The 88 new ones
  are the landings of two causeways: 63 at the Sunfall Causeway and 25 at the
  Fenway. Every published tile, node, landmark, bridge and boss zone on the
  island is where it was.
- Mainland land by biome: Frostpine Heights 7,169, Glimmerfen 5,719,
  Hearthvale 5,097, Sunscorch Dunes 4,543, Starfall Reach 3,967. A biome is
  the nearest of its lobes (`BIOME_LOBES`), so a tile's biome never depends
  on anything but its coordinates.
- The Meadows district now joins at the map's east edge
  (`MEADOW_OFFSET.x` = `GRID_SIZE`), at the end of the King's Road.
- Area rules are unchanged: the whole Expanse is Coast. A Stick gets you
  there, the Coast's combat rules apply, and there is no new key.

## 2. Biomes

| Biome | Ground and trees | Tier | Places |
|---|---|---|---|
| Bramblewild (`isle`) | The original island | 1 (honey hive, oyster bed) | Grove, Coast, Boulders, Eastreach, southern wilds |
| Frostpine Heights | Snow, snow pines, the Rimewater, the Spine | 4 (starblossom, moonstone vein) | Kingsgate, Frostmere, Rimewatch |
| Hearthvale | Farmland, broadleaf woods, the Hearthrun | 2 (glowcap ring, coral shelf) | Crossroads, Hearthvale Orchards |
| Glimmerfen | Marsh, willows, Glimmer Water, four fen lakes | 2 (glowcap ring, coral shelf) | Fenhold |
| Sunscorch Dunes | Dunes, palms, the Redwall | 3 (sunpeach tree, amber seam) | Sunscorch Oasis, Redwall Gap |
| Starfall Reach | Ash, crystal trees, the Cinder Rim, the crater lake | 5 (dreamvine, fallen star) | Starfall Crater |

## 3. Routes and chokepoints

Water carves the biomes apart and boulder ridges cut inside them, so travel
runs along a few routes instead of across open ground. The routes exist for
three reasons: they give the long road a shape players can learn, they make
places where people meet, and they slow travel to the high tiers without a
key or a wall in front of them.

**Causeways** (`CAUSEWAYS`) are the only land between landmasses.
`expanse.test.ts` cuts each one at its middle third and checks that the
detour, if any, is more than three times the direct walk.

| Causeway | Between | Why it is there |
|---|---|---|
| King's Causeway (118, 25)–(140, 25) | Island ↔ Frostpine | Continues the harbour road. The only island exit that was already a road. |
| Sunfall Causeway (113, 111)–(140, 116) | Island ↔ Hearthvale | Takes the southern wilds straight to Crossroads, the main town. |
| Fenway (26, 118)–(32, 148) | Island ↔ Glimmerfen | Mossvale's road south. The second way to tier 2. |
| Stonepass (196, 66)–(192, 100) | Frostpine ↔ Hearthvale | Closes the north loop, so Frostpine is not a dead end. |
| Dune Road (162, 150)–(140, 170) | Hearthvale ↔ Dunes | Crossroads to tier 3. |
| Reedbank (78, 196)–(92, 198) | Glimmerfen ↔ Dunes | Closes the south-west loop. |
| Ashway (156, 214)–(180, 210) | Dunes ↔ Starfall | One of two ways into tier 5. |
| Emberstair (214, 146)–(214, 172) | Hearthvale ↔ Starfall | The other way into tier 5, from the orchards. |

The routes form loops so that no single causeway decides who reaches a
biome: island, Frostpine and Hearthvale make one ring; island, Hearthvale,
the Dunes and Glimmerfen another; Hearthvale, the Dunes and Starfall a third.
Every mainland biome has at least two ways in. A group holding one causeway
makes the others busier, but cannot close a biome.

**Bridges** (`EXPANSE_BRIDGES`) are the dry crossings of three rivers: Rime
Bridge and Northford over the Rimewater in Frostpine, Hearth Bridge and
Southmill Bridge over the Hearthrun in Hearthvale, and the North and South
Boardwalks over Glimmer Water in Glimmerfen. Two per river, for the same
reason as the loops.

**Ridges** (`RIDGES`) are lines of boulder tiles (`RIDGE_TILES`, 173 tiles,
static blockers in `SCENERY_BLOCKERS`) with gaps of radius 2.6:

- **The Spine** crosses Frostpine with passes at (181, 57), on the road
  south to Stonepass, and (228, 56) in the east. It lies between the King's
  Road and Stonepass, so the walk south goes through a pass.
- **The Redwall** crosses the Dunes with one pass, Redwall Gap (122, 186).
- **The Cinder Rim** guards Starfall's northern edge with one pass at
  (214, 180), where the Emberstair comes ashore.

Ridges make routes without more water: the land stays open to look across,
and the pass is where the road goes.

**Roads** (`EXPANSE_TRAILS`, joined to `TRAILS`) run over every causeway,
bridge and pass. Tier placement keeps 2 tiles off them and forests 2.5, and
the test allows fewer than 15 blocked road tiles on the whole map (all on
the original island), so a road always walks.

## 4. Tier placement by biome

`TIER_BIOMES` puts each Long Season tier in its own biomes. `placeTierNodes`
walks the open Coast tiles of those biomes in a fixed hashed order: off the
roads, out of boss zones, 3 tiles from drop boxes and waystones, 4 from
landmarks, 2 between tier nodes. Tier 1 also stays 17 tiles from spawn.
Every node in `TIER_NODES[].count` is placed: 1028 in all.

| Tier | Biomes | Nodes | Nearest town |
|---|---|---|---|
| 1 | Bramblewild's Coast | 64 + 64 | Sunberry Market |
| 2 | Hearthvale, Glimmerfen | 120 + 120 (glowcap 60/60, coral 58/62) | Crossroads, Fenhold |
| 3 | Sunscorch Dunes | 110 + 110 | Oasis |
| 4 | Frostpine Heights | 120 + 120 | Kingsgate |
| 5 | Starfall Reach | 100 + 100 | Crater |

Placing by biome instead of by distance from spawn means each tier has a
recognisable place, the island is no longer packed with high-tier nodes, and
walk time still rises with tier. Walking distances from spawn
(`bfsPath` with both keys): Kingsgate 123 steps, Fenhold 161, Crossroads 192,
the Oasis 254, Starfall Crater 292. At two steps a tick, the Crater is about
90 seconds away. Frostpine (tier 4) is nearer spawn than the Dunes (tier 3);
its tier sits behind the level gate, not the walk.

## 5. Towns, clerks, drop boxes and waystones

| Town | Ledger clerk | Drop box | Waystone |
|---|---|---|---|
| Sunberry Market (35, 37) | yes | four Coast boxes | none (the Grove spawn (25, 25) is near) |
| Kingsgate (146, 25) | yes | (150, 27) | (148, 29) |
| Crossroads (172, 124) | yes | (170, 125) | (168, 128) |
| Fenhold (34, 182) | yes | (31, 181) | (30, 186) |
| Sunscorch Oasis (130, 206) | — | (127, 207) | (134, 210) |
| Starfall Crater (196, 220) | — | (198, 218) | (190, 224) |

- **Clerks** (`LEDGER_CLERKS`) all take the same commissions. The daily
  draw does not depend on where you stand. The agent API walks to the
  nearest clerk (`nearestLedgerClerk`).
- **Drop boxes** (`DROP_BOXES`, 9) take vault deposits over 4 ticks that a
  hit or a step stops, as on the Coast. Withdrawals stay in the safe ring.
- **Waystones** (`WAYSTONES`, 5). A defeated character comes back at the
  nearest of the Grove spawn and the waystones to where it fell, by straight
  line, ties to the spawn (`respawnPointFor`). The bag still drops where it
  fell, so the corpse run stays short on the bigger map. A waystone has no
  safe ring; the usual respawn grace covers the arrival.

## 6. Performance

- **Pathing.** A walk toward a known tile or range (`goalIsTile`,
  `goalAdjacentTo`) is an aimed goal: `bfsPath` runs A* with the Chebyshev
  distance, which never overestimates, so paths stay shortest and ties break
  the same way on the server, the client and the agent API. A spawn-to-Crater
  search takes about 7–14 ms in Node and its path is 292 steps.
  `routePath` keeps a walker's plan between ticks while the goal, its keys and
  the blocked set's fingerprint (`blockedVersion`) are unchanged, so later
  ticks only check the next two steps (the test asserts under 1 ms a tick).
- **Static blockers.** `worldBlockedSet` adds the dummy, the Giant, the
  forests, the ridges, the stones and the dais from a key list built once
  (`social.ts` `staticBlockedKeys`, 648 scenery tiles plus the rest) and then
  only the nodes.
- **Client.** The 3D world is cut into 32-tile chunks (`chunks.ts`): terrain,
  trees, ridges, props and ground cover are built per chunk and mounted only
  within a view radius of the player (terrain 150 tiles, trees 104, props 120,
  scatter 44), recomputed when the player crosses an 8-tile view cell.
- **Agent map.** `TERRAIN_MAP` is now 256 rows and about 80 KB as JSON
  (66 KB of rows, 11 KB of obstacles). `/state` still carries it as
  `world.map` in its old shape for existing clients. `GET /world` serves the
  same rows run-length encoded, a biome grid, obstacles as column ranges,
  biomes, landmarks, waystones and routes in about 30 KB. It is static per
  `TERRAIN_VERSION` and needs no session.

## 7. Rules for changing it

- Never move a published landmark, bridge, pass, waystone or causeway, and
  never take land from the original island. Agents and the wiki name them by
  id.
- A change to the land or the ridges changes `TERRAIN_VERSION`, and the tier
  placement may move nodes: check `expanse.test.ts`, the season tests and the
  node counts in `LONG_SEASON.md`.
