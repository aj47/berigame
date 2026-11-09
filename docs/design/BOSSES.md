# Bosses: Clatterhorn, the Sunken Spire and Lanternmaw

The shipped rules and numbers for the two boss fights, and the design of the
third (Lanternmaw, section 9: built, ships closed until its staging playtest).
This file is the single reference for their numbers. When it disagrees with the code, the code wins and
this file is wrong: fix it. The constants live in:

| Area | File |
|---|---|
| Geometry (glade, stones, floor, dais, gate, exit) | `shared/sim/bossZones.ts` |
| Bullets, the collision rule, the hash | `shared/sim/bullets.ts` |
| Clatterhorn's AI, lanes, swarm, telegraph, rewards | `shared/sim/clatterhorn.ts` |
| The Spire's patterns, scheduler, stars, damage, safety table | `shared/sim/spire.ts`, `shared/sim/spireValidate.ts` |
| Owner switches and live HP knobs | `shared/sim/bossConfig.ts` |
| Lanternmaw's floor, patterns, tide, fight and validator (section 9) | `shared/sim/lanternmaw.ts`, `shared/sim/lanternmawValidate.ts`, `LANTERN_FLOOR` in `bossZones.ts`, the Lanternmaw tunables in `constants.ts` |
| Items, recipes, keepsakes | `shared/sim/items.ts`, `shared/sim/nodes.ts` (`RECIPES`), `shared/sim/skills.ts` (`COSMETICS`) |
| Server | `spacetimedb/src/lib/clatterhorn.ts`, `lib/spire.ts`, `lib/spireGuards.ts`, `lib/lantern.ts`, `reducers/clatterhorn.ts`, `reducers/spire.ts`, `reducers/lantern.ts`, `reducers/bossAdmin.ts` |
| Agent feeds | `shared/sim/bossDanger.ts` (`/danger`), `shared/sim/bossPresentation.ts` (`/state` blocks) |

The design history (three candidate specs, judge verdicts, the full decision log)
is in the release's FINAL_SPEC; this file keeps only what shipped. One server tick
is 600 ms.

## 1. Release status

- **Both bosses ship closed.** With no `boss_config` row, `bossConfigOr` returns
  the defaults: `clatterhornOpen`, `spireOpen` and `spirePracticeOpen` false,
  `spireMaxRuns` 12, `spireHpBase` 1000, `spireHpPerMember` 700, `clatterHpBase` 300,
  `clatterHpPerChallenger` 200. The world owner opens them with
  `configure_bosses` (section 5).
- **Lanternmaw** (section 9) is built and ships closed: with no `lantern_config`
  row `lanternConfigOr` reads it as closed. The owner opens it with
  `configure_lanternmaw` after the staging playtest (9.11).
- **Cut from this release** (columns and enum values are kept, nothing reads or
  writes them beyond their defaults): practice runs (`mode` is always Normal,
  `spirePracticeOpen` is stored but unused), private lobbies, kick and the run
  queue (`isPublic` is always true, `queuedTick` 0, stage `Queued` never used),
  downed and revive (`downUntilTick`, `reviveSinceTick`, `downs0..3` stay 0,
  member state `Downed` never used), the Worker fast lane, the `/danger/next`
  long poll, a separate danger budget, the bullet bench and the scripted live
  check. Section 8 lists the deviations from the spec.

## 2. Clatterhorn (overworld boss)

A cart-sized stag beetle in **Clatterhorn's Glade** on the Coast. It charges the
farthest player along a telegraphed 3-wide lane. A charge that meets a standing
stone head-on flips it on its back, and every swing lands twice. It drums up a
swarm of runners with guaranteed free columns, and from phase 2 some of its spins
are Shell Slams that punish hugging its eye.

### 2.1 Arena

| Item | Value |
|---|---|
| Glade (candidates, hazards, no PvP) | `CLATTER_GLADE` x 76..92, z 98..114: 17 x 17 = 289 Coast tiles |
| Home (wake, reset, respawn) | `CLATTER_HOME` (84,106) |
| Standing stones (scenery blockers) | (78,103) (90,103) (78,109) (90,109) (81,100) (87,100) (81,112) (87,112): knight offsets from home |
| Landmark | index 16, `glade`, "Clatterhorn's Glade", access `coast` |
| Body | 3 x 3 visual body over its centre tile. It never blocks tiles; players may stand under it. |
| Valid centre | a tile whose 3 x 3 body is inside the glade and holds no stone: 153 tiles |
| Reach | Chebyshev <= 2 from its centre (`CLATTER_REACH`), from a glade tile only (`clatterCanSwingFrom`) |
| Gate | A Stick (the glade is Coast). No combat capability needed; attacking never sets `hostile`. |

The 16 forest trunks inside the glade are removed by `outerForest()`.

### 2.2 States and availability

`ClatterState`: Dormant 0, Idle 1, ChargeWindup 2, SpinWindup 3, DrumWindup 4,
Drumming 5, Recover 6, Flipped 7, Burrowed 8, Closed 9.

- **Candidates** are loaded players that are online, alive, not in grace and
  standing in the glade.
- **Dormant** at home with full HP until a candidate stands in the glade; it
  wakes on that tick (`fightCount + 1`, `engagedTick = T`).
- **Lonely reset.** Deciding with no candidate makes it Idle until `T + 100`
  (`CLATTER_LONELY_TICKS`). Still alone then: Dormant at home with full HP, and
  every credit row that is not owed is deleted.
- **Burrowed** for 300 ticks (3:00, `CLATTER_RESPAWN_TICKS`) after a defeat, then Dormant.
- **Closed** while `clatterhornOpen` is false: no AI, no rendering, no swings.
  A missing row reads as Closed; the tick inserts it only once the boss is open.
- Resets, the respawn, an owner close and an owner reopen keep `fightCount`,
  `defeats` and `owedLeft` (`clatterReturnHome`), so owed rewards are still paid.

### 2.3 HP

```
maxHp = clatterHpBase + clatterHpPerChallenger * min(challengers, 120)
      = 300 + 200 * min(challengers, 120)      // 500 with one challenger, 24,300 at the cap
```

A **challenger** is a player whose first swing of this fight landed. That swing
adds 200 to both `maxHp` and `hp` before its own damage is subtracted, so a late
crowd cannot melt the beetle.

### 2.4 Attacks

Blows land on end-of-movement tiles, during the tick the windup ends.

| Attack | Lead | Tiles hit | Damage | Afterwards |
|---|---|---|---|---|
| Charge (trample lane) | 3 ticks in every phase (`CLATTER_CHARGE_WINDUP`) | The 3 x 3 body swept from its centre to the lane end, clipped to the glade, stones excluded | 14 | The body moves to the end. Flip: Flipped. Skid or Glance: a chained charge if any are left, else Recover 2. |
| Shell Spin | 3 (`CLATTER_SPIN_WINDUP`) | Tiles at Chebyshev exactly 2 from the centre, inside the glade (16 at home). The eye (<= 1) and 3+ are safe. | 10 | Recover 2 |
| Shell Slam (a spin from phase 2) | 3 | The 3 x 3 body (Chebyshev <= 1, `clatterSlamTiles`). Ring 2 and beyond are safe. | 10 | Recover 2 |
| Drum (swarm) | 3-tick windup; the first runner reaches the glade one tick after it fires (lead 4) | Runners (section 2.5) | 5 per runner hit | Drumming 20 ticks, then Recover 2. No other attack is chosen while a swarm runs. |

**Lanes** (`clatterLane`). The lane runs in one of 8 directions for the largest
`L <= 14` (`CLATTER_MAX_LANE`) whose body positions are all valid centres. Its end
kind: **Flip** when a stone sits 2 tiles past the end on the line (the stone the
head hits), **Glance** when the next body square holds a stone, otherwise
**Skid**. A lane shorter than 2 is not used: the beetle tries the two
neighbouring directions and keeps the longer one, otherwise it spins (if
someone is near and its last attack was not a spin) or shuffles (Recover 2).

**Choosing.** Each decision, with `n = attackCount`:

1. A Drum when `CLATTER_DRUM_EVERY[phase] > 0` and `n % every == every - 1`.
2. Else a Spin when at least one candidate is within 2, the previous attack was
   not a Spin, and `n % 3 == 2` or 3+ candidates are within 2.
3. Else a Charge at the **farthest** candidate (Chebyshev; ties go to the lower
   sorted identity). With 2+ candidates the previous charge's target (`bait`) is
   skipped, so nobody is charged twice in a row.

A chained charge is published at the landing tick and does not advance
`attackCount`, so the Drum rotation stays fixed.

**Slams.** A Spin windup is a Shell Slam when the stored phase is at least 2
(`CLATTER_SLAM_PHASE`) and `mix32(fightCount, attackCount + 104729) & 1` is 1
(`clatterSlam`): about half of them. The fields are fixed for the windup, so the
server, the browser and agents agree. The telegraph's `attack` is `slam`; the
browser paints the body red and ring 2 green. Hurt notices keep source Spin.

**Flips.** Flipped lasts 7 / 6 / 5 ticks by phase (`CLATTER_FLIP_TICKS`), 4 in
frenzy. Every swing deals double damage while it is flipped. The real-map test
(`clatterhorn-dodge.test.ts`) measures: random charges flip 15.2% and glance 45.6%
of the time; every charge that happens with the target standing 1-3 tiles behind
a stone on a line from the beetle flips (248 of 248).

**Escapes** (same test, real blocked set): every charge tile escapes in at most 2
steps over 21,056 cases (median lane length 5, longest 14); every spin tile in 1
step; every slam tile in at most 2 steps, always to a ring-2 tile still in reach; every glade tile survives every one of the 12 swarm variants.

### 2.5 The swarm

`swarmSide` s in {0 N, 1 E, 2 S, 3 W} and `swarmFree` f in {0, 1, 2} come from
`mix32(fightCount, n)`. Column i = 0..16 runs along the entry edge:

