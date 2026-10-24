/**
 * One load-test worker process: holds a slice of the bots (SDK clients), runs
 * their behaviour, and reports measurements to the orchestrator (run.ts) over
 * IPC. Started by run.ts; exits when the orchestrator says stop or goes away.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { DbConnection, tables } from '../../src/module_bindings';
import type { Player } from '../../src/module_bindings/types';
import * as sim from '../../../shared/sim';
import {
  areaOf, bossNoPvpZone, chebyshev, EMOTE_LIST, Emote, GRID_SIZE, isLandTile, NODE_SEEDS, PlayerState, worldBlockedSet, tileKey,
} from '../../../shared/sim';
// Imported by path so the harness also runs against older trees (copy interest.ts in; see docs/LOAD_TEST.md).
import * as interest from '../../../shared/sim/interest';
import { nextInterestBlock, type InterestBlock } from '../../../shared/sim/interest';
import { mergePosition } from '../../src/spacetime/playerView';

/** Level-gated nodes (Long Season) are skipped by a level-1 bot; older trees have no gate. */
const levelGate = (kind: number) => (sim as any).nodeLevelRejection?.(kind, 1) ?? null;
/**
 * Trees with player_pos (spacetimedb/src/lib/playerStore.ts): positions in that narrow table, players subscribed
 * by their own (smaller) block. Older trees: one block, `player` rows by box.
 */
const SPLIT = !!(tables as any).playerPos;
/**
 * Trees with cell columns (shared/sim/interest.ts blockGroups): one subscription per cell, like the browser
 * (src/spacetime/interestSubscription.ts CellSubscriptions; bots never stand near the Meadows seam, so no seam
 * cells), events by cell plus the world-wide ones. Older trees: one box query per block.
 */
const CELLS: boolean = typeof (interest as any).blockGroups === 'function';
type Spec = { chunk: number; radius: number };
const NODE_SPEC: Spec | undefined = (interest as any).NODE_BLOCK;
import { countingWSFn, newCounters, type SocketCounters } from './socket';
import type { FromWorker, ToWorker, WorkerConfig, WorkerResult } from './protocol';

const cfg: WorkerConfig = JSON.parse(process.env.LOADTEST_CONFIG ?? '{}');
/** Cell trees, `--view sink`: each bot's cells on a second, undecoded connection (protocol.ts WorkerConfig.view). */
const SINK = cfg.mode === 'interest' && cfg.view === 'sink';
const PLAYER_SPEC: Spec | undefined = cfg.playerBlock
  ? { chunk: Number(cfg.playerBlock.split('x')[0]), radius: Number(cfg.playerBlock.split('x')[1]) }
  : (interest as any).PLAYER_BLOCK;
const send = (m: FromWorker) => process.send?.(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

// The SDK logs every connect at info level; keep the console readable at N=1000.
const log = console.log.bind(console);
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].includes('INFO')) return; log(...a); };

// The orchestrator owns our lifetime: if it dies, so do we (no orphaned sockets).
process.on('disconnect', () => process.exit(0));

// ---- measurement state ---------------------------------------------------------
let measuring = false;
let stopping = false;
const tickLagMs: number[] = [];
const tickLagAt: number[] = [];
const ticks: Array<[number, number, number]> = [];
const rttMs: Record<string, number[]> = {};
const outcomes: Record<string, number> = {};
const moveEffectMs: number[] = [];
let drops = 0;
let resubscribes = 0;
const rowEvents: Record<string, number> = {};
const loop = monitorEventLoopDelay({ resolution: 20 });

// ---- map knowledge --------------------------------------------------------------
const nodeBlocked = worldBlockedSet(NODE_SEEDS);
/** Coast tiles a scattered character can stand on: land, open, outside the Grove and the boss zones. */
const coastTiles: Array<{ x: number; z: number }> = [];
for (let x = 0; x < GRID_SIZE; x++) for (let z = 0; z < GRID_SIZE; z++) {
  const t = { x, z };
  if (isLandTile(t) && !nodeBlocked.has(tileKey(t)) && areaOf(t) === 'coast' && !bossNoPvpZone(t)) coastTiles.push(t);
}

