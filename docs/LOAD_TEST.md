# Load test

`frontend/scripts/loadtest/` drives N headless SpacetimeDB SDK clients against a server and reports tick health,
per-client bandwidth, reducer latency and server CPU/RSS. It is the measuring stick for the 2000-players-on-one-server work.

```sh
cd frontend
npm run loadtest -- --n 250 --mode interest --db berigame --seconds 60
npm run loadtest -- --help
```

Commands that reach the local server need the Claude Code Bash sandbox disabled (tsx also opens an IPC socket).

## What a client does

Each client connects with the generated bindings (`frontend/src/module_bindings`), subscribes, calls `set_name("lt<i>")`,
and then every 0.5x to 1.5x of `--think` ms (default 2500) picks one action:

| action  | share | what |
|---------|-------|------|
| walk    | 50 %  | `set_target` to a random land tile within 24 tiles in the same area (also the fallback when nothing is near) |
| harvest | 25 %  | `start_harvest` on the nearest free, ready node within 12 tiles that a level-1 character may use |
| fight   | 10 %  | `attack` the nearest online player within 10 tiles |
| emote   | 8 %   | `emote` (any but Sit) |
| chat    | 7 %   | `send_chat` with a short canned line |

Characters are reused between runs: tokens are cached in `$TMPDIR/berigame-loadtest/<db>.tokens.json` (`--fresh` for new identities).
A new character spawns in the Grove, and without a stick it cannot cross the bramble hedge, so the harness **scatters** every
character found in the Grove to a random Coast tile with an owner `UPDATE player SET x, z` (and the same on `player_pos`, which
holds the live position while a character is online) over the SQL HTTP API (owner token from
`~/.config/spacetime/cli.toml`, or `LOADTEST_OWNER_TOKEN`; `--no-scatter` turns it off). Without scatter all N players stand inside one
33 x 33 area, which is not what 2000 players look like.

Expected reducer errors: new characters are protected for 3:00 (`They are protected...`), the Glade forbids PvP, chat is
rate-limited to one line per 3 s. They are counted in the JSON (`reducers.outcomes`) and do not indicate a problem.

## Subscription modes