| Side | Runner origin for column i (one row outside the glade) | Direction |
|---|---|---|
| N | (76 + i, 97) | (0, 1) |
| E | (93, 98 + i) | (-1, 0) |
| S | (92 - i, 115) | (0, -1) |
| W | (75, 114 - i) | (1, 0) |

- Wave A fires at the fire tick F in columns with `i % 3 == (f + 1) % 3`; wave B
  fires at F + 2 in columns with `i % 3 == (f + 2) % 3`. Columns with
  `i % 3 == f` are never used, so standing in one is always safe. A swarm has 11
  or 12 runners.
- Runners are bullets of the shared model (section 3.5) at 1 tile per tick. They
  hit only players whose start or end tile is in the glade, under the swept rule
  of section 3.6 with the canonical middle tile. At most one runner hit per
  player per tick; there are no i-frames between runner hits.
- **A player who stands still in a runner's column is hit twice by that runner**
  (as it enters the tile and as it leaves straight on), so 10 HP per runner. Over
  one swarm a stationary player on a glade tile takes 0 hits (a free column) or 2
  (`clatterSwarmHit`, all 12 variants).
- During DrumWindup the runners are already known (`clatterSwarmBullets` uses
  `stateUntilTick` as F), so the 3-tick look-ahead of `/danger` sees the first contact.

### 2.6 Phases

`clatterPhase = max(stored phase, frenzy ? 3 : 3*hp <= maxHp ? 3 : 3*hp <= 2*maxHp ? 2 : 1)`.
Frenzy starts 450 ticks (4:30) after the wake. Phases never go down.

| | P1 (HP > 2/3) | P2 (<= 2/3) | P3 (<= 1/3) | Frenzy |
|---|---|---|---|---|
| Charge lead | 3 | 3 | 3 | 3 |
| Chained charges after Skid/Glance (`CLATTER_CHAIN`) | 1 | 2 | 3 | 3 |
| Flip length | 7 | 6 | 5 | 4 |
| Spin | every 3rd action or 3+ huggers | same, about half are Slams | same | same |
| Drum (`CLATTER_DRUM_EVERY`) | every 7th action | every 5th action | every 4th action | every 4th action |

Telegraph leads never drop below 3 ticks. There is no hard enrage.

### 2.7 Swings