function randomGoal(p: { x: number; z: number }, radius: number): { x: number; z: number } {
  const area = areaOf(p);
  for (let i = 0; i < 12; i++) {
    const t = { x: Math.round(p.x + rand(-radius, radius)), z: Math.round(p.z + rand(-radius, radius)) };
    if (t.x < 0 || t.z < 0 || t.x >= GRID_SIZE || t.z >= GRID_SIZE) continue;
    if (isLandTile(t) && !nodeBlocked.has(tileKey(t)) && areaOf(t) === area) return t;
  }
  return { x: p.x + (Math.random() < 0.5 ? 1 : -1), z: p.z };
}

const CHAT = ['hello', 'anyone near the coast', 'nice berries here', 'gg', 'wave if you see me', 'heading north', 'lag check', 'trade later?'];
const EMOTES = EMOTE_LIST.map((e) => e.id).filter((id) => id !== Emote.Sit);

// ---- bots ---------------------------------------------------------------------------
interface Bot {
  index: number;
  conn: DbConnection;
  me: any; // Identity
  meHex: string;
  counters: SocketCounters;
  base?: SocketCounters;
  alive: boolean;
  observer: boolean;
  block?: InterestBlock;
  spatial?: { unsubscribe(): void };
  /** Split trees: the player block and its subscription. */
  playerBlock?: InterestBlock;
  playerSub?: { unsubscribe(): void };
  /** Cell trees: one handle per held cell group. */
  cells?: Map<string, { unsubscribe(): void }>;
  /** SINK: the connection holding the cells (its updates are counted, never decoded), and its byte counters. */
  view?: DbConnection;
  viewCounters?: SocketCounters;
  viewBase?: SocketCounters;
  pendingMove?: { at: number; x: number; z: number };
  lastScatter: number;
  timer?: NodeJS.Timeout;
}

const bots: Bot[] = [];

function record(reducer: string, started: number, err?: unknown): void {
  if (!measuring) return;
  if (err === undefined) {
    (rttMs[reducer] ??= []).push(performance.now() - started);
    outcomes[`${reducer}: ok`] = (outcomes[`${reducer}: ok`] ?? 0) + 1;
  } else {
    const msg = String((err as any)?.message ?? err).replace(/0x[0-9a-f]+/gi, '<id>').replace(/\d+/g, '#').slice(0, 70);
    outcomes[`${reducer}: ${msg}`] = (outcomes[`${reducer}: ${msg}`] ?? 0) + 1;
  }
}

async function call(reducer: string, fn: () => Promise<unknown>): Promise<boolean> {
  const t0 = performance.now();
  try { await fn(); record(reducer, t0); return true; } catch (e) { record(reducer, t0, e); return false; }
}

/** Your character with its live position (player_pos on top of player, like src/spacetime/playerView.ts). */
function self(b: Bot): Player | undefined {
  const row = b.conn.db.player.identity.find(b.me) ?? undefined;
  return row && SPLIT ? mergePosition(row, (b.conn.db as any).playerPos.identity.find(b.me)) : row;
}

/** Every player row in the cache with its position. */
function* everyone(b: Bot): Iterable<Player> {
  const pos = SPLIT ? (b.conn.db as any).playerPos : undefined;
  for (const row of b.conn.db.player.iter()) yield pos ? mergePosition(row, pos.identity.find(row.identity)) : row;
}

/**
 * The player queries of a block (split trees). LOADTEST_PLAYER_ROWS=online swaps the join for the whole
 * `player WHERE online = true` (an experiment: what the per-block join costs the server).
 */