- `--mode full` mirrors `frontend/src/spacetime/connection.ts` (every table it subscribes, `boss_notice` narrowed to self, plus
  `subscribeFrontier`'s `frontier_object` queries for the island).
- `--mode interest` subscribes small or global tables whole (`world`, `chat_message`, `giant`, `boss_config`, ...), per-player
  tables to the client's own rows (`player_skill`, `player_cosmetic`, `adventure_profile`, `appearance`, own `player`, ...),
  the world-wide event rows (`cell = 0`) and your defeat drops, and then, like the browser
  (`frontend/src/spacetime/interestSubscription.ts`), one subscription per cell of `shared/sim/interest.ts` around the
  client: `local:K` (the cell's `player_pos`, the `player` rows joined on it, and its four event tables) for the 3 x 3 player
  block, `nodes:K` (`tree`, `ground_item`) for the 3 x 3 node block. As the client walks it subscribes the new cells and drops
  the old ones. It is representative, not the real client (no Meadows seam cells: bots stay on the island). Trees from before
  cells fall back to their box queries (`interestQueries` / `playerQueries`, with the box event queries the browser had);
  `--player-block 16x1` overrides the player block (`<chunk>x<radius>`) on those.
- `--view sink` (interest mode): each bot opens a second connection with the same identity and subscribes its cells there;
  that connection's updates are counted (`perClientIn` includes them) but never decompressed or decoded. The server does all
  of a browser's work for it (evaluation, fan-out, compression, subscribe and unsubscribe), while the load generator skips
  what a browser would render, so one laptop can drive 2500 clients at the full tick rate (with `--view sdk`, the default,
  1500 decoding clients take 5 cores and stall their event loops by seconds once the tick runs at 1.67/s, and the late bots
  then offer half the intended input rate). Bots decide without the decoded rows: harvest the nearest seeded node in reach
  (the server queues or refuses as for anyone), attack the nearest bot of their own worker within 10 x sqrt(N / bots per
  worker) tiles (the same odds of a target as 10 tiles among everyone). Decoded KB/s are then only known with
  `--compression none`.

Each report's `observerRowsPerSec` counts row callbacks per table (`playerPos.update`, `player.update`, `chatMessage.insert`, ...)
on one observer client per worker: which tables the inbound bytes are made of.

## What is measured

All counters are reset when the measure window starts (after ramp-up and `--warmup`, default 10 s).

- **Tick rate**: world.tick advance per wall-clock second seen by one observer client per worker (target 1.67/s = 600 ms).
  **Tick interval** is the difference of consecutive `world.tickStartedAt` values, i.e. server-side truth: p95 or max above 600 ms
  means the scheduled tick ran late or overran. Rates above 100 % are catch-up after a stall.
- **Tick lag**: arrival of each world update at each client minus `tickStartedAt` (same machine, same clock). It includes the tick
  reducer's run time, commit, fan-out, the socket and the client's own decode; `lagByWorker` separates the two ends: spikes on
  every worker at once point at the server, spikes on a few workers at the load generator.
- **Per-client inbound**: bytes and messages counted at the WebSocket (`socket.ts` wraps the SDK's socket factory), both on the wire
  (gzip, as the browser asks for) and after decompression.
- **Reducer RTT**: call to result promise per reducer. **Move effect**: `set_target` call to the first change of the client's own
  position (includes waiting for the next tick, so ~300 ms median at an idle server).
- **Connections**: joined, failed (with reason), dropped during the window, join time.
- **Server process**: CPU cores (delta of `ps` cumulative CPU time) and peak RSS of `spacetimedb-standalone`. This is the
  whole server, every database on it.
- **Load generator**: worker CPU and event-loop delay p95. If the event-loop delay is in the hundreds of ms, latency and lag
  numbers are measuring the load generator, not the server.

Each run prints a summary and writes JSON to `frontend/scripts/loadtest/results/<time>-<mode>-<n>.json` (or `--out`).

## Scaling the load generator

The orchestrator (`run.ts`) forks one worker process per `--per-worker` clients (default 125; 50 gives more headroom) and kills
them all at the end, on Ctrl-C, or if it dies (workers exit when their IPC parent disconnects). Each worker ramps
`--batch` clients every `--batch-ms`. A full-world Node client costs real CPU (gunzip plus SDK decode of every row update):
on a 10-core M1 Pro, 500 clients take ~5 cores and 1000 saturate the machine. For N >= 1000 run the load generator on another
machine (`--uri ws://host:3000`) or split N across several machines, and keep an eye on `loadgen.loopDelayP95Ms`.

## Testing a fixed revision

The working tree changes under you when several people edit it, and the bindings must match the published schema (a mismatch shows
up as `RangeError: Offset is outside the bounds of the DataView`). `export-tree.sh` exports a revision with its bindings and this
harness into a scratch directory, optionally raising `MAX_ONLINE_PLAYERS` so the admission cap is not what you measure:

```sh
cd frontend
scripts/loadtest/export-tree.sh HEAD /tmp/claude/berigame-base 4096
(cd /tmp/claude/berigame-base/spacetimedb && ~/.local/bin/spacetime publish berigame-base --server local --yes)
cd /tmp/claude/berigame-base/frontend
for n in 50 100 250 500; do
  npx tsx scripts/loadtest/run.ts --db berigame-base --n $n --mode full --seconds 60 --per-worker 50 \
    --out ~/Development/personal/berigame/frontend/scripts/loadtest/results/base-full-$n.json
done   # then the same with --mode interest
```

## Baseline (2026-10-19, main 2a59ed6)

Module: main at 2a59ed6 with only `MAX_ONLINE_PLAYERS` raised from 256 to 4096 (published as `berigame-base`). With the real
cap, client 257 onwards is refused in `client_connected` (`world is full`); that cap, not performance, was the first thing to fail
at N=500 against the stock module.

Machine: Apple M1 Pro, 10 cores, 16 GB, macOS 26, Node 24.1, SpacetimeDB standalone 2.10.1 with DEBUG logging, server and load
generator on the same laptop. **Noisy**: other agents were publishing and load-testing other databases on the same server and
running builds; load average ranged 3 to 39 during these runs. Each stage ran 60 s after a 10 s warmup, think 2500 ms,
gzip, scatter on, `--per-worker 50`. Results: `frontend/scripts/loadtest/results/base-*.json`.

| mode | N | joined | ticks/s | tick interval p95 / max ms | tick lag p50 / p95 ms | per-client in, wire KB/s (decoded) | msgs/s per client | server egress MB/s wire | set_target RTT p50 / p95 ms | server CPU cores | load-gen CPU / loop p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| full | 50 | 50 | 1.67 | 601 / 602 | 26 / 42 | 11.5 (24) | 19 | 0.56 | 7 / 13 | 0.30 | 0.1 / 22 |
| full | 100 | 100 | 1.67 | 605 / 613 | 55 / 124 | 22.8 (49) | 33 | 2.2 | 10 / 53 | 0.37 | 0.3 / 34 |
| full | 250 | 250 | 1.60 | 692 / 1191 | 244 / 5970 | 45.7 (105) | 39 | 11.2 | 36 / 3195 | 1.22 | 1.8 / 99 |
| full | 500 | 500 | 1.81 | 644 / 1203 | 1240 / 4210 | 84 (196) | 21 | 41 | 737 / 3265 | 0.97 | 5.6 / **5964** |
| interest | 50 | 50 | 1.67 | 602 / 604 | 28 / 50 | 10.2 (21) | 17 | 0.50 | 8 / 23 | 0.08 | 0.1 / 25 |
| interest | 100 | 100 | 1.67 | 601 / 604 | 45 / 68 | 18.5 (38) | 29 | 1.8 | 7 / 23 | 0.18 | 0.2 / 22 |
| interest | 250 | 250 | 1.67 | 601 / 601 | 88 / 121 | 46.6 (96) | 61 | 11.4 | 8 / 64 | 0.51 | 1.2 / 23 |
| interest | 500 | 500 | 1.68 | 615 / 659 | 290 / 649 | 87.7 (193) | 44 | 43 | 76 / 490 | 1.19 | 5.0 / 230 |
| interest | 1000 | 969 (21 timeouts) | 2.98 | 769 / 1219 | 3811 / 16027 | invalid | | | | 0.54 | 3.3 / **20149** |

Earlier runs at full N=250 gave lag p95 1.4 s, 0.2 s and 1.6 s: at that size the full-mode result depends on what else the
machine is doing. The full N=500 and interest N=1000 rows are load-generator bound (event loop stalled for seconds) and only
their server-side columns (tick interval, server CPU) mean anything.

## Where it breaks

1. **Bandwidth grows with N per client, so N² in total, and interest mode does not change that yet.** Per-client inbound
   is ~0.17 KB/s on the wire (~0.39 KB/s decoded) per online player in *both* modes: every moving player's row update reaches
   nearly every client. Extrapolated to 2000 players that is ~350 KB/s (~780 KB/s decoded) per client and ~700 MB/s
   (5.6 Gbit/s) of server egress, plus the client-side decode: 500 Node clients already needed ~5 cores. The reason interest
   mode saves little: the 5 x 5 block of 32-tile chunks is 160 x 160 tiles, and on the 256 map a block around a random Coast
   tile holds **~75 %** of all Coast tiles (so ~75 % of uniformly spread players). Measured against the same distribution,
   a 5 x 5 block of 16-tile chunks (80 tiles) holds ~30 %, 3 x 3 of 16 (48 tiles) ~16 %, 5 x 5 of 8 (40 tiles) ~12 %. To
   reach 2000, the block must shrink to tens of tiles, or player updates must be thinned (only changed columns, fewer
   per-tick writes of idle players), or both.
   (Done since: `player_pos` and an 80-tile player block, see "player_pos and the player block" below.)
2. **The tick is not the limit up to 500 players on main.** Tick interval p50 stays 600 ms, p95 within ~10 % of the target,
   and the whole server process used about 1 to 1.2 cores (all databases). Max intervals of ~1.2 s at N >= 250 coincided
   with machine-wide load spikes from other work. Reducer RTT stays under 10 ms median while the load generator keeps up.
3. **Fan-out lag shows up before the tick does.** Interest N=500 kept the tick on time but tick lag p95 was 650 ms and reducer
   RTT p95 490 ms, with load-generator CPU at 5 cores: per-transaction fan-out to 500 clients (and decoding it) is where the
   time goes. A cleaner measurement needs the load generator on another machine.
4. **Admission cap**: stock `MAX_ONLINE_PLAYERS = 256` refuses client 257 (the working tree now has 2048).

Server note: the local server logs at DEBUG (every connection and more goes to `.spacetime-data/server.log`), which costs
some CPU at high connection counts.

## player_pos and the player block (2026-10-19, long-season working tree)

What changed (spacetimedb/src/lib/playerStore.ts, shared/sim/interest.ts, frontend/src/spacetime/playerView.ts):

- A new public table `player_pos` { identity PK, region, x, z, facing, targetX?, targetZ?, lastInputTick, inputsThisTick }
  (btree on region, x, z) holds the columns that change for a step or an input. A row exists exactly while its character is
  online; the tick writes only this ~70-byte row for a walker, and `player` (~40 columns) only when another column changes.
  Server reads overlay it (`loadPlayer`, `overlay`, the tick's one scan of `player_pos`), writes split back (`storePlayer`);
  going offline folds the position into `player` and deletes the row; a database without rows gets them on the first tick.
- Interest: players by their own block, 5 x 5 chunks of 16 tiles (80 tiles, >= 16 tiles of margin), nodes and ground items
  keep 5 x 5 of 32. The player block is two queries: `player_pos` by box, and
  `SELECT p.* FROM player p JOIN player_pos q ON p.identity = q.identity WHERE <box on q>`. On 2.10 the join re-sends a player
  row only when that row changes or the character enters or leaves the box, never for a step (checked with
  `spacetime subscribe`, and `scripts/interest-check.ts`: a walking neighbour sends 12 player_pos updates and 0 player rows).
- Clients merge the two rows back (`playerView`): every hook and the agent gateway see `x`, `z`, `facing`, `targetX`,
  `targetZ` as before.

Before/after on the same content: "before" is the working tree with `player_pos` left out of the schema (playerStore then keeps
everything in `player`, as before) and the previous `interest.ts` (one 160-tile block, `player` rows by box), published as
`berigame-before`; "after" is the working tree, `berigame-scale`. Same machine and settings as the baseline (interest mode,
60 s after 10 s warmup, think 2500 ms, gzip, scatter, `--per-worker 50`), run back to back with nothing else on the server,
characters aged past first-spawn protection. Results: `frontend/scripts/loadtest/results/{before,split}-interest-*.json`.

| tree | N | ticks/s | tick interval p95 / max ms | tick lag p50 / p95 ms | per-client in, wire KB/s (decoded) | msgs/s per client | server egress MB/s wire | set_target RTT p50 / p95 ms | server CPU cores | load-gen CPU / loop p95 ms | observer row updates/s: player_pos / player |
|---|---|---|---|---|---|---|---|---|---|---|---|
| before | 100 | 1.67 | 602 / 609 | 16 / 30 | 8.3 (17.4) | 15 | 0.81 | 7 / 22 | 0.12 | 0.09 / 22 | - / 41 |
| after | 100 | 1.67 | 604 / 615 | 17 / 42 | 3.7 (6.0) | 9.5 | 0.36 | 8 / 29 | 0.12 | 0.07 / 23 | 22 / 1.4 |
| before | 250 | 1.67 | 602 / 602 | 25 / 36 | 19.8 (41.4) | 33 | 4.84 | 7 / 18 | 0.30 | 0.45 / 23 | - / 128 |
| after | 250 | 1.67 | 602 / 604 | 48 / 67 | 8.0 (13.1) | 19 | 1.95 | 8 / 33 | 0.35 | 0.28 / 22 | 49 / 4.8 |
| before | 500 | 1.67 | 601 / 603 | 59 / 91 | 39.6 (82.2) | 54 | 19.4 | 10 / 50 | 0.82 | 1.44 / 24 | - / 275 |
| after | 500 | 1.67 | 602 / 604 | 106 / 130 | 14.7 (24.4) | 30 | 7.2 | 12 / 104 | 0.76 | 0.96 / 23 | 126 / 9.7 |
| after (repeat) | 500 | 1.67 | 601 / 601 | 102 / 127 | 17.5 (29.8) | 34 | 8.6 | 10 / 100 | 0.79 | 1.08 / 23 | |
| before | 1000 | **0.19** | 6791 / 6791 | 1720 / 3584 | (14.7, starved) | 16 | 14.4 | 4961 / 6770 | 0.94 | 3.77 / **887** | |
| after | 1000 | **0.48** | 2968 / 3229 | 478 / 925 | (12.9, starved) | 28 | 12.6 | 2154 / 3037 | 1.30 | 3.17 / 60 | |

Per-client inbound grows by **0.028 KB/s wire (0.046 decoded) per online player** after, against 0.079 (0.16) before on the
same tree and 0.17 (0.39) on main 2a59ed6 (the baseline above): 2.8x less than the tree it replaces, 6x less than main. At
equal N the whole inbound is 2.2x (N=100) to 2.7x (N=500) smaller than before on this tree, and 5x to 6x smaller than main's
baseline rows. The tree it replaces had already stopped rewriting idle players' rows, so the part this change could still
take was the per-step whole-row re-send (a step now costs a viewer ~85 wire bytes instead of ~135: gzip already squeezed the
mostly-zero `player` row, the random 32-byte identity dominates both) and the audience (the 80-tile block holds ~2.2x fewer
players than the 160-tile one). The 1000 rows are server-bound (below), so their KB/s are not comparable.

Variants measured (same settings):

- `--player-block 16x1` (48 tiles, also >= 16 tiles of margin): 6.7 KB/s at N=250 and 11.3 at N=500 (1.2x to 1.3x less than
  16 x 2), but 6x the resubscribes (7020 vs 1101 per minute at N=500, each re-sending the whole new block) and the tick slipped
  (interval p95 733 ms, set_target p95 279 ms). Not worth it while a block moves as one subscription; per-chunk subscriptions
  would fix that but re-send a player row (and flash the avatar) at every chunk border. `results/split16x1-*.json`.
- `player` rows whole-table (`WHERE online = true`, `LOADTEST_PLAYER_ROWS=online`) instead of the join: 31.4 KB/s at N=500,
  2x the join's, since `player` rows still change on every harvest, swing and fight; but the join costs the server: tick lag
  p50 65 ms with whole-table rows against ~104 ms with the join (and ~59 before). `results/exp-onlinerows-interest-500.json`.

### 2000 players, extrapolated

| | per-client in, wire (decoded) | server egress, wire | |
|---|---|---|---|
| main baseline | ~350 KB/s (~780) | ~700 MB/s (5.6 Gbit/s) | |
| before, long-season | ~157 KB/s (~330) | ~315 MB/s (2.5 Gbit/s) | |
| after | **~57 KB/s (~93)** | **~115 MB/s (0.9 Gbit/s)** | linear fit 100..500: 0.95 + 0.028 N KB/s |

That assumes 2000 players spread like the bots (~30 % of them inside one 80-tile block); denser crowds cost more.

### What breaks next

1. **The database thread, not bandwidth.** At N=1000 the tick runs at 0.48/s after (0.19 before) with the server process at
   ~1.3 cores: SpacetimeDB runs one database's transactions on one thread, and ~400 reducer calls/s (1000 bots, one action per
   2.5 s) plus their subscription fan-out fill it (~2.5 ms each). Halving the action rate (`--think 5000`) brings the tick to
   1.08/s. One known cost: `blockedTiles(ctx)` (lib/blocked.ts) scans all ~1100 Long Season nodes on every set_target,
   start_harvest, pickup, attack_dummy, ... ("six rows, so recomputing per call is cheap" is no longer true). An experiment that
   reuses the tick's cached blocked set in reducers (not shipped: it needs safe invalidation when nodes change) doubled the tick
   at N=1000 to 0.93/s and cut set_target p50 from 2154 to 858 ms (`results/exp-blockedcache-interest-1000.json`). Per-reducer
   work, not the tick, is what has to shrink for 2000.
2. **Chat is still whole-table.** Every line is an insert plus a trim delete to every client: ~25 rows/s per client at N=500,
   ~100 rows/s at 2000 (estimated 6 to 8 KB/s per client and a message each). Area or channel chat would remove it.
3. **Every tile is still a row update to every viewer.** ~0.85 updates/s per player in the block. Further cuts: a smaller
   `player_pos` (region as a number, the input counter in a private table: ~20 of ~70 bytes), or fewer updates (clients
   extrapolating along a published path); both are schema or gameplay changes.
4. **Tick lag grows with the join.** The per-block join is evaluated for every changed `player_pos` row: tick lag p50 ~105 ms at
   N=500 against ~60 before.

## Cells: subscriptions SpacetimeDB can prune (2026-10-20, long-season working tree)

### Why the database thread was full

At N=1500 on the tree above, one database thread was busy for the whole 30 s window and the tick ran at a third of its rate.
About two thirds of that time was subscription evaluation (`txn_cpu_time_sec{txn_type="Update"}`), not module code, and the
server evaluated ~700 delta queries per transaction while only ~50 matched (`num_delta_queries_evaluated` / `_matched`).

SpacetimeDB 2.10 prunes subscription queries only by **one equality on one column** (`SearchArguments` in
`crates/core/src/subscription/module_subscription_manager.rs`, `PhysicalPlan::search_args`): a query with an index point
scan or a top-level `col = value` filter is filed under (table, column, value), and a changed row evaluates only the queries
filed under its own value. A join is pruned the same way through its other side's point lookup (`JoinEdge`). Every other
query sits in a per-table list evaluated for **every** changed row of that table. Boxes (`x >= .. AND x < ..`) are ranges,
and `region = 'bramblewild' AND <box>` is filed under the one value every Bramblewild client shares, so each walker's step
was checked against every distinct block of every client.

Checked directly: 200 clients each subscribing one distinct query on `world` (rewritten by every tick), 20 ticks:

| query | delta queries evaluated |
|---|---|
| `WHERE tick = <distinct>` | 0 |
| `WHERE tick > <distinct>` | 8,000 |
| `WHERE id = 0 AND tick > <distinct>` (pk point shared by all) | 8,000 |
| `WHERE online = <distinct> AND tick > 5` (unindexed equality inside an AND) | 8,000 |

### What changed

- **Cells** (`shared/sim/interest.ts`): every fast-changing row carries `cell: u32`, the id of the chunk it is in (region
  index, chunk z, chunk x; `0` = `GLOBAL_CELL`, rows about no place). `player_pos.cell` (btree) is on the player grid of
  27-tile chunks, `tree.cell` and `ground_item.cell` (btree, appended with default 0) on the node grid of 54-tile chunks, and
  `combat_event`, `dummy_event`, `emote_event`, `giant_event` got an appended `cell` on the player grid (0 for world-wide
  rows; the Giant's Announce / Wake / Sleep lines too). The server writes it wherever a position is written (`posOf` in
  `lib/playerStore.ts`, `dropOnGround`, `seedMissingNodes`, terrain repair, every event insert), and the tick repairs any
  stale one (a row from before the column, an owner SQL edit of x / z): player_pos while loading players, trees in
  `seedMissingNodes`, ground items in the expiry sweep.
- **One subscription per cell** (`frontend/src/spacetime/interestSubscription.ts` `CellSubscriptions`): `local:K` =
  `player_pos WHERE cell = K`, `player p JOIN player_pos q ... WHERE q.cell = K` and the four event tables `WHERE cell = K`
  for your 3 x 3 player block; `players:K` (no events) for the Meadows seam's; `nodes:K` = `tree` and `ground_item` for the
  3 x 3 node block. A block that moves keeps the cells it still covers and subscribes only the new ones; cells never share a
  row, so nothing is delivered twice and a walker crossing between two held cells arrives as one update (the SDK merges a
  transaction's deletes and inserts by primary key). World-wide events are `WHERE cell = 0` in `worldQueries`.
- **3 x 3 blocks of bigger cells** instead of 5 x 5: players 27-tile chunks (81 tiles, was 80), nodes 54 (162, was 160),
  with tile slack before a block recentres (11 and 22 tiles) so the guaranteed margins stay 16 and 32 tiles. Each cell is a
  subscription, which costs a transaction to add and to drop and a result per client per transaction, and bots wandering
  around one spot recentre a radius-1 block often unless it has slack (3.3 moves per 100 tiles walked with 5 tiles of slack,
  2.1 with 11). Place-bound events now use the player block (81 tiles; it was the 160-tile node box): an event is about a
  character or object there, and characters further away are not in your cache to show it on. Events are now per region
  too (a frontier fight no longer reaches Bramblewild clients standing at the same local tile).
- `ground_item.dropped_by` btree: your defeat-bag query (`dropped_by = :sender AND dropped_on_death = true`) was in the
  every-row list for each of N clients; the index makes it a point lookup.
- Module time: `send_chat` checked its three-second limit by hex-converting the sender of all 100 kept lines and then sorted
  them all to trim; it now reads the sender's lines through a new `chat_message.sender` btree and deletes the one oldest
  line (1.2 to 2.4 ms a call before, ~0.2 ms after). The tick's load glow read every online player's bag every 5 ticks; it now
  reads only bags written since (`lib/inventory.ts` `markLoad` in `writeSlots` and the death drop), characters whose state
  changed, and everyone once a minute (owner SQL edits). Walkers' area-key checks read the bag every step; the tick now
  keeps a per-instance copy dropped on any write. `carrying` (two lookups per walker per step) became one pass over the
  few expeditions per tick. `set_target` hands the route it searched to the tick (`lib/routes.ts`), which used to search it
  again. `canEnter` (pathfinding's innermost predicate) reads precomputed per-tile masks instead of evaluating the terrain
  and grove curves per neighbour. Position milestones skip the stats read once recorded.
- Unchanged by decision: inputs still write `player_pos` (target, input counter) at once. After pruning, `set_target`'s
  subscription work is 0.3 to 0.7 s per 30 s at 1000 to 1500 players (it was 5 to 9 s), so a private input table consumed by
  the tick would buy little and delay every viewer's sight of a new walk target by up to a tick. Chat stays world-wide: its
  fan-out is ~0.2 s per 30 s at N=1500 (`send_chat` Update), and the browser's Nearby filter already exists.

Schema changes and clients: appending `cell` to `tree`, `ground_item` and `player_pos` is `AddColumns` and changing the
four event tables is `ReschemaEventTable`; in 2.10 both make the publish **disconnect every client** (`auto_migrate.rs`
`ensure_disconnect_all_users`), and a browser on the old bundle cannot decode the new rows, so it must reload. This branch
already forces that (player_pos, the event tables' x / z). The new indexes (`*.cell`, `ground_item.dropped_by`,
`chat_message.sender`) are not breaking. Existing rows get cell 0 and the tick fills them in on its first run.

### How it was measured

`--view sink` (see "Subscription modes"): with every bot decoding its view, 1500 bots took 5 cores and their event loops
stalled by seconds once the tick ran at full rate; late bots then offered half the intended input rate, and the starved
server's per-operation costs looked 5 to 10x worse than they are (an isolated subscribe costs 0.02 to 0.15 ms). With sink
views the load generator used 2 to 3.5 cores, loop delay p95 under 35 ms up to N=1500.

"Before" is the tree as it stood (the box queries, `berigame-box`, published from the program the server had stored, with
`MAX_ONLINE_PLAYERS` raised to 4096), "after" this tree (`berigame-scale`, cap raised the same way for the runs and put back).
The before harness subscribes the box events the browser then had (`x = -1` world-wide, block box for the rest), which the
old harness did not, so its numbers are above the earlier table's. Same machine, interest mode, `--view sink`, gzip,
45 s after 10 s warmup, think 2500 ms, scatter, 125 bots per worker, run back to back. DB thread = sum of
`spacetime_txn_cpu_time_sec` over a 30 s window inside the measured one (one database runs its transactions on one thread,
so 30 s means saturated); evaluated = `num_delta_queries_evaluated`, per update transaction. The laptop was short of memory
and disk (14 of 15 GB swap in use, the data volume at 99 to 100 %; the server stopped once on "No space left on device"),
and results degraded run by run: the first N=2000 run held the tick, two later ones 85 and 89 %.
Results: `frontend/scripts/loadtest/results/cells-{before,after}-*.json` (`-nocomp`: `--compression none`; `-500-sdk`:
decoding bots, for the observer's row counts; the first after-2000 run has metrics only, its report crashed).

| tree | N | tick/s (of 1.67) | interval p95 / max ms | tick lag p50 / p95 ms | set_target RTT p50 / p95 ms | per-client wire KB/s mean / p95 | egress MB/s | DB thread s per 30 s: reducers / subscription updates / subscribe+unsubscribe = total | delta queries evaluated per update txn | tick (module + update) ms |
|---|---|---|---|---|---|---|---|---|---|---|
| before | 1000 | 1.67 (100 %) | 604 / 640 | 210 / 232 | 44 / 208 | 29.1 / 36.8 | 28.4 | 4.9 / 16.5 / 1.0 = **22.4** | 685 | 197 |
| after | 1000 | 1.67 (100 %) | 602 / 606 | 56 / 82 | 11 / 47 | 37.4 / 48.0 | 36.6 | 3.2 / 1.2 / 1.5 = **5.9** | 16 | 39 |
| before | 1500 | **0.94 (56 %)** | 1425 / 1902 | 368 / 432 | 584 / 1184 | (29.7, late ticks) | 43.5 | 6.2 / 22.3 / 1.5 = **30.0** | 695 | 333 |
| after | 1500 | **1.67 (100 %)** | 605 / 608 | 106 / 168 | 27 / 119 | 50.5 / 63.7 | 74.0 | 5.5 / 2.3 / 3.6 = **11.4** | 15 | 63 |
| before | 2000 | **0.39 (23 %)** | 4269 / 4269 | 598 / 761 | 1931 / 3605 | (22.1, late ticks) | 43.1 | 6.2 / 23.0 / 0.8 = **30.0** | 736 | 528 |
| after | 2000 | **1.67 (100 %)**, first run | (report lost to a harness bug, fixed) | | | | | 8.2 / 3.9 / 4.6 = **16.6** | 15 | 116 |
| after | 2000 | 1.42 (85 %), 1.49 (89 %), later runs | 940 / 1510, 1073 / 1193 | 735 / 2339, 1040 / 2128 | 319 / 2748 | 39.6 / 51.9 | 77 | 10.5 / 7.5 / 5.8 = 23.8, 25.5 | 17 | 222, 247 |
| before | 2500 | 0.11 (7 %) | 12447 | | 7402 / 11695 | | 22 | 30.2 (saturated) | 749 | 1050 |
| after | 2500 | 0.28 (17 %), 0.15 (9 %) | 10702, 7998 | | 11362 / 15242 | | 26 | 29.3, 32.8 (saturated) | 13, 10 | 1817, 2437 |

Bots act sooner when the server answers sooner (think time plus round trip), so the "after" rows carry 1 to 1.7x the input
rate of the "before" rows at the same N (N=1500: 17.6k reducer calls per 30 s against 14.6k).

Earlier, with the decoding harness, the same N=1500 measured 0.56/s before and 1.14/s after with the input rate held equal.
The N=2500 runs saturate both trees; the tick's own work is linear in the node harness (2.6 / 3.8 / 4.0 / 5.8 ms at 1000 /
2000 / 2500 / 3000 online), and every per-call cost in those runs was ~5x its N=2000 value, so this machine in that state
cannot say where 2500 lands.

### What it costs, and what limits next

1. **Per-client bandwidth is up ~30 %** at equal tick rate (N=1000: 37.4 against 29.1 KB/s wire, 70.9 against 50.7
   uncompressed), although clients receive fewer rows (an observer at N=500: player_pos updates 126/s against 157, combat
   events 2.2/s against 8.5). The bytes are (a) the `player` row of every visible walker re-sent at each cell border it crosses
   (the join moves it from one cell's result to the next; player.update 16.4/s against 12.2), (b) per-query-set framing in
   every transaction update (each cell with a change carries its set id, table names and row-list headers), and (c) the rows
   every cell subscribe and unsubscribe send (the SDK always asks for dropped rows). Fixes to try: the player-row join on a
   coarser grid than positions, or no join (whole `player` rows of the online, which change only on harvest, combat and
   gear); fewer, larger cells for nodes.
2. **Subscribe and unsubscribe** are now 30 to 40 % of the database thread at N=1500 to 2000 (11 to 14k transactions per
   30 s). Each block move is 3 cells on each grid; batching a move's cells into one subscription (simulated: 4x fewer
   transactions) holds 1.5x the cells, because a batch can only be dropped whole.
3. **The tick** is 63 to 116 ms per tick at 1500 to 2000 (module time plus its update), and set_target ~0.2 ms a call. The
   tick reads every online `player` and `player_pos` row, every tree, and each player's access grant every tick; caching
   them per module instance (dropped on write: `storePlayer` is the only writer of `player`) would remove most of the reads.
4. On this laptop the load generator and the server share 10 cores and a full disk; numbers at 2000 and up need the
   load generator on another machine (`--uri`).