- `attack_clatterhorn` (no arguments) sets `Pending.Clatterhorn` (6) and walks
  you to a tile within reach 2. Re-selecting it while in reach keeps your swing
  timing. Refusals: on the Spire floor, carrying the giant berry ("Put down the
  giant berry first; it needs both hands"), closed ("The glade is quiet:
  Clatterhorn is away"), burrowed ("The beetle has burrowed away. Clatterhorn
  returns in N s").
- A swing lands every 4 ticks (`SWING_INTERVAL_TICKS`) within reach 2, from a
  glade tile only, in every state except Dormant, Burrowed and Closed. The walk
  goal is a glade tile in reach; a swinger left standing in reach outside the
  glade is walked in by the tick instead of landing hits from beyond the hazards. Damage is `combatDamage` (weapon plus
  Might, as for the Giant), doubled while Flipped. Each landed swing adds private
  credit (`clatterhorn_credit`) and sends the attacker a `YouHit` notice.
- **A landed swing ends spawn grace** (unlike the Giant), so the attacker takes
  blows and runner hits from the next tick. A due swing at a Dormant beetle also
  ends grace so the swinger wakes it.
- **Blows keep the attack loop.** Charges, spins and runners never clear
  `Pending.Clatterhorn`; other pending actions (a harvest) are interrupted. Your
  own ground click still stops swinging.
- **Re-chase.** After a charge moves the beetle, swingers left out of reach walk
  to a tile within reach (one path search each per relocation).

### 2.8 Rewards

- **Qualification** (`clatterQualifies`): credit from this fight, at least 16
  damage (`CLATTER_MIN_CONTRIBUTION`), a landed swing within 100 ticks of the
  defeat (`CLATTER_RECENT_TICKS`), loaded and online. Dead but online
  contributors qualify.
- **Defeat** (a swing takes HP to 0): qualifying credit becomes owed, the rest is
  deleted, every swinger stops, `ClatterDefeat` is emitted (`quantity` = rewardees)
  and the beetle burrows at home for 300 ticks. `owedLeft` grows by the count.
- **Payout**, 25 owed rows per tick in identity order (`CLATTER_REWARDS_PER_TICK`),
  in any state including Closed: 2 `gleamshell`, 2 `berry_goldberry` (overflow
  drops at the player's tile), 40 Fighting XP (path 3, `Feat.Protect`) and the
  Clatterhorn Horn keepsake (cosmetic 12). Reward and Keepsake notices reach only
  the player paid. Equal shares; no last-hit or top-damage bonus.

### 2.9 Edge cases

| Case | Behaviour |
|---|---|
| Grace | Players in grace are not candidates and take no blows or runner hits; their first landed swing ends grace. |
| Death | Ordinary overworld death: the bag drops in the glade, respawn at (25,25). No player can cause it (no PvP in the glade). |
| Everyone leaves | The current attack still lands; then Recover, lonely Idle, reset after 100 ticks. |
| One griefer in a corner | Never charged twice in a row while 2+ candidates stand in the glade. |
| Players outside the glade | Never candidates, never hit: every hazard is clipped to the glade. They cannot land swings either. |
| Owner close mid-fight | Closed at home, every `pending == 6` dropped, non-owed credit deleted; owed rewards keep paying. Reopening returns it Dormant at home. |

**Writes.** Closed, Dormant or Burrowed with nothing owed: none. A fight: at most
one `clatterhorn` row write per tick, one private credit write per landed swing,
one `boss_notice` per landed swing and per player hit. `boss_event` only for
wake, defeat, respawn and reset.

## 3. The Sunken Spire (bullet-hell dungeon)

A drowned tower under the inland sea east of the Giant's headland. Parties of 1-4
descend from the **Spire Gate** with one Spire key each and fight the
**Shardmother**, a crystal heart that fills a 15 x 15 glass floor with patterns.
Walking onto falling stars is the main offence. Falling to 0 HP knocks you out
to the gate with your bag untouched.

### 3.1 Architecture

- Every run shares one sealed floor (logical instancing). The floor joins the
  land mask through `terrainLand`, so server, client and agent pathing walk it
  with no new movement code, but it is never rendered as island terrain. Its
  area is `'spire'`.
- The floor is 7+ tiles from real land, so ordinary movement can never enter or
  leave it; only the Spire's reducers and the tick teleport players.
- Players never block each other, so every run uses the same 216 tiles. Bullets,
  stars and swings only touch their own run. Overworld viewers never see floor
  players; a viewer on the floor sees only its own run (`spireSeesPlayer`).

### 3.2 Gate and key

| Item | Value |
|---|---|
| Spire Gate | `SPIRE_GATE` (62,45), a scenery blocker on the Boulders' east cliff (Stone Club tier) |
| Exit (eject tile) | `SPIRE_EXIT` (61,45) |
| Gate zone (lobby, no PvP, not counted as Giant raiders) | Chebyshev <= 3 of the gate (`SPIRE_GATE_RANGE`): 28 standable tiles |
| Landmark | index 17, `spire`, "Sunken Spire Gate", access `boulders` |
| Key | `spire_key` = 3 `obsidian` + 1 `gleamshell`, Crafting level 1, 30 XP, stacks to 10. Every member holds one; each is spent when the run starts. |
| Off switch | `boss_config.spireOpen` false: "The Sunken Spire is sealed" |

### 3.3 Parties and the run lifecycle

`SpireStage`: Lobby 0, (Queued 1 reserved), Active 2, Cleared 3, Failed 4.
`SpireOutcome`: None 0, Cleared 1, Wiped 2, TimedOut 3, Abandoned 4, Closed 5, Reset 6.
`SpireMemberState`: Lobby 0, In 1, (Downed 2 reserved), Out 3, Left 4, Done 5.

Reducers (each takes `clientRules`, the caller's `SPIRE_RULES_VERSION`, except
`spire_leave`; an older client is refused with "This client is out of date;
reload the page to enter the Spire"):

| Reducer | Rule |
|---|---|
| `spire_open {clientRules}` | Opens a public lobby you lead (slot 0). Needs the Spire open, you within 3 of the gate, hands free (no giant berry), no duel, no running expedition, no live membership, a key, and fewer than 48 open lobbies (`SPIRE_MAX_LOBBIES`; else "The Spire gate is crowded; join an open party instead"). The lobby expires 150 ticks (90 s) after it opens (`SPIRE_LOBBY_TICKS`). |
| `spire_join {runId, clientRules}` | `runId = 0` quick-joins the **newest** open public lobby with a free slot and the current rules. Same gate checks plus a key. You take the lowest free slot 0..3. |
| `spire_leave {}` | In a lobby: leave (leadership passes to the lowest remaining slot; an empty lobby is deleted). In a run: forfeit (state Left, ejected, no reward). Knocked out (Out): your member row is deleted and you give up the run's reward. |
| `spire_start {clientRules}` | Leader only. Checks every member in slot order: online and alive, in Bramblewild, within 3 of the gate, holding a key, hands free, no duel, no expedition. The first failure refuses with "This party is waiting for NAME: REASON". When `spireMaxRuns` Active runs already exist: "The Sunken Spire is full right now. Try again in a minute" (the lobby stays until its timeout). |

**Membership.** One `spire_member` row per player. Opening or joining deletes a
stale row (run gone, ended, or you Left an active run). A live membership refuses
"You are already in a Spire party". An Out member of a run that is still fighting
is refused "You still belong to a party that is fighting (N s left); leave it to
give up its reward".

**Lobby upkeep.** Members that go offline or leave Bramblewild drop out;
leadership passes on; an empty lobby is deleted; at the timeout members are told
"The Spire party broke up". Lobby members cannot take region actions that leave
Bramblewild ("You are waiting in a Spire party; leave it first").

**Start effects.** Per member: spend one key, clear interactions (this also
cancels a queued walk), cancel trades, clear other players' combat targets on
them, end grace, teleport to `SPIRE_SPAWNS[slot]` = (72,68) (75,68) (79,68) (82,68),
state In. The run becomes Active with `startTick = T + 5` (intro) and
`endTick = startTick + 600`. The `spire_fight` row is inserted with
`hp = maxHp = spireMaxHp(cfg, n)` and the first pattern already published at
`startTick`, so the first possible contact is at least 8 ticks after the teleport.

**Endings.**

| Ending | Trigger | Effect |
|---|---|---|
| Clear | Boss HP reaches 0 (swing or star) | Cleared, `clearTicks = T - startTick`. Present In members are ejected first (Done), away members become Left; then rewards (section 3.9). `SpireClear` world event. |
| Wipe | No member In any more (away In members still count) | Failed(Wiped). No refund. |
| Timeout | `T >= endTick`, checked after that tick's swings, stars and bullets (so `endTick` is the last combat tick; /danger and /state cover it) | Failed(TimedOut): present members ejected (Done), away members Left. No refund. |
| Abandoned | Every In member away, the most recent for 50+ ticks | Failed(Abandoned), one key refunded to each In member at the exit. |
| Owner close | `configure_bosses` with `spireOpen` false | Lobbies deleted ("The Sunken Spire was sealed; your party broke up"); Active runs Failed(Closed) with key refunds. |
| Rules reset | A run's `rules != SPIRE_RULES_VERSION` after a publish | Lobbies deleted ("The Spire was updated: open a new party"); Active runs Failed(Reset) with key refunds. |
| Cleanup | Cleared/Failed and 20 ticks later (`SPIRE_END_LINGER`) | Run, fight and member rows deleted. |
| Stranded sweep | Every tick | Anyone alive and online on the floor who is not a present In member of an Active run is ejected. |

**Eject.** To (61,45) with targets, pending action and combat target cleared,
`hostile` false, 10 ticks of grace (`respawnTick = T`), HP as stated (never below
1). **The bag is never touched.**

### 3.4 Arena

| Item | Value |
|---|---|
| Floor | `SPIRE_FLOOR` x 70..84, z 55..69: 225 tiles |
| Dais (blocked) | x 76..78, z 61..63, centre `SPIRE_CENTRE` (77,62) |
| Standable tiles | 216 |
| Court (auto-swing range) | Chebyshev <= 4 of the centre (`SPIRE_RANGE`): 72 standable tiles |
| Star tiles | standable tiles 3..7 from the centre, row order: 200 tiles |
| Bullet origins | 0 the centre; 1-4 corner pillars NW (69,54), NE (85,54), SE (85,70), SW (69,70); 5-8 edge pillars N (77,54), E (85,62), S (77,70), W (69,62) |
| Default aim | (77,69) when no member can be targeted |
| Render and evaluation box | `SPIRE_BOX` x 69..85, z 54..70 |

### 3.5 Bullets

Integer only (`shared/sim/bullets.ts`; a source test bans trigonometry in
`bullets.ts`, `spire.ts` and `clatterhorn.ts`). A bullet is
`{F, ox, oz, dx, dz, q}` (fire tick, origin, direction, rate 1 or 2 tiles per
tick). Its tile at half-step h (h = 0 is the end of tick F) is the origin plus
`lineOffset(dx, dz, steps)` with `steps = q == 2 ? h : (h + 1) >> 1`. Bullets
live 36 half-steps (18 ticks). Each half-step moves at most one tile per axis.

- 16 directions `D16` (index 0 east, clockwise as seen from above).
- Fans aim with exact integer vectors: the centre ray passes through the aim
  tile; spreads are `turnCW(x, z) = (2x - z, 2z + x)` steps (about 26.57°).
- `mix32` is the only randomness. `seed = mix32(low 32 bits of runId, startTick)`;
  pattern k's 6-bit seed is `mix32(seed, 2k + 1) & 63` (64 variants per kind);
  `spin = mix32(seed6, 81) & 3` quarter turns rotate walls and curtains (a spun
  wall moves to the next side but keeps its lane index).
- The `spire_fight` row stores the current and previous pattern (kind, start,
  seed, aim). Every bullet is a function of those fields: no bullet is ever
  written to the database.

### 3.6 Collision

For a present In member in tick T: P0 = start tile, P2 = end tile, P1 = the
**canonical middle tile** (`canonicalMiddle`: the first step of the server's BFS
route when the move is 2 tiles, otherwise P2; a teleport of more than 2 is not
tested). B0, B1, B2 are a bullet's tiles at the start, middle and end of the tick.

> **Hit in half-step k (1 or 2)** when `P_k == B_k`, or when both `B_{k-1}` and
> `B_k` exist and `|Δx| + |Δz| <= 1` for `Δ = (P_{k-1} + P_k) - (B_{k-1} + B_k)`.

In words: end a half-step on a shard, or pass through one, and you are hit.
Sidestepping across its path, stepping away along it, cutting a corner past it
and entering a tile it leaves diagonally are safe. Standing still on a tile a
bullet leaves **straight** (cardinally) is a hit; on one it leaves diagonally is
not. A gapless wall is unsurvivable from every tile.

- At most one hit per member per tick (the first half-step that hits; previous
  pattern's bullets before the current one's).
- **I-frames:** a member hit in tick T is immune in T+1 and T+2 (`SPIRE_IFRAME_TICKS`).
- Exact stationary danger of tick T: `{B1, B2}` plus `B0` where `|B1 - B0|₁ == 1`.

### 3.7 Phases and patterns

| Phase | Name | Entered at a pattern boundary when | Pool | Bullet damage |
|---|---|---|---|---|
| 1 | Bloom | start | Petal Ring, Glint, Tidewall | 3 |
| 2 | Gale | `hp * 10 <= maxHp * 7` | Crosswind, Lattice, Drizzle | 3 |
| 3 | Shatter | `hp * 10 <= maxHp * 4` | Glass Sheet, Cage, Maelstrom | 4 |
| 4 | Nightfall | `hp * 20 <= maxHp * 3`, or 420 ticks after `startTick` | Eclipse, Shardstorm | 5 |

**Enrage** at 420 ticks (`SPIRE_ENRAGE_TICKS`, 4:12): phase 4 at the next boundary
and +1 bullet damage from that tick. **Time limit** 600 ticks (6:00) after the
5-tick intro. The phase never goes back.

**Scheduler** (`spireNextPattern`), at the end of a tick when no pattern exists or
`T >= curStart + duration`: `k = patternCount + 1`; the phase is the max of the
stored phase and `spirePhaseFor`; the kind is `pool[mix32(seed, 2k) % len]`, moved
to the next pool entry if it repeats the current kind; fans aim at
`targets[k % n]` (present In members by slot, at their end tiles); cur shifts
into prev.

`@t` is the fire offset from the pattern start P. Durations are ticks until the
next pattern is published.

| Kind | Key | Phase | Duration | Volleys |
|---|---|---|---|---|
| 0 | `petal_ring` | 1 | 16 | full 16-ray rings from the heart @2, 4, 6, 8, 10, alternating 1 and 2 tiles per tick |
| 1 | `glint` | 1 | 12 | 5-ray aimed fans (spreads -2..2) @2, 4, 6, 8, 10 |
| 2 | `tidewall` | 1 | 21 | wall N, 3-wide gap @2; wall S, 3-wide gap @7; fast full ring @10 |
| 3 | `crosswind` | 2 | 21 | wall N @2; wall W @7 (3-wide gaps); 3-ray fan @11 |
| 4 | `lattice` | 2 | 22 | ring @2; inward rays from the 4 corner pillars @4; ring @6; corner rays @8; 3-ray fan @10 |
| 5 | `drizzle` | 2 | 30 | 8-row curtain from N, one row every 2 ticks, 4-wide corridor, from @2; 3-ray fans @5 and @11 |
| 6 | `glass_sheet` | 3 | 25 | 10-row curtain from N, one row per tick, 3-wide corridor, from @2 |
| 7 | `cage` | 3 | 23 | walls N and S with the same gap @2; walls W and E with the same gap @9 |
| 8 | `maelstrom` | 3 | 26 | 4-spoke rings turning each tick @2..13; 5-row curtain from W, every 2 ticks, 4-wide corridor, from @4 |
| 9 | `eclipse` | 4 | 27 | 12-row curtain from N, one row per tick, 3-wide corridor, from @2; 3-ray fans @4, 7, 10, 13 |
| 10 | `shardstorm` | 4 | 30 | 8-row curtains from N @2 and from W @9, one row per tick, 3-wide corridors |

Walls move 1 tile per tick; fans 2. A curtain's corridor drifts at most one lane
per row. Sides are before the seeded spin, so curtains arrive from all four sides.

### 3.8 Fairness (validated)

`spireValidate` runs backward induction over (tile, tick) for every kind, all 64
seeds and all 144 reduced aim directions for aimed kinds: **46,464 instances**.
Each must have first contact at P + 3 or later, every standable tile winning at
P + 2, and its exact last danger at most P + duration + 2. The next pattern is
published at P + duration and cannot hit before P + duration + 3, so consecutive
patterns never overlap and a perfect player survives any chain.

| Kind | First contact | Last danger | Duration | Max live bullets | pinch | court | still |
|---|---|---|---|---|---|---|---|
| petal_ring | 4 | 18 | 16 | 48 | 0.94 | 0.83 | 0.44 |
| glint | 3 | 14 | 12 | 10 | 1.00 | 1.00 | 0.13 |
| tidewall | 3 | 23 | 21 | 39 | 0.80 | 0.71 | 0.86 |
| crosswind | 3 | 23 | 21 | 27 | 0.50 | 0.44 | 0.96 |
| lattice | 4 | 24 | 22 | 44 | 0.96 | 0.94 | 0.74 |
| drizzle | 3 | 32 | 30 | 88 | 0.78 | 0.78 | 0.72 |
| glass_sheet | 3 | 27 | 25 | 120 | 0.49 | 0.13 | 0.86 |
| cage | 3 | 25 | 23 | 48 | 0.25 | 0.25 | 0.96 |
| maelstrom | 4 | 28 | 26 | 84 | 0.75 | 0.74 | 0.78 |
| eclipse | 3 | 29 | 27 | 147 | 0.38 | 0.07 | 0.86 |
| shardstorm | 3 | 32 | 30 | 168 | 0.14 | 0.01 | 0.99 |

*pinch* = the smallest share of the 216 tiles still winning mid-pattern; *court*
= the same over the 72 court tiles; *still* = the share of tiles where standing
still through the pattern gets you hit. The default test run sweeps a 5,504-instance
sample; `SPIRE_VALIDATE=full` runs all 46,464 (about 15 s).

`spire-scheduler.test.ts` also asserts: over 16 run seeds x 240 ticks per phase
with fans aimed at a far corner, **0 of 216 tiles** are never hit by a stationary
player; a player who stands still is hit 12.3 / 12.6 / 13.3 / 18.6 times per 100
ticks in phases 1-4; a player who learns each pattern 1 or 2 ticks late is never
trapped.

**Pattern edits.** The table hash (`spirePatternTableHash`) covers the geometry,
half-step tiles and stationary danger. Any change to bullets, patterns, durations,
pools or stars changes it: the test then runs the full sweep and fails with the
line to append to `shared/sim/__tests__/spireValidated.ts`, and
`SPIRE_RULES_VERSION` (now 1) must be bumped to match. Live runs on the old rules
reset with refunds.

### 3.9 Per-tick order, offence, damage and rewards

Order inside one Active run's tick (after movement, before `phaseDeath`):

0. **Presence.** A member whose player is not loaded or offline is away: the first
   tick of each away episode sets `awaySinceTick` and bumps `awayCount`. Loaded
   but dead or off the floor: Left at once. Abandoned and away→Left are applied here.
1. **Court swings** (from `startTick`): a present In member whose slot matches
   `(T - startTick) % 4`, standing within 4 of the heart, with `nextSwingTick <= T`,
   deals `swingDamage(weapon)`: base weapon damage, no Might (punch 3, Stick and
   Flint Knife 6, Stone Club 8, Iron club 9). A meal's 3-tick swing delay skips a
   slot tick that falls inside it.
2. **Stars.** Wave `w = floor((T - startTick) / 12)`; the mask resets once per
   wave. `spireStars(seed, w, partySize + 2)` places 3..6 stars on the 200 star
   tiles, at least 3 apart when 8 tries allow. A present In member whose P1 or P2
   is on an uncaught star catches it: 15 damage (`SPIRE_STAR_DAMAGE`), `stars{slot} + 1`,
   a `Star` notice. Clients preview the next wave during the last 2 ticks.
3. **Bullets.** For each In member past their i-frames: a hit deals
   `SPIRE_DAMAGE[phase]` (3 / 3 / 4 / 5) plus 1 once enraged, sets `hitTick{slot}`,
   bumps `hits{slot}` and sends a `Hurt` notice. **HP 0 is a knockout**: state Out,
   ejected with 10 HP and 10 ticks of grace, bag untouched, no death, a
   `KnockedOut` notice.
   An **away** In member's frozen tile is still tested as a stationary player.
   In its first away episode (`awayCount == 1`) HP floors at 1; from the second
   episode a hit to 0 knocks it out. Disconnecting never dodges a bullet.
4. **Wipe**, then **timeout**, then **pattern rotation** (mirroring a phase change
   onto `spire_run.phase`), then one `spire_fight` write if anything changed.

A swing or star that takes the boss to 0 clears the run before that tick's bullets.

With 30 HP a member survives 9 phase-1 hits (10 HP at 3 each) and 5 phase-4
hits before eating; 36 HP (the settlement maximum) buys two more.

**Away.** Back within 50 ticks (`SPIRE_AWAY_TICKS`, 30 s): resume where you stand.
Away 50+ ticks while a teammate is present: Left (ejected by a direct row write,
no reward). Every member away, the most recent for 50+ ticks: Abandoned with
refunds. Away members score nothing and the clock keeps running.

**Meals.** At most 6 per member per run (`SPIRE_MEALS`). The 7th is refused
"You have eaten your fill in the Spire (6/6)". Eating is otherwise unchanged:
3-tick cooldown, healing capped by max HP, a 3-tick swing delay. A goldberry heals
10, so meals add at most 60 HP.

**Rewards** at a clear, for every member with at least 3 stars
(`SPIRE_MIN_STARS`), in state Done or Out, and online:

- 4 `berry_goldberry` and 1 `prism_shard` at the exit (`SPIRE_REWARD`);
- 100 Fighting XP (path 3, `Feat.Protect`);
- the Prism Crown keepsake (cosmetic 13);
- the Shard Pendant (cosmetic 14) when **flawless**: Done, `hits{slot} == 0`,
  `downs{slot} == 0`, `awayCount == 0`.

Left members and offline members get nothing. Every member still in the run gets a
`RunResult` notice (`quantity` = outcome, `total` = clear ticks, `amount` = your
stars); the clear's world event lists every member's name.

### 3.10 Scaling and knobs

| Knob | Default | Where | Effect |
|---|---|---|---|
| `spireHpBase`, `spireHpPerMember` | 1000, 700 | `boss_config` | `spireMaxHp = base + perMember * (members - 1)`: 1000 / 1700 / 2400 / 3100 for 1-4 |
| `spireMaxRuns` | 12 (1..32) | `boss_config` | Concurrent Active runs; lobbies do not count |
| `clatterHpBase`, `clatterHpPerChallenger` | 300, 200 | `boss_config` | Clatterhorn HP (range 50..20,000 for every HP knob) |
| Bullet damage, i-frames, enrage 420, limit 600, intro 5, court 4, stars (period 12, damage 15, count party + 2, min 3), meals 6, away 50, lobby TTL 150, lobby cap 48, patterns, durations, pools | constants | `shared/sim/spire.ts` | A publish; anything that moves a bullet also needs the full validator and a rules bump |

Patterns do not scale with party size: everyone faces the full field and fans
rotate through members. More members bring more stars, more swings and more HP.

**Prototype difficulty** (FINAL_SPEC 3.14, measured on the prototype before the
cuts, not re-run against this build):
a solo club bot clears in about 300 ticks; planner humans reacting 1-2 ticks late
clear 10 of 10 with food; a lazy player reacting 2 ticks late and clicking every
other tick clears about 4 of 10. Parties of 2-4 cleared in 277-300 ticks with
every member catching at least 7 stars.

### 3.11 Writes

At most one `spire_fight` update per Active run per tick, delivered only to that
run's subscribers (per-run SQL subscription). `spire_member` writes only on
transitions and meals; about 10 `spire_run` writes per run lifetime. No runs and
nobody on the floor: zero writes.

## 4. Data model

Eight new tables, appended (no existing column changes): `boss_config` (one row,
id 0), `clatterhorn` (one row, id 1), `clatterhorn_credit` (private),
`spire_run`, `spire_member`, `spire_fight`, and the event tables `boss_event` and
`boss_notice` (public with no RLS policy, because adding a policy is a client-breaking migration in SpacetimeDB 2.10; clients and the gateway keep only rows addressed to themselves). Only `u8`, `u32`, `u64`, `i32`,
`bool`, `string` and `identity` columns.

Enums (append-only u8): `Pending.Clatterhorn` 6; `BossId` Clatterhorn 1, Spire 2;
`BossEventKind` ClatterWake 0, ClatterDefeat 1, ClatterRespawn 2, ClatterReset 3,
SpireRunStart 4, SpireClear 5; `BossNoticeKind` YouHit 0, Hurt 1, Star 2, (Downed 3,
Revived 4 reserved), KnockedOut 5, Reward 6, Keepsake 7, RunResult 8; `HurtSource`
Charge 1, Spin 2, Runner 3, Bullet 4; `SpirePhase` Bloom 1 .. Nightfall 4;
`SpirePatternKind` 0..10 with `SPIRE_NONE` 255; cosmetics 12-15; area `'spire'`.

Lanternmaw appends six tables (`lantern_config`, `lantern_run`, `lantern_member`,
`lantern_fight`, `lantern_readiness`, private `lantern_paid`; 9.12) and the codes `BossId.Lanternmaw` 3,
`BossEventKind` LanternRunStart 6, LanternClear 7, LanternOpened 8, LanternSoon 9,
`HurtSource` Blow 5, Pulse 6, Drown 7, Bite 8, cosmetic 30 (Lanternmaw Lure), area
`'lantern'` and the no-PvP zones `'lantern'` and `'fengate'`; items `fen_bait`
(stack 10) and `fenlight` (99).

| Item | Stack | Source | Use |
|---|---|---|---|
| `gleamshell` | 99 | Clatterhorn, 2 per qualifying helper | Spire keys |
| `spire_key` | 10 | 3 obsidian + 1 gleamshell, Crafting 1, 30 XP | One per member per run |
| `prism_shard` | 99 | Spire clears, 1 per qualifying member | Shard Circlet |

| Keepsake | Id | Slot | How |
|---|---|---|---|
| Clatterhorn Horn | 12 | Head | Help defeat Clatterhorn |
| Prism Crown | 13 | Head | Clear the Sunken Spire |
| Shard Pendant | 14 | Neck | Clear the Sunken Spire without being hit |
| Shard Circlet | 15 | Head | 5 prism shards + 2 obsidian, Crafting 10, 60 XP |

None of these adds combat power. Scenery: 8 glade stones and the gate join
`SCENERY_BLOCKERS`; `TERRAIN_VERSION` is `'bramblewild-expanse-v2'`.

**No-PvP zones** (`bossNoPvpZone`): the glade ("No fighting in Clatterhorn's
Glade"), the gate zone ("No fighting at the Spire gate") and the floor ("No
fighting inside the Sunken Spire"). Friendly duels stay allowed outside the floor.
On the floor, trade, duel challenges, drop, pickup, craft, harvest, the dummy, the
Giant, garden and expedition actions are refused, and `follow` cannot cross the
floor boundary or into another run.

## 5. Owner tools, kill switch and rollout

- `configure_bosses clatterhornOpen spireOpen spirePracticeOpen spireMaxRuns spireHpBase spireHpPerMember clatterHpBase clatterHpPerChallenger`
  (owner only; ranges checked by `bossConfigProblem`). Clatterhorn reacts to
  transitions only: closing sets Closed, drops every swinger and deletes non-owed
  credit; opening returns it Dormant at home. Setting the Spire closed closes it
  again every time: lobbies deleted, Active runs Failed(Closed) with key refunds.
  `spirePracticeOpen` is stored and ignored.
- `boss_debug op runId value` (owner only): `clatter_wake`, `clatter_respawn`,
  `clatter_hp` (percent of max), `clatter_drum` (phase 2 at least, next action a
  Drum), `spire_hp` (percent; 0 sets 1), `spire_phase` (effective at the next
  boundary), `spire_fail_all` (refunds keys).
- **Rollback** is `configure_bosses` with the flag off, never a schema downgrade.
- **Rules version.** Every run stores `SPIRE_RULES_VERSION`. Browsers and the
  gateway pass it as `clientRules`; a mismatch refuses open/join/start, and a live
  run from older rules resets with refunds.
- The release steps are in [docs/CLOUDFLARE_BETA.md](../CLOUDFLARE_BETA.md)
  ("Boss fights release").

## 6. Clients and agents

- **Browser.** Clatterhorn draws its lane (back-dated to the windup start), the
  end cap (cracked stone for a flip), a reticle over the bait, the spin ring with
  its green eye, and the swarm's free columns. Clicking it offers "Attack
  Clatterhorn". The Spire Gate opens the lobby panel. Inside the Spire the
  overworld is unmounted; the HUD shows the boss bar, phase, timer, party, stars
  and meals; red tiles are next-tick danger and amber the tick after; Settings →
  Dodge assist adds green safe-step dots. Controls: WASD or arrows (camera
  relative, tap 1 tile, hold 2 per tick, Shift keeps 1), Space holds position,
  F eats the best food; touch has an 8-way pad with Hold and Eat.
- **Agents.** `GET /state` gains `clatterhorn` and `spire` blocks
  (`describeClatterhorn`, `describeSpire`); `GET /danger` returns the compact feed
  (`buildDangerFeed`: a 3-tick danger map, hit-free moves, a survival path until
  `knownUntilTick`, stars, boss and party), billed as an ordinary read. Actions:
  `attack_clatterhorn`, `spire` (`op` open, join, start, leave) and `dodge`
  (a step of at most 2 tiles). WebMCP uses the same presenters. The contract,
  error codes and limits are in [docs/AGENT_API.md](../AGENT_API.md).

## 7. Tests

| Suite | Covers |
|---|---|
| `shared/sim/__tests__/bullets.test.ts` | Kinematics, the collision micro-cases, the stationary lemma, the trig ban |
| `clatterhorn.test.ts`, `clatterhorn-dodge.test.ts` | Step function, lanes, swarm, telegraph; the real-map escape sweep and flip rates |
| `clatterhorn-server.test.ts` | Swings, HP growth, grace, blows, runners, defeat, batched payout, owner effects |
| `spire.test.ts`, `spire-patterns.test.ts`, `spire-scheduler.test.ts` | Patterns, validator sample (full with `SPIRE_VALIDATE=full`), hash history, scheduler chains, AFK rates |
| `spire-server.test.ts`, `spire-perf.test.ts` | Lobbies, start, knockouts, away grace, meals, endings, refunds, rewards; 12 runs x 4 members tick cost |
| `boss-guards-server.test.ts` | No-PvP zones, floor refusals, owner reducers |
| `bossDanger.test.ts`, `bossPresentation.test.ts` | The danger feed against brute force; `/state` shapes and size caps |
| `frontend/src/test/*` (bullets, overlay, scene, HUD, lobby, telegraph, Clatterhorn, integration) | Client behaviour |
| `lantern-server.test.ts`, `lantern-perf.test.ts` | Lanternmaw's reducers and tick through the real tick: closed by default, the owner switch and refunds, entry order, start effects, a field-for-field comparison with `lanternResolveTick` over a scripted run, blows, bites, the flood, knockouts, abandon, timeout, forfeit, rewards and the daily cap, floor guards, the rules reset, the gate's reachability and the floor's visibility; 12 runs x 4 members tick cost |
| `lanternmaw.test.ts`, `lanternmaw-entry.test.ts`, `lanternmaw-patterns.test.ts`, `lanternmaw-bots.test.ts` | Lanternmaw's geometry, patterns, tide, reference tick; entry (weapon, bait, fee), rewards and the daily cap; the full 15,808-instance validator, unwinnable-state checks and hash history; the scripted-player difficulty estimate (`LANTERN_BOTS=full` for 400 runs per point and parties) |
| `frontend/scripts/lantern-smoke.ts` | End to end against a local server: sealed by default, the owner switch and announcement, crafting Fen Bait, entry refusals, a quick-joined lobby, the start (bait and fee, spawns, HP), a fight played on the shared hazard tiles (cap, swings, dodges, meals), the clear (fenlight, XP, eject) and the owner close refund. Seeds items, coins and positions through owner SQL: never against a shared world |
| `frontend/scripts/boss-smoke.ts` | End to end against a local server: closed by default, wake, telegraph, blows, defeat, payout, respawn; keys, lobby, start, bullets, i-frames, stars, knockout, clear rewards, the owner close refund. Needs the publisher's token (`BOSS_OWNER_TOKEN` or `BOSS_CLI_CONFIG`); seeds its test items through owner SQL, so never run it against a shared world |

## 8. Deviations from FINAL_SPEC

The code is the source of truth; these differ from the spec text.

- **CORE_SCOPE cuts** (section 1). `spire_open` takes only `{clientRules}`; there
  is no `spire_kick`. Quick join picks the **newest** open lobby. Any HP <= 0
  inside the Spire is an immediate knockout.
- **Runner hits.** A stationary player takes 10 HP from one runner (two hits, no
  runner i-frames), not 5.
- **Spire HP** is `base + perMember * (members - 1)`.
- **Clatterhorn:** a shuffle clears `attack`; a due swing at a Dormant beetle ends
  grace; a defeat adds to `owedLeft` and clears every attack field; an older
  fight's unpaid reward is paid before a new fight's credit replaces it; a missing
  row is Closed and the tick does not insert it while closed.
- **Spire server:** an Active run found without its fight row, or in a closed
  mode the owner close never saw, fails without a refund (the owner close already
  refunds). After a failed run present members become Done and away members
  Left; `RunResult` goes to every member not Left before the end. Keepsake
  notices are sent only for new unlocks.
- **Presenters:** the safety table starts at `curStart - 5` so the intro shows
  winning tiles; a star's `ticksLeft` is `nextStars.inTicks - 1`; Clatterhorn's
  `you.qualified` checks only the 16-damage minimum; the longest charge lane
  covers 79 tiles.
- **Guards:** a lobby member is refused at the player save when an action would
  leave Bramblewild now or queue a walk out; `decline` and `surrender` still work
  on the floor.
- **Client:** banners sit in the HUD; there is no camera shake on a flip and no
  Clatterhorn dodge-assist hover.

## 9. Lanternmaw (the Drowned Hollow, Glimmerfen)

**Status: built, ships closed.** The shared simulation, validator and bots
(`shared/sim/lanternmaw.ts`, `lanternmawValidate.ts`, `LANTERN_FLOOR` in
`bossZones.ts`), the server (`spacetimedb/src/lib/lantern.ts`,
`reducers/lantern.ts`, 9.12), the agent API and the browser client exist. It
opens in week 2, after a staging playtest with copies of the cast.

A bog-angler the size of a barge lies in a drowned hollow under Glimmerfen,
its glowing lure swaying over a ring of boardwalk. Every few attacks it dives
and the tide floods everything but the planks, then it surfaces at one of four
glow springs to feed, and whoever stands on that spring when it rises takes a
bite but chokes it for double damage and no healing. In the den, its Maw
Bellow clears everything but the outer edge, so the only tiles you can swing
from are exactly the tiles you need all three ticks of warning to escape.

### 9.1 Why Glimmerfen

| | Frostpine | Hearthvale | Glimmerfen | Dunes | Starfall |
|---|---|---|---|---|---|
| Landmarks (`EXPANSE_LANDMARKS`) | 3 | 2 (Crossroads market) | **1** (Fenhold) | 2 | 1 |
| Tier nodes of its own (`TIER_BIOMES`) | tier 4 | tier 2, shared | **tier 2, shared with Hearthvale** | tier 3 | tier 5 |
| Recipe inputs only it grows | starpetal, moonstone | none | **none** | sunpeach, amber | dreamplum, star iron |

- **Thinnest content.** One landmark, no node kind or recipe input of its own,
  no boss. Starfall's crater ("Bring friends") is left for the world boss.
- **Material hook.** Glowcaps "glow on every hummock". The boss is a
  lantern-lured angler and its drop, fenlight, is the glow the fen is known
  for. Glimmerfen has no level-1 node, so the bait is made from common goods
  and the beta's biggest unspent surplus, honeycomb, instead (9.2, 9.10).
- **Terrain.** A drowned marsh of reed beds and boardwalks (the fen's two
  boardwalk bridges, four lakes, the Glimmer Water). The arena is boardwalk
  over shallows that flood. Glimmerfen is also the nearest biome to the island
  (the Fenway from Mossvale), so this is the first Expanse boss on the road out.

### 9.2 Architecture, gate and entry

- **Instanced like the Spire**: one sealed 15 x 15 floor shared by every run
  (logical instancing), `LANTERN_FLOOR` x 56..70, z 129..143, in the strait
  between the island's south shore and Glimmerfen's north shore, 7+ tiles from
  any land. It is not yet joined to the land mask (`terrainLand`).
- **Fen Gate** (`LANTERN_GATE`, a scenery blocker and the landmark `fengate`):
  (47,152) on Glimmerfen's north shore, 9 tiles from the floor, about 10 from
  the Fenway trail; the exit (`LANTERN_EXIT`) is (47,153) and the lobby is
  Chebyshev 3 of the gate (a no-PvP zone, `'fengate'`). The floor (area
  `'lantern'`) joins the land mask like the Spire's and the maw joins the
  blocked set; `TERRAIN_VERSION` is `bramblewild-expanse-v4`. No node moved:
  all 1,105 node seeds, tier nodes included, are identical before and after,
  and none lies within 3 of the gate. The server reuses the Spire's lobby, run
  and member machinery on its own tables: open, join, leave, start, knockouts
  that never kill (eject with 10 HP and 10 ticks of grace, bag untouched),
  50-tick away grace, 6 meals, refunds and the rules version. A Spire party
  and a Lanternmaw party exclude each other.
- **Party** 1-4 (`LANTERN_MAX_PARTY`).
- **Weapon to enter.** Every member must have a weapon of at least 8 damage
  (`LANTERN_MIN_WEAPON_DAMAGE`: a Stone Club, 1 driftwood + 2 flint at
  Crafting 1) wielded or in the bag (`lanternEntryRejection`: "Bring a weapon
  to the Drowned Hollow: a stone club or better"). Bare fists (3) and the
  stick or knife (6) almost never beat the clock even played perfectly (a
  perfect solo stick clears 5 of 100), so this removes the unwinnable starts.
- **Entry cost per member per attempt**, spent at the start and refunded only on
  an owner close, a rules reset, or a whole-party abandon by a party that was
  away since before the fight began (an abandon after the start is a loss):
  - one **Fen Bait** (`LANTERN_BAIT`: 1 `obsidian` + 2 `driftwood` + 3
    `honeycomb`, Crafting 1, 30 XP). Honeycomb is the one tier material: only
    wild honey hives (`honey_hive`, tier 1, Foraging 15, 64 on Bramblewild's
    Coast) yield it, but it is tradeable, so a player below Foraging 15 can buy
    or be given it and access is not level-locked (9.10);
  - **5 coins** (`LANTERN_ENTRY_FEE`, coin sinks stage 1), debited through
    `money()` with the reason `fee:lanternmaw`.

### 9.3 Arena

Local tiles `i = v * 15 + u` (u = x - 56, v = z - 129); the centre is (7,7).

```
. . . . . . . = . . . . . . .      M  the maw (blocked 3 x 3, like the Spire's dais)
. . . . . . . = . . . . . . .      c  court: ring 2, swing reach in the den (16 tiles)
. . . . . . . = . . . . . . .      +  court tile that is also a plank
. . . O = = = = = = = O . . .      =  boardwalk plank (dry at high tide)
. . . = . . . = . . . = . . .      O  glow spring (on the plank ring)
. . . = . c c + c c . = . . .      .  shallows (flood at high tide)
. . . = . c M M M c . = . . .      S  spawns by slot (south boardwalk)
= = = = = + M M M + = = = = =
. . . = . c M M M c . = . . .
. . . = . c c + c c . = . . .
. . . = . . . = . . . = . . .
. . . O = = = = = = = O . . .
. . . . . . . S . . . . . . .
. . . . . S . S . S . . . . .
. . . . . . . = . . . . . . .
```

| Item | Value |
|---|---|
| Standable | 216 tiles (all but the maw) |
| Boardwalk | 52 planks: ring 4 (32) and the four axis spokes (20) |
| Springs | ring 4's corners (3,3) NW, (11,3) NE, (11,11) SE, (3,11) SW |
| Den reach | Chebyshev <= 2 of the centre (`LANTERN_COURT_RANGE`): ring 2 only |
| Spring reach | Chebyshev <= 2 of the spring (`LANTERN_SPRING_RANGE`): 5 planks, the rest shallows |
| Movement | ordinary: up to 2 steps per tick, the maw blocks, diagonals need both corners |
| Hit rule | blows land on **end-of-movement tiles** (the Clatterhorn rule). No bullets, no swept test |

### 9.4 States and the cycle

`LanternStage`: Den 0, Dive 1, Tide 2, Ebb 3. A run: a 15-tick start grace ("the water stills": nothing attacks; rules 3, was a 5-tick intro), then the
fight from `startTick` to `startTick + 600` (`LANTERN_TIME_LIMIT`, 6:00), enrage
at 420 (`LANTERN_ENRAGE_TICKS`, 4:12).

| Stage | Length | Boss | Hazards | Swings |
|---|---|---|---|---|
| Den | 3 patterns (`LANTERN_DEN_PATTERNS`), back to back | in the maw | den blows | from ring 2 |
| Dive | 8 ticks (`LANTERN_DIVE_TICKS`) from the end of the third pattern to S | under the mud | none | none |
| Tide | 15 ticks, S .. S + 14 (`LANTERN_TIDE_TICKS`) | at the spring: chokes or feeds | flood, lure pulses | within 2 of the spring |
| Ebb | 3 ticks (`LANTERN_EBB_TICKS`) | swimming home | none | none |

Transitions happen at the end of a tick (`lanternAdvance`). A den pattern is
published on the tick the previous one's last blow lands, with its own first
blow 3 ticks later. The third pattern's end publishes the dive: the spring
(`mix32(seed, 0x5000 + cycle) & 3`), the pulse seed and the flood, 8 ticks
before S. The ebb's last tick publishes the next den pattern.

### 9.5 HP and phases

```
maxHp = 810 + 970 * (members - 1)      // 810 / 1780 / 2750 / 3720
```

Phases, evaluated when a pattern or a dive is published and never going back:
P1 above 2/3 HP, P2 at or below 2/3, P3 at or below 1/3 or once enraged. The
`lantern_config` knobs are `lanternHpBase` 810 and `lanternHpPerMember`
970. Their defaults, the bite, the fee, the bait, the weapon floor and the
daily cap live in `shared/sim/constants.ts` (Lanternmaw section).

### 9.6 Attacks

**Den patterns** (`LANTERN_PATTERNS`, offsets from publication P; every blow
lands at P + 3 or later):

| Kind | Key | Pools | Blows | Duration |
|---|---|---|---|---|
| 0 | `lure_sweep` | P1 | the four quarters (E, S, W, N; diagonals in both), one per tick @3..6, seeded start and direction | 6 |
| 1 | `mud_geysers` | P2 | six 3 x 3 geysers @3..8 at seeded tiles | 8 |
| 2 | `tail_lash` | P1, P2 | rings 2-3 and rings 4-5 alternating @3, 6, 9 (seed picks which first) | 9 |
| 3 | `ripple` | P2, P3 | a ring 1 tile thick expanding 1 tile per tick from the maw (rings 2..7 @3..8) or a spring (0..11 @3..14); odd seeds send a second ring 3 ticks behind. Step through it inward | 8-17 |
| 4 | `mire_marks` | P2, P3 | aimed: a 3 x 3 on the target's tile @3, then two seeded 2-tile hops @4, @5 | 5 |
| 5 | `drowning_cross` | P3 | 3-wide axis bands and diagonal bands alternating @3, 5, 7 | 7 |
| 6 | `lantern_storm` | P3 | ten 3 x 3 geysers, two per tick @3..7 | 7 |
| 7 | `maw_bellow` | P1, P2, P3 | rings 2-6 @4 (only the outer edge is safe: 5 steps from the court; rules 3 gives it 4 ticks of notice so a player a tick late still escapes), then rings 5-7 @7 or @8 (straight back in) | 7-8 |

Pools: P1 sweep, lash, bellow; P2 geysers, lash, ripple, marks, bellow; P3
ripple, marks, cross, storm, bellow. Pattern k is `pool[mix32(seed, 2k) % len]`,
moved to the next entry if it repeats the current kind, with
`seed6 = mix32(seed, 2k + 1) & 63`; Mire Marks aims at `targets[k mod n]`
(present members' end tiles by slot).

**The tide.** From S to S + 14 every non-plank tile is flooded: ending a tick on
one costs 3 HP (`LANTERN_DROWN_DAMAGE`; rules 3, was 4), with no i-frames either way.

**Surfacing.** On tick S, before swings, every present member on the spring
**caps** it: each capper is bitten for 6 (`LANTERN_BITE_DAMAGE`) and the boss
**chokes** for S .. S + 8 (`LANTERN_CHOKE_TICKS`): swings deal double damage, it
does not heal and does not pulse. An **uncapped** spring feeds it 1 / 2 / 3 / 4
HP per tide tick by party size (`LANTERN_FEED_HEAL`): 15 / 30 / 45 / 60 per tide.

**Lure pulses** at S + 3, 6, 9, 12 (P1-P2) or S + 3, 4, 7, 8, 11, 12 (P3),
alternating A (the spring and its neighbours, Chebyshev <= 1) and B (the tiles
exactly 2 away), starting from the pulse seed's parity. Skipped while it chokes.

| Damage | P1 | P2 | P3 | Enraged |
|---|---|---|---|---|
| Den blow (`LANTERN_BLOW_DAMAGE`) | 10 | 13 | 15 | +1 |
| Lure pulse | 7 | 7 | 7 | +1 |
| Flooded tile, per tick | 3 | 3 | 3 | |
| Bite (capping) | 6 | 6 | 6 | |

Blows and pulses give 2 ticks of i-frames (`LANTERN_IFRAME_TICKS`). With 30 HP
and 4 goldberries (`LANTERN_MEALS`; rules 3, was 6) a member has 70 HP of budget; a perfect solo run spends about
60 of it on 10 bites and nothing else.

### 9.7 What is new about it

- **Clatterhorn** is a moving beetle whose own charges create its weakness (a
  stone flips it). **The Shardmother** is bullets you weave through and stars you
  walk onto.
- **Lanternmaw changes the floor and makes you pay for its weakness.** High tide
  shrinks the arena to the boardwalk. The double-damage window needs a body on
  the spring at the surfacing tick, and that body is bitten. Solo, that is an
  HP-for-damage trade every cycle; in a party it is a role (one capper, the rest
  swing).
- **Reach is the risk.** Den swings land only from ring 2, and the Maw Bellow
  needs all 3 ticks of notice from ring 2. A learned player steps into ring 2 on
  their own swing tick (every 4th) and waits on ring 3 otherwise; a greedy one
  eats bellows.
- **No bullets.** Every hazard is a telegraphed set of tiles (the Clatterhorn
  rule), so the danger feed is a list of tiles per tick.

### 9.8 Fairness (validated)

`lanternmawValidate.ts` runs backward induction over (tile, tick) from every one
of the 216 standable tiles, for every instance: 7 unaimed den kinds x 64 seeds,
Mire Marks x 64 seeds x all 216 aim tiles, and 4 springs x 64 pulse seeds x 3
phases x capped or not: **15,808 instances, all passing**, about 1 s, so the
default test always runs the full sweep. Each instance must:

- give notice: first contact at P + 3 or later for den patterns, S = P + 8 for the tide;
- start winning: every standable tile can dodge every blow, pulse and flooded
  tick to the end (capped instances: every tile can reach the spring by S and
  then survive);
- leave a free tile on every tick (`minFree` >= 1);
- end its danger by the tick the next instance is published (den: last danger <=
  duration; tide: S + 14, before the ebb). The next den pattern cannot land
  before 3 ticks later and the dive and ebb have no hazards, so instances never
  overlap and a perfect player survives any chain.

| Group | n | First | Last | minFree | pinch | reach | still |
|---|---|---|---|---|---|---|---|
| lure_sweep | 64 | 3 | 6 | 156 | 0.64 | 0.63 | 1.00 |
| mud_geysers | 64 | 3 | 8 | 207 | 0.95 | 0.75 | 0.15 |
| tail_lash | 64 | 3 | 9 | 144 | 0.67 | 0 | 0.52 |
| ripple | 64 | 3 | 17 | 128 | 0.59 | 0 | 1.00 |
| mire_marks | 13,824 | 3 | 5 | 207 | 0.95 | 0.69 | 0.02 |
| drowning_cross | 64 | 3 | 7 | 144 | 0.67 | 0.25 | 0.63 |
| lantern_storm | 64 | 3 | 7 | 198 | 0.91 | 0.56 | 0.25 |
| maw_bellow | 64 | 4 | 8 | 56 | 0.26 | 0 | 1.00 |
| tide | 768 | 8 | 22 | 49 | 0.23 | 0.08 | 0.78 |
| tide, capped | 768 | 8 | 22 | 49 | 0.12 | 0.08 | 0.78 |

*pinch* = the smallest share of the 216 tiles still winning mid-instance;
*reach* = the same over the tiles in swing reach (the court; the spring's
reach for the tide), 0 when a pattern clears the court; *still* = the share of
tiles where standing still gets you hit.

**Unwinnable states** (`lanternmaw-patterns.test.ts`):

- **Heal bound.** Feeding heals less than one stick swing (6) per member per
  swing interval for every party size (`lanternHealProblem`), so it can never
  out-heal a party that keeps swinging.
- **Swing room.** On every tide tick at least 2 winning tiles are in the
  spring's reach, capped or not.
- **The cap walk.** Every standable tile reaches every spring within the dive
  (worst case 8 ticks around the maw; the first draft gave 6 and the validator
  caught it).
- **Entry precondition.** Every member holds a weapon of at least 8
  (`LANTERN_PRECONDITION_WEAPON`, enforced by `lanternEntryRejection`); the
  clock check below is proved for that floor.
- **Clock.** A perfect solo player with the weakest admitted weapon (a Stone
  Club) clears every sampled run before the time limit (24 seeds in the test,
  400 in the bots, about 500 ticks of 600).

**Pattern edits.** `lanternPatternTableHash` covers the floor, planks, springs,
spawns, pattern definitions, pools, timings, damages, heal, HP defaults, every
blow of every kind for all 64 seeds (Mire Marks at two aims) and every pulse
mask. A change fails the test with the line to append to
`shared/sim/__tests__/lanternmawValidated.ts` and asks for a
`LANTERN_RULES_VERSION` bump (now 3, hash `91c36734`, after the staging playtest (9.14); rules 2 was `b52934ff`, rules 1 the first
draft's numbers).

### 9.9 Difficulty estimate (scripted players)

`lanternmawBots.ts` drives the reference tick with players that see the fight
`react` ticks late, plan by backward induction over what is published, slip into
a random step with some chance per tick, cap with some chance per dive and eat a
goldberry at low HP. Solo, Stone Club, 30 HP, 4 meals (rules 3; 400 runs each):

| Player | React | Plan | Slips | Caps | Den reach | Win rate |
|---|---|---|---|---|---|---|
| Perfect | 0 ticks | full | 0 | always | always ring 2 | **99.75%** (399 of 400; the one loss caps a twelfth spring on its last meal), clears in about 500 ticks (5:00) |
| Careful (learned) | 1 tick | full | 2% | always | ring 2 on its swing tick, ring 3 otherwise | **31%** (rules 2: 28%) |
| Sloppy | 2 ticks | this tick and the next | 6% | 30% | always ring 2 | **0%** |

Careful runs are lost to attrition (bites, den hits and flood ticks against 70 HP), not to the clock.

**Attempts to a first clear.** A learner plays sloppy on its first attempt and
blends linearly to careful over K attempts. Measured win rates (400 runs each)
at skill 0, 1/4, 1/2, 3/4 and 1 are 0, 0, 0.05, 0.18 and 0.28 (rules 3), so:

| Learns over | Median attempts | Mean | 90% by |
|---|---|---|---|
| 10 attempts | 10 | 10.4 | 15 |
| 30 attempts | 21 | 21.3 | 28 |

The 10-50 target holds if the best seat needs about 10 or more attempts to
learn the cap and the ring 2 rhythm. A seat that plays carefully from its first
attempt would clear in about 3.2 attempts (1 / 0.31). The first staging playtest
(9.14) measured agents far below the careful bot.

**Parties** (100 runs each, rules 3): careful duo 49%, careful quad 65%, perfect quad
100%, sloppy quad 0%. One capper takes every bite while the rest swing; the HP
per member is set so a careful party of four lands in 55-65%.

### 9.10 Rewards and economy

**Rewards** at a clear, for every member with at least 40 damage dealt in the run
(`LANTERN_MIN_DAMAGE`), Done or Out, and online (`lanternClearReward`):

- 2 `fenlight` (new biome material, stack 99: a lure-bulb that still glows),
  **only for the character's first 4 qualifying clears each UTC day**
  (`LANTERN_DAILY_PAID_CLEARS`, CONTENT_ROADMAP's boss loot cap). Later clears
  that day pay XP only;
- 120 Fighting XP (path 3, `Feat.Protect`) on every qualifying clear;
- no goldberries (CONTENT_ROADMAP: no new drop pays goldberries or heals).

**Fenlight's uses.** At launch it feeds one keepsake: the **Lanternmaw Lure**
(head, cosmetic 30, a dangling light), 3 fenlight + 2 driftwood at Crafting 10
(`LANTERN_KEEPSAKE_RECIPE`, like the Shard Circlet). Everything else is
reserved for the week-6 endgame item line (CONTENT_ROADMAP.md), whose items add
max HP or damage reduction, one axis each, and never weapon damage over 9. No
fenlight recipe makes a weapon (ROADMAP section 1.4: power comes from
preparation, never time played; LONG_SEASON: no season item is a weapon).

**Per attempt, per member:** 1 obsidian + 2 driftwood + 3 honeycomb (the bait),
5 coins, and up to 4 meals of your own food.

**Why honeycomb, not gleamshell (2026-11-08).** The bait first took 1
gleamshell. Clatterhorn is gleamshell's only source and had 0 agent clears in
the 24 h before the change, and the live beta held 8 gleamshell in the whole
world, so opening Lanternmaw would have allowed about 8 attempts in total.
Honeycomb was the biggest unspent surplus: +1,092 in the same 24 h, about 1,037
of it sitting in one AI vault, and its only sinks were the Beeswax Candle (2),
Sunpeach Preserves (1) and the 20-honeycomb ledger order. Honeycomb comes only
from wild honey hives (`honey_hive`: tier 1, Foraging 15, 64 hives on
Bramblewild's Coast 17+ tiles from spawn). Gathering it is gated at Foraging
15, but it is an ordinary tradeable item, so the bait is not level-locked: a
new player can trade for it or be handed it by a party member.

| Flow | Amount | Math |
|---|---|---|
| **Sink:** coins | 5 per member per attempt | Orders mint at most 60 coins a character a day (`FRONTIER.repeatCap`), so a day of orders pays 12 attempts. At the careful 31% a clear costs about 3.2 attempts (16 coins); a learner's first clear costs 10-21 attempts (50-105 coins, one to two days of orders). A seat attempting nonstop (about 8 an hour) would burn about 40 coins an hour, far past its income, so the fee also paces attempts. Six seats at 12 attempts a day burn 360 coins a day, against at most 360 minted by their orders. |
| **Sink:** honeycomb | 3 per member per attempt | At N member-attempts a day the bait burns 3N honeycomb a day. Six seats at the fee-paced 12 attempts a day (72 member-attempts) burn 216 a day, about a fifth of the observed +1,092; burning the whole surplus takes about 364 member-attempts a day. The ~1,037 already banked is about 345 baits. Gleamshell is no longer an input, so its only sink is the Spire key |
| **Sink:** obsidian | 1 per member per attempt | beside the Spire key's 3 |
| **Sink:** driftwood | 2 per member per attempt, 2 per keepsake | common Coast node |
| **Sink:** meals | up to 4 food per member per attempt | perfect and careful runs eat all 4 |
| **Faucet:** fenlight | 2 per qualifying member per paid clear, at most 4 paid clears a UTC day | at most 8 a character a day; with 6 seats and active humans, roughly 50-100 a day. Sink at launch: 3 per keepsake, once; the stockpile waits for week 6 |
| **Faucet:** Fighting XP | 120 per qualifying clear | capped Might, as with the other bosses |

### 9.11 Ships closed, opens as an event

- **Its own config row.** `lantern_config` (id 0: `lanternOpen` false,
  `lanternMaxRuns` 12, `lanternHpBase` 810, `lanternHpPerMember` 970) instead of
  new `boss_config` columns: appending columns to an existing table is
  `AddColumns`, which in SpacetimeDB 2.10 disconnects every client and leaves
  old bundles unable to decode the row. `lanternConfigOr` reads a missing row
  as closed.
- **Closed means closed for crafting.** While closed, `craft` refuses `fen_bait`
  and `lanternmaw_lure` ("Fen Bait can only be made while the Drowned Hollow is
  open"; `lanternRecipeSealed`), and `recipeStatus` hides them from the craft
  menu and `state.recipes`. The Fen Gate stays on the map as a sealed landmark,
  and `state.lantern` is the compact `{open: false, gate}` away from the gate.
- **Its own owner reducer.** `configure_lanternmaw lanternOpen lanternMaxRuns lanternHpBase lanternHpPerMember`
  (owner only, ranges by `lanternConfigProblem`: runs 1..32, HP 50..20,000), so
  `configure_bosses` and its eight-argument kill switch are unchanged. Opening
  (a closed-to-open transition) emits the world `boss_event` `LanternOpened`;
  closing deletes lobbies and fails Active runs with Closed, bait and fee
  refunded, every time it is called.
- **The announcement.** `boss_debug lantern_soon 0 <minutes>` emits
  `LanternSoon` (value = minutes) for the T - 10 notice; `lantern_hp` (an Active
  run's id, a percent) and `lantern_fail_all` (refunds) help the live check.
- Every run stores `LANTERN_RULES_VERSION` (3); clients send theirs as
  `clientRules`. A mismatch refuses open, join and start, and a live run from
  older rules resets with refunds.
- Release steps: [docs/CLOUDFLARE_BETA.md](../CLOUDFLARE_BETA.md) ("Lanternmaw release").

### 9.12 Server (built)

- **Tables** (new tables only; a pure "Creating table" publish, rehearsed:
  the plan is exactly the six steps below and nothing is flagged breaking):
  `lantern_config` (public, one row), `lantern_run` (public: id, leader,
  stage, outcome, rules, partySize, createdTick, startTick, endTick, phase,
  clearTicks), `lantern_member` (public: identity, runId (btree), slot, state,
  joinedTick, awaySinceTick, awayCount, meals), `lantern_fight` (public, per
  run: the `LanternFightLike` fields with `curAim` a local tile, plus
  `hitTick`, `hits`, `dmg`, `drowned` and `caps` per slot 0..3) and the private
  `lantern_paid {identity, day, paid}` for the daily cap (`lanternUtcDay` of the
  reducer timestamp), and `lantern_readiness {identity, runId, tick}` (public) for
  the lobby ready check: in a party, `lantern_start` needs every other member's
  `lantern_ready`, which lasts until they leave the lobby or the run starts. No RLS anywhere. Runs, members and outcomes use the
  Spire's codes (`SpireStage`, `SpireOutcome`, `SpireMemberState`).
- **Reducers.** `lantern_open {clientRules}`, `lantern_join {runId, clientRules}`
  (0 = the newest open lobby), `lantern_leave`, `lantern_start {clientRules}`
  (the leader; every member checked in order: online, in Bramblewild, within 3
  of the gate, `lanternEntryRejection` (weapon, bait, coins), the giant berry,
  a duel, an expedition; then the run cap). The start spends one Fen Bait per
  member and debits 5 coins through the frontier ledger (`fee:lanternmaw`;
  refunds are `refund:lanternmaw`).
- **The tick.** `phaseLantern` runs after `phaseSpire`. For each Active run it
  does the Spire's presence step (away bookkeeping, Left, Abandoned after 50
  ticks: refunded only if everyone was away since before `startTick`), then builds a `LanternRunSim` from the rows (present
  members on their end tiles, weapon damage from the wielded item, i-frames
  and counters from the slot columns) and calls `lanternResolveTick`, writing
  back HP, knockouts, `Hurt` notices (`Bite`, `Blow`, `Pulse`, `Drown`), the
  slot columns and one `lantern_fight` row. `lantern-server.test.ts` compares
  the stored fight and HP to the reference tick by tick. Then the stranded
  sweep. Cost: 0.23 ms median, 0.70 ms p95 for 12 runs x 4 members
  (`lantern-perf.test.ts`; `phaseSpire` measures 0.43 ms on the same machine),
  25 microseconds idle with 250 loaded players.
- **Deviations from the reference.** Away (offline) members are not in the
  simulation: they take no hits and deal none (the Spire hits a frozen tile).
  They still count against a wipe: when the reference reports a wipe with an
  away member still In, the server runs `lanternAdvance` itself and the run
  goes on. Clearing pays no keepsake (the Lure is crafted).
- **Guards.** The floor is a no-PvP zone; trade, duel challenges, drop,
  pickup, harvest, the Giant, garden, ledger, vault and region actions are
  refused ("inside the Drowned Hollow"); `follow` cannot cross the floor or
  into another run; eating counts toward 4 meals; nobody dies on the floor;
  invites never pull a member out of a run; a lobby member cannot leave
  Bramblewild; ground items that would land on the floor land at the exit.
- Agents: `state.lantern`, the `lantern` action and `/danger` on the floor
  (docs/AGENT_API.md, `frontend/public/agent.md`).

### 9.14 Staging playtest and rules 3 (2026-11-08)

Three Sonnet 5.5 seats on the HTTP API made 22 attempts in 1 h 53 min with no clears and no learning trend; the best
run left the boss at 562/810. Den blows caused 17 of 25 knockouts, bites 5, the flood 3, and agents ran out of meals
around tick 150-240 with the boss at 70-90%. The write-up is in the agent-studio staging notes. Changes:

- **Reaction room.** Only the Maw Bellow trapped a player who sees a pattern one tick late on ring 2 (all 64 seeds x 16
  court tiles; every other pattern 0%). It now lands its first blow at P + 4 and its second at P + 7 or P + 8.
  `lanternReactionSafe` (lanternmawValidate.ts) checks every den instance: from every ring 2 tile, a player one tick late
  can still dodge every blow.
- **Retune** (bite 6 and HP 810 + 970 kept): the extra tick took the careful bot from 28% to 72%, so meals go from 6 to 4
  and the flood from 4 to 3 HP a tick. The choke stays 9 ticks (7 made perfect solo runs time out). Careful solo 31%,
  careful quad 65%.
- **Start grace.** 15 ticks of "the water stills" before the fight clock (was a 5-tick intro), so a member whose loop
  starts late is not knocked out by tick 11-19. `fightStage` and `/danger` `boss.stage` read `still`.
- **The start draws your weapon.** Entry accepts a club in the bag, but the fight swings only the wielded weapon: the
  start wields each member's best 8+ weapon (moving it into the quick bar) with a `Wielded` boss notice.
- **Agent fixes.** `/danger` `spring.tile` (the docs named it; the feed had only x and z, so no phase-1 script capped), a
  contract test of every documented field, and the BigInt crash in `/actions/move`. agent.md now states the HP formula,
  the ring 3 rhythm, wielding and starting your loop before the leader starts.
- `LANTERN_RULES_VERSION` 3, hash `91c36734`; the full 15,808-instance sweep passes.

### 9.13 Decisions and open questions

Decided by the overseer (2026-11-07):

1. **No weapon from fenlight.** It feeds the Lanternmaw Lure keepsake and is
   reserved for the week-6 endgame line (max HP or damage reduction, never weapon
   damage over 9). The Fenlight Hook is gone.
2. **Bait**: 1 obsidian + 2 driftwood + 3 honeycomb, Crafting 1 (2026-11-08;
   was 1 gleamshell + 1 obsidian + 2 driftwood, from level-1 inputs only).
   Honeycomb needs Foraging 15 to gather but is tradeable (9.10).
3. **A weapon to enter**: at least a Stone Club, wielded or in the bag (a stick
   cannot win in time, 9.8).
4. **Coin fee**: 5 coins per member per attempt (coin sinks stage 1).
5. **Tuning**: bite 6, HP 810 + 970 per member: careful solo 28%, careful quad
   61%, sloppy solo 0%, perfect solo and quad 100%.
6. **Daily cap**: fenlight from at most 4 qualifying clears per character per
   UTC day, then XP only. No goldberries.

Still open:

- **No repeatable fenlight sink until week 6.** CONTENT_ROADMAP asks every new
  material to ship with a repeatable sink; at launch fenlight has only the
  one-off keepsake. The daily cap holds the stockpile to at most 8 a character a
  day (about 40 by week 6 for a daily player). Ship as is, or add a small
  repeatable sink (for example fenlight in the bait) at launch?
- **The fee as a pace limit.** 5 coins makes nonstop attempts outspend order
  income about eightfold. That paces the best seat toward the 2+ day runway, but
  a seat with no coins cannot try at all. Keep it, or let the first attempt of
  each UTC day go free?