function playerBlockQueries(block: InterestBlock): string[] {
  const q = (interest as any).playerQueries(block) as Record<string, string>;
  if (process.env.LOADTEST_PLAYER_ROWS === 'online') return [q.player_pos, 'SELECT * FROM player WHERE online = true'];
  return Object.values(q);
}

function currentTick(b: Bot): number {
  for (const w of b.conn.db.world.iter()) return w.tick;
  return 0;
}

async function scatter(b: Bot, p: Player): Promise<void> {
  if (!cfg.ownerToken || Date.now() - b.lastScatter < 5_000) return;
  const a = areaOf(p);
  if (a !== 'grove' && a !== 'hedge') return;
  b.lastScatter = Date.now();
  const t = pick(coastTiles);
  // While online, the live position is the player_pos row (split trees); the player row's is the saved one.
  const sqls = [`UPDATE player SET x = ${t.x}, z = ${t.z} WHERE identity = 0x${b.meHex}`];
  // Cell trees: the cell too, so the row moves into the right cell's subscriptions at once (the tick would fix it next tick).
  const cell = CELLS ? `, cell = ${(interest as any).playerCell('bramblewild', t.x, t.z)}` : '';
  if (SPLIT) sqls.push(`UPDATE player_pos SET x = ${t.x}, z = ${t.z}${cell} WHERE identity = 0x${b.meHex}`);
  const url = new URL(`v1/database/${cfg.db}/sql`, cfg.uri.replace(/^ws/, 'http'));
  for (const sql of sqls) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${cfg.ownerToken}` }, body: sql });
      if (!res.ok) console.error(`[w${cfg.worker}] scatter failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    } catch (e) { console.error(`[w${cfg.worker}] scatter failed`, e); }
  }
}

function fullQueries(b: Bot): any[] {
  // Mirrors frontend/src/spacetime/connection.ts (plus subscribeFrontier's queries for the island).
  return [
    tables.world, tables.frontierView, tables.player, ...(SPLIT ? [(tables as any).playerPos] : []), tables.appearance, tables.tree, tables.groundItem, tables.chatMessage,
    tables.inventorySlot, tables.combatEvent, tables.trainingDummy, tables.dummyEvent, tables.emoteEvent, tables.inviteCode,
    tables.friend, tables.trade, tables.socialEvent, tables.giant, tables.giantEvent, tables.playerSkill, tables.playerCosmetic,
    tables.giantRaid, tables.mentorStat, tables.gardenPlot, tables.adventureProfile, tables.expedition, tables.expeditionMember,
    tables.islandProject, tables.gardenShowcase, tables.friendlyDuel, tables.bossConfig, tables.clatterhorn, tables.spireRun,
    tables.spireMember, tables.bossEvent, tables.bossNotice.where((row: any) => row.player.eq(b.me)),
    ...['config', 'claim', 'boat', 'creature'].map((k) => `SELECT * FROM frontier_object WHERE kind = '${k}'`),
    ...['building', 'crop', 'drop', 'resource'].map((k) => `SELECT * FROM frontier_object WHERE kind = '${k}' AND region = 'settlement'`),
  ];
}

/**
 * Interest mode: small or global tables whole, per-player tables narrowed to
 * your own rows, and player / tree / ground_item through the shared interest
 * block (resubscribed as you walk, see shared/sim/interest.ts).
 */
function interestBaseQueries(b: Bot): string[] {
  const id = `0x${b.meHex}`;
  // Events: the browser's split (world-wide rows here, the rest per cell or box); trees before player_pos: your own rows.
  const events = CELLS ? (interest as any).eventCellQueries((interest as any).GLOBAL_CELL) as string[] : SPLIT ? [
    'SELECT * FROM combat_event WHERE x = -1', 'SELECT * FROM dummy_event WHERE x = -1', 'SELECT * FROM emote_event WHERE x = -1',
    'SELECT * FROM giant_event WHERE x = -1 OR kind >= 7',
  ] : [
    `SELECT * FROM combat_event WHERE attacker = ${id}`,
    `SELECT * FROM combat_event WHERE defender = ${id}`,
    `SELECT * FROM dummy_event WHERE attacker = ${id}`,
    `SELECT * FROM emote_event WHERE player = ${id}`,
  ];
  return [
    'SELECT * FROM world', 'SELECT * FROM frontier_view', 'SELECT * FROM chat_message', 'SELECT * FROM inventory_slot',
    'SELECT * FROM training_dummy', 'SELECT * FROM invite_code', 'SELECT * FROM friend', 'SELECT * FROM trade', 'SELECT * FROM social_event',
    'SELECT * FROM giant', 'SELECT * FROM giant_raid', 'SELECT * FROM garden_plot', 'SELECT * FROM island_project', 'SELECT * FROM garden_showcase',
    'SELECT * FROM boss_config', 'SELECT * FROM clatterhorn', 'SELECT * FROM spire_run', 'SELECT * FROM expedition',
    `SELECT * FROM player WHERE identity = ${id}`,
    ...(SPLIT ? [`SELECT * FROM player_pos WHERE identity = ${id}`] : []),
    `SELECT * FROM appearance WHERE identity = ${id}`,
    `SELECT * FROM player_skill WHERE identity = ${id}`,
    `SELECT * FROM player_cosmetic WHERE identity = ${id}`,
    `SELECT * FROM adventure_profile WHERE identity = ${id}`,
    `SELECT * FROM mentor_stat WHERE identity = ${id}`,
    `SELECT * FROM expedition_member WHERE identity = ${id}`,
    `SELECT * FROM spire_member WHERE identity = ${id}`,
    `SELECT * FROM friendly_duel WHERE a = ${id}`,
    `SELECT * FROM friendly_duel WHERE b = ${id}`,
    ...events,
    ...(SPLIT ? ['SELECT * FROM ground_item WHERE dropped_by = :sender AND dropped_on_death = true'] : []),
    `SELECT * FROM boss_notice WHERE player = ${id}`,
    'SELECT * FROM boss_event',
    "SELECT * FROM frontier_object WHERE kind = 'config'",
  ];
}

/**
 * Node block queries (older trees: the one block, players included). Box trees with player_pos: also the block's
 * local event rows, as the browser had them (src/spacetime/interestSubscription.ts before cells).
 */
function nodeQueries(block: InterestBlock): string[] {
  const out = Object.values((interest as any).interestQueries(block) as Record<string, string | null>).filter((q): q is string => !!q);
  if (!SPLIT || !out.length) return out;
  const box = (interest as any).boxSql(block) as string;
  return [...out, ...['combat_event', 'dummy_event', 'emote_event'].map((t) => `SELECT * FROM ${t} WHERE ${box}`),
    `SELECT * FROM giant_event WHERE kind < 7 AND ${box}`];
}

/** Make-before-break: the new handle first, the old one dropped once it is applied (SINK: at once, nothing is applied). */
function swap(b: Bot, old: { unsubscribe(): void } | undefined, qs: string[], onApplied?: () => void) {
  if (b.view) {
    try { old?.unsubscribe(); } catch { /* already ended */ }
    const h = b.view.subscriptionBuilder().subscribe(qs);
    onApplied?.();
    return h;
  }
  return b.conn.subscriptionBuilder()
    .onApplied(() => { try { old?.unsubscribe(); } catch { /* already ended */ } onApplied?.(); })
    .onError((_c, e) => console.error(`[w${cfg.worker}] bot ${b.index} interest subscription failed`, String(e)))
    .subscribe(qs);
}

/** Cell trees: the groups of the node and player blocks around `p` (nodes, players, events). */
function cellGroupsAt(b: Bot, p: { region?: string; x: number; z: number }): Map<string, string[]> | undefined {
  const block = nextInterestBlock(p, b.block, NODE_SPEC);
  const players = nextInterestBlock(p, b.playerBlock, PLAYER_SPEC);
  if (block === b.block && players === b.playerBlock && b.cells) return undefined;
  b.block = block; b.playerBlock = players;
  const groups = (interest as any).blockGroups as (bl: InterestBlock, kind: string) => Map<string, string[]>;
  return new Map([...groups(block, 'nodes'), ...groups(players, 'local')]);
}

/** Hold exactly `groups`: keep the cells still wanted, subscribe new ones, drop the rest. Calls `onApplied` once all new ones are. */
function setCells(b: Bot, groups: Map<string, string[]>, onApplied?: () => void, onError?: (e: unknown) => void): void {
  const held = (b.cells ??= new Map());
  for (const [k, h] of held) if (!groups.has(k)) { held.delete(k); try { h.unsubscribe(); } catch { /* ended */ } }
  let pending = 0;
  const one = () => { if (--pending === 0) onApplied?.(); };
  const conn = b.view ?? b.conn;
  for (const [k, qs] of groups) {
    if (held.has(k)) continue;
    pending++;
    held.set(k, conn.subscriptionBuilder()
      .onApplied(one)
      .onError((_c, e) => { console.error(`[w${cfg.worker}] bot ${b.index} cell ${k} failed`, String(e)); onError?.(e); one(); })
      .subscribe(qs));
  }
  // A sink connection never decodes its SubscribeApplied: nothing to wait for.
  if (pending === 0 || b.view) onApplied?.();
}

function resubscribeInterest(b: Bot, p: { region?: string; x: number; z: number }): void {
  if (SINK && !b.view) return; // the view connection is still opening: it subscribes where you are then
  if (CELLS) {
    const groups = cellGroupsAt(b, p);
    if (!groups) return;
    if (measuring) resubscribes++;
    setCells(b, groups);
    return;
  }
  const next = SPLIT ? nextInterestBlock(p, b.block, NODE_SPEC) : nextInterestBlock(p, b.block);
  if (next !== b.block) {
    b.block = next;
    if (measuring) resubscribes++;
    const qs = nodeQueries(next);
    if (qs.length) b.spatial = swap(b, b.spatial, qs);
  }
  if (!SPLIT) return;
  const players = nextInterestBlock(p, b.playerBlock, PLAYER_SPEC);
  if (players === b.playerBlock) return;
  b.playerBlock = players;
  if (measuring) resubscribes++;
  b.playerSub = swap(b, b.playerSub, playerBlockQueries(players));
}

/** SINK: the bot's second connection (same identity), for its cell subscriptions only. */
function openView(b: Bot, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const counters = newCounters();
    const timer = setTimeout(() => reject(new Error('view connect timeout')), cfg.connectTimeoutMs);
    DbConnection.builder()
      .withUri(cfg.uri).withDatabaseName(cfg.db).withToken(token).withCompression(cfg.compression)
      .withWSFn(countingWSFn(counters, true) as any)
      .onConnectError((_ctx, err) => { clearTimeout(timer); reject(err); })
      .onConnect((conn) => { clearTimeout(timer); b.view = conn; b.viewCounters = counters; resolve(); })
      .build();
  });
}

/** SINK: what each bot last knew of its own position, for its worker's fight choices. */
const known = new Map<number, { identity: any; x: number; z: number; alive: boolean }>();

function connectBot(index: number, token: string | undefined, observer: boolean): Promise<Bot> {
  return new Promise((resolve, reject) => {
    const counters = newCounters();
    let settled = false;
    const done = (err?: unknown, bot?: Bot) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(bot!);
    };
    const timer = setTimeout(() => done(new Error('connect timeout')), cfg.connectTimeoutMs);
    let bot: Bot | undefined;
    DbConnection.builder()
      .withUri(cfg.uri)
      .withDatabaseName(cfg.db)
      .withToken(token)
      .withCompression(cfg.compression)
      .withWSFn(countingWSFn(counters) as any)
      .onConnectError((_ctx, err) => done(err))
      .onDisconnect(() => {
        if (bot) { bot.alive = false; if (measuring && !stopping) drops++; if (bot.timer) clearTimeout(bot.timer); }
        done(new Error(bot ? 'disconnected before subscription applied'
          : 'closed by server before connect (client_connected refused: world full / admission?)'));
      })
      .onConnect((conn, identity, tok) => {
        bot = { index, conn, me: identity, meHex: identity.toHexString(), counters, alive: true, observer, lastScatter: 0 };
        const b = bot;
        conn.db.world.onUpdate((_ctx, _old, row) => {
          if (!measuring) return;
          const now = Date.now();
          const started = Number(row.tickStartedAt.microsSinceUnixEpoch / 1000n);
          tickLagMs.push(now - started);
          tickLagAt.push(now);
          if (b.observer) ticks.push([row.tick, started, now]);
        });
        // Your own moves: player_pos updates on split trees (the player row is not rewritten for a step).
        const myId = (identity as any).__identity__;
        const moved = (old: { x: number; z: number }, row: { x: number; z: number }) => {
          if (b.pendingMove && (row.x !== old.x || row.z !== old.z)) {
            if (measuring) moveEffectMs.push(performance.now() - b.pendingMove.at);
            b.pendingMove = undefined;
          }
          if (cfg.mode === 'interest') { const p = self(b); if (p) resubscribeInterest(b, p); }
        };
        if (SPLIT) {
          (conn.db as any).playerPos.onUpdate((_ctx: unknown, old: any, row: any) => { if (row.identity.__identity__ === myId) moved(old, row); });
          (conn.db as any).playerPos.onInsert((_ctx: unknown, row: any) => { if (row.identity.__identity__ === myId) moved(row, row); });
        }
        conn.db.player.onUpdate((_ctx, old, row) => {
          if (row.identity.__identity__ !== myId) return;
          moved(old, row);
        });
        // The observer counts row callbacks per table: which tables the inbound bytes are made of.
        if (observer) {
          for (const [name, t] of Object.entries(conn.db as Record<string, any>)) {
            if (!t || typeof t.onInsert !== 'function') continue;
            const bump = (k: string) => () => { if (measuring) rowEvents[`${name}.${k}`] = (rowEvents[`${name}.${k}`] ?? 0) + 1; };
            t.onInsert(bump('insert')); t.onDelete?.(bump('delete')); t.onUpdate?.(bump('update'));
          }
        }
        (b as any).token = tok;
        const ready = () => done(undefined, b);
        if (cfg.mode === 'full') {
          conn.subscriptionBuilder()
            .onApplied(ready)
            .onError((_c, e) => done(new Error(`subscription failed: ${String(e)}`)))
            .subscribe(fullQueries(b));
        } else {
          conn.subscriptionBuilder()
            .onApplied(() => {
              const p = self(b);
              if (!p) { done(new Error('own player row missing')); return; }
              if (CELLS) {
                const cells = () => {
                  const groups = cellGroupsAt(b, self(b) ?? p);
                  if (groups) setCells(b, groups, ready, (e) => done(new Error(`cell subscription failed: ${String(e)}`))); else ready();
                };
                if (!SINK) { cells(); return; }
                openView(b, tok).then(cells, (e) => done(new Error(`view connection failed: ${String(e)}`)));
                return;
              }
              if (SINK && !b.view) {
                openView(b, tok).then(() => { b.block = undefined; b.playerBlock = undefined; resubscribeInterest(b, self(b) ?? p); ready(); },
                  (e) => done(new Error(`view connection failed: ${String(e)}`)));
                return;
              }
              b.block = SPLIT ? nextInterestBlock(p, undefined, NODE_SPEC) : nextInterestBlock(p);
              const qs = [...nodeQueries(b.block)];
              if (SPLIT) {
                b.playerBlock = nextInterestBlock(p, undefined, PLAYER_SPEC);
                // Players in their own handle, so the two blocks move independently.
                b.playerSub = conn.subscriptionBuilder()
                  .onError((_c, e) => done(new Error(`player interest subscription failed: ${String(e)}`)))
                  .subscribe(playerBlockQueries(b.playerBlock));
              }
              b.spatial = conn.subscriptionBuilder()
                .onApplied(ready)
                .onError((_c, e) => done(new Error(`interest subscription failed: ${String(e)}`)))
                .subscribe(qs);
            })
            .onError((_c, e) => done(new Error(`subscription failed: ${String(e)}`)))
            .subscribe(interestBaseQueries(b));
        }
      })
      .build();
  });
}

// ---- behaviour ------------------------------------------------------------------------
const WEIGHTS: Array<[string, number]> = [['walk', 0.5], ['harvest', 0.25], ['fight', 0.1], ['emote', 0.08], ['chat', 0.07]];

function choose(): string {
  let r = Math.random();
  for (const [k, w] of WEIGHTS) { if ((r -= w) <= 0) return k; }
  return 'walk';
}

async function decide(b: Bot): Promise<void> {
  const p = self(b);
  if (!p) return;
  if (p.state !== PlayerState.Alive) return;
  if (cfg.ownerToken && (areaOf(p) === 'grove' || areaOf(p) === 'hedge')) { await scatter(b, p); return; }
  const action = choose();
  if (SINK) known.set(b.index, { identity: p.identity, x: p.x, z: p.z, alive: p.state === PlayerState.Alive });
  if (SINK && action === 'harvest') {
    // No tree rows decoded: the nearest seeded node in reach (the server queues or refuses as it would anyone).
    let best: { id: number; d: number } | undefined;
    for (const t of NODE_SEEDS) {
      const d = chebyshev(p, t);
      if (d > 12 || (best && d >= best.d) || levelGate(t.kind)) continue;
      best = { id: t.id, d };
    }
    if (best) { const id = best.id; await call('startHarvest', () => b.conn.reducers.startHarvest({ treeId: id })); return; }
  }
  if (SINK && action === 'fight') {
    // Only this worker's bots are known: look sqrt(all / this worker's) times as far (10 tiles), for the same odds.
    let best: { target: any; d: number } | undefined;
    const reach = 10 * Math.sqrt(Math.max(1, (cfg.totalBots ?? cfg.bots.length) / Math.max(1, cfg.bots.length)));
    for (const [i, o] of known) {
      if (i === b.index || !o.alive) continue;
      const d = chebyshev(p, o);
      if (d > reach || (best && d >= best.d)) continue;
      best = { target: o.identity, d };
    }
    if (best) { const target = best.target; await call('attack', () => b.conn.reducers.attack({ target })); return; }
  }
  if (!SINK && action === 'harvest') {
    const T = currentTick(b);
    let best: { id: number; d: number } | undefined;
    for (const t of b.conn.db.tree.iter()) {
      if (t.harvester !== undefined || t.cooldownUntilTick > T) continue;
      const d = chebyshev(p, t);
      if (d > 12 || (best && d >= best.d) || levelGate(t.kind)) continue;
      best = { id: t.id, d };
    }
    if (best) { const id = best.id; await call('startHarvest', () => b.conn.reducers.startHarvest({ treeId: id })); return; }
  }
  if (!SINK && action === 'fight') {
    let best: { target: any; d: number } | undefined;
    for (const o of everyone(b)) {
      if (!o.online || o.state !== PlayerState.Alive || o.identity.isEqual(b.me)) continue;
      const d = chebyshev(p, o);
      if (d > 10 || (best && d >= best.d)) continue;
      best = { target: o.identity, d };
    }
    if (best) { const target = best.target; await call('attack', () => b.conn.reducers.attack({ target })); return; }
  }
  if (action === 'emote') { await call('emote', () => b.conn.reducers.emote({ emote: pick(EMOTES) })); return; }
  if (action === 'chat') { await call('sendChat', () => b.conn.reducers.sendChat({ text: pick(CHAT) })); return; }
  // walk (also the fallback when no node or opponent is near)
  const goal = randomGoal(p, 24);
  b.pendingMove = { at: performance.now(), x: goal.x, z: goal.z };
  await call('setTarget', () => b.conn.reducers.setTarget(goal));
}

function schedule(b: Bot): void {
  b.timer = setTimeout(async () => {
    if (!b.alive || stopping) return;
    try { await decide(b); } catch (e) { console.error(`[w${cfg.worker}] bot ${b.index}`, e); }
    schedule(b);
  }, rand(cfg.thinkMs * 0.5, cfg.thinkMs * 1.5));
}

// ---- lifecycle ----------------------------------------------------------------------------
let cpuStart = process.cpuUsage();
let measureStart = 0;

process.on('message', async (m: ToWorker) => {
  if (m.type === 'measure') {
    for (const b of bots) { b.base = { ...b.counters }; if (b.viewCounters) b.viewBase = { ...b.viewCounters }; }
    cpuStart = process.cpuUsage();
    loop.reset();
    loop.enable();
    measureStart = Date.now();
    measuring = true;
  } else if (m.type === 'stop') {
    measuring = false;
    stopping = true;
    const measuredMs = Date.now() - measureStart;
    const cpu = process.cpuUsage(cpuStart);
    const result: WorkerResult = {
      type: 'result', worker: cfg.worker, measuredMs,
      clients: bots.map((b) => {
        const base = b.base ?? newCounters();
        const v = b.viewCounters ?? newCounters(), vb = b.viewBase ?? newCounters();
        // A bot's bytes are both of its connections' (the view's are what a browser would decode).
        return {
          index: b.index, alive: b.alive,
          wireIn: b.counters.wireIn - base.wireIn + v.wireIn - vb.wireIn, rawIn: b.counters.rawIn - base.rawIn + v.rawIn - vb.rawIn,
          msgsIn: b.counters.msgsIn - base.msgsIn + v.msgsIn - vb.msgsIn,
          wireOut: b.counters.wireOut - base.wireOut + v.wireOut - vb.wireOut, msgsOut: b.counters.msgsOut - base.msgsOut + v.msgsOut - vb.msgsOut,
        };
      }),
      tickLagMs, tickLagAt, ticks, rttMs, outcomes, moveEffectMs, drops, resubscribes, rowEvents,
      cpuMs: (cpu.user + cpu.system) / 1000,
      loopDelayP95Ms: loop.percentile(95) / 1e6,
    };
    send(result);
    for (const b of bots) { if (b.timer) clearTimeout(b.timer); try { b.conn.disconnect(); } catch { /* closed */ } try { b.view?.disconnect(); } catch { /* closed */ } }
    setTimeout(() => process.exit(0), 1_500);
  }
});

async function main(): Promise<void> {
  const queue = [...cfg.bots];
  let first = true;
  while (queue.length) {
    const batch = queue.splice(0, cfg.batch);
    await Promise.all(batch.map(async ({ index, token }) => {
      const t0 = Date.now();
      try {
        const b = await connectBot(index, token, first && (first = false, true));
        bots.push(b);
        send({ type: 'connected', index, ok: true, token: (b as any).token, ms: Date.now() - t0 });
        try { await b.conn.reducers.setName({ name: `lt${index}` }); } catch { /* name taken etc */ }
        schedule(b);
      } catch (e) {
        send({ type: 'connected', index, ok: false, error: String((e as any)?.message ?? e).slice(0, 120), ms: Date.now() - t0 });
      }
    }));
    if (queue.length) await sleep(cfg.batchMs);
  }
  // Make sure an observer exists even if the first bot failed.
  if (bots.length && !bots.some((b) => b.observer)) bots[0].observer = true;
  send({ type: 'ready', worker: cfg.worker });
}

main().catch((e) => { console.error(`[w${cfg.worker}] fatal`, e); process.exit(1); });
