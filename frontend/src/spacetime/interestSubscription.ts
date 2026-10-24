// Relative (not @sim) so node scripts and the agent gateway can load this file too.
import { EVENT_TABLES, GLOBAL_CELL, NODE_BLOCK, PLAYER_BLOCK, blockGroups, eventCellQueries, nextInterestBlock, type InterestBlock } from '../../../shared/sim/interest';
import { MEADOW_OFFSET, isHomeRegion } from '../../../shared/sim/frontier/homeMap';
import { notePlayerName } from './playerNames';
import { playerView } from './playerView';

/*
 * Interest-managed world subscriptions (shared/sim/interest.ts).
 *
 * The fast-changing spatial tables (player_pos with its player rows, tree,
 * ground_item, the place-bound event tables) are not subscribed whole: each
 * client holds a block of cells around itself per kind (players and events 5 x
 * 5 cells of 16 tiles, nodes 5 x 5 of 32; shared/sim/interest.ts), plus the
 * joined district's blocks near the Meadows seam, one subscription per cell
 * (CellSubscriptions). On top of that it keeps a few small identity-keyed
 * queries for rows it needs wherever they are: its own row (`identity =
 * :sender`), its combat or follow target and duel and trade partners, its
 * friends (online status, mentor badge), its expedition crew and Spire party,
 * and one-shot name lookups for chat senders it has never seen, each with its
 * player_pos row (its live position). Your own rows are in
 * worldSubscription.ts. (A join on the RLS-narrowed trade table is refused:
 * the server wants indexes on both sides of the join.)
 *
 * Each identity-keyed group of queries is a QuerySlot. Changing a slot
 * subscribes the new queries first and drops the old handle only once the new
 * one is applied, so rows in both are never deleted and re-inserted: the SDK
 * reference-counts rows per subscription. Cells need little such care: two
 * cells never hold the same row, so a block that moves keeps the cells it
 * still covers, subscribes the new ones and drops the rest at once (an event
 * row is never delivered twice), and a character walking from one held cell
 * into another arrives as one update (the SDK merges a transaction's deletes
 * and inserts by primary key across subscriptions). Only a cell that stays
 * but changes kind (crossing the Meadows seam, your player cells gain or lose
 * their events) is replaced make-before-break; the two never both carry
 * events.
 */

export type Handle = { unsubscribe(): void };
type Builder = {
  onApplied(cb: (ctx: any) => void): Builder;
  onError(cb: (ctx: any, err?: unknown) => void): Builder;
  subscribe(queries: string[]): Handle;
};
export interface SubscribeConn { subscriptionBuilder(): Builder }

function drop(handle: Handle | undefined): void {
  try { handle?.unsubscribe(); } catch { /* already ended */ }
}

/**
 * One named group of queries, replaced make-before-break: the new handle
 * first, the old one dropped once the new one is applied.
 */
export class QuerySlot {
  private key = '';
  private current: Handle | undefined;
  /** Handles to drop once `current` is applied. */
  private retiring: Handle[] = [];
  applied = false;

  constructor(private conn: SubscribeConn, private onError: (queries: readonly string[]) => void, private onApplied?: () => void) {}

  get queries(): string[] { return this.key ? this.key.split('\n') : []; }

  set(queries: readonly string[]): void {
    const key = queries.join('\n');
    if (key === this.key) return;
    this.key = key;
    if (this.current) this.retiring.push(this.current);
    this.current = undefined;
    if (!queries.length) this.retire();
    if (!queries.length) return;
    let handle: Handle | undefined;
    const list = [...queries];
    handle = this.conn.subscriptionBuilder()
      .onApplied(() => {
        if (handle !== this.current) return;
        this.applied = true;
        this.retire();
        this.onApplied?.();
      })
      .onError(() => this.onError(list))
      .subscribe(list);
    this.current = handle;
  }

  private retire(): void {
    const old = this.retiring;
    this.retiring = [];
    for (const h of old) drop(h);
  }

  dispose(): void {
    this.retire();
    drop(this.current);
    this.current = undefined;
    this.key = '';
  }
}

/**
 * One subscription per cell group (shared/sim/interest.ts blockGroups keys):
 * `set` keeps the groups still wanted, subscribes the new ones and drops the
 * rest. `applied` once every held group is applied (or failed: a failed cell
 * must not hold the loading screen forever).
 */
export class CellSubscriptions {
  /** `retire`: the handle this group replaces (same cell, another kind), dropped once this one is applied. */
  private held = new Map<string, { handle?: Handle; retire?: Handle; applied: boolean; queries: string[] }>();

  constructor(private conn: SubscribeConn, private onError: (queries: readonly string[]) => void, private onApplied?: () => void) {}

  get applied(): boolean {
    for (const g of this.held.values()) if (!g.applied) return false;
    return true;
  }

  get size(): number { return this.held.size; }

  /** The queries held for groups whose key starts with `prefix` (`nodes:`, `local:`, `players:`), in key order. */
  queries(prefix = ''): string[] {
    return [...this.held.keys()].filter((k) => k.startsWith(prefix)).sort().flatMap((k) => this.held.get(k)!.queries);
  }

  set(groups: ReadonlyMap<string, readonly string[]>): void {
    // A player cell held as `local` (yours, with events) or `players` (the seam's): the same cell either way.
    // Node cells number another grid, so they never pair with these.
    const cellOf = (key: string) => (key.startsWith('local:') || key.startsWith('players:') ? key.slice(key.indexOf(':') + 1) : key);
    const adding = new Map<string, string>(); // cell -> new key
    for (const key of groups.keys()) if (!this.held.has(key)) adding.set(cellOf(key), key);
    /** Groups whose cell comes back under another key (a seam crossing): dropped once that one is applied. */
    const swapped = new Map<string, Handle | undefined>();
    for (const [key, g] of this.held) {
      if (groups.has(key)) continue;
      this.held.delete(key);
      drop(g.retire);
      const by = adding.get(cellOf(key));
      if (by) swapped.set(by, g.handle); else drop(g.handle);
    }
    for (const [key, queries] of groups) {
      if (this.held.has(key) || !queries.length) continue;
      const g: { handle?: Handle; retire?: Handle; applied: boolean; queries: string[] } = { applied: false, queries: [...queries], retire: swapped.get(key) };
      this.held.set(key, g);
      const done = () => {
        if (this.held.get(key) !== g || g.applied) return;
        drop(g.retire);
        g.retire = undefined;
        g.applied = true;
        this.onApplied?.();
      };
      g.handle = this.conn.subscriptionBuilder()
        .onApplied(done)
        .onError(() => { this.onError(g.queries); done(); })
        .subscribe(g.queries);
    }
  }

  dispose(): void {
    for (const g of this.held.values()) { drop(g.retire); drop(g.handle); }
    this.held.clear();
  }
}

// ---- Planning (pure) --------------------------------------------------------------

export interface Presence { region?: string; x: number; z: number }

/** Your position in the other home district's local coordinates (the Meadows seam), or null away from home. */
export function seamPoint(me: Presence): Presence | null {
  const region = me.region || 'bramblewild';
  if (!isHomeRegion(region)) return null;
  return region === 'bramblewild'
    ? { region: 'settlement', x: me.x - MEADOW_OFFSET.x, z: me.z - MEADOW_OFFSET.z }
    : { region: 'bramblewild', x: me.x + MEADOW_OFFSET.x, z: me.z + MEADOW_OFFSET.z };
}

/** Node blocks (`home`, `seam`) and player blocks (`players`, `playersSeam`). */
export interface Blocks { home?: InterestBlock; seam?: InterestBlock; players?: InterestBlock; playersSeam?: InterestBlock }

/**
 * The blocks to hold for a client at `me`, for nodes and for players: its own
 * district's, and the other home district's while that one's block is not
 * empty, i.e. within about two chunks of the seam, where the embedded Meadows
 * (or Bramblewild) is mounted and its players and nodes can be on screen
 * (homePresence.ts shouldMountMeadows mounts from 80 tiles). All keep their
 * hysteresis.
 */
export function nextBlocks(me: Presence | null, current: Blocks = {}): Blocks {
  if (!me) return {};
  const point = seamPoint(me);
  return {
    home: nextInterestBlock(me, current.home, NODE_BLOCK),
    seam: point ? nextInterestBlock(point, current.seam, NODE_BLOCK) : undefined,
    players: nextInterestBlock(me, current.players, PLAYER_BLOCK),
    playersSeam: point ? nextInterestBlock(point, current.playersSeam, PLAYER_BLOCK) : undefined,
  };
}

/** Event tables filtered by cell (shared/sim/interest.ts EVENT_TABLES); a table missing here is subscribed whole. */
export const POSITIONED_EVENT_TABLES: readonly string[] = EVENT_TABLES;

/**
 * Every cell group to hold for `blocks`: the node cells (yours and the seam's),
 * and the player cells (yours and the seam's), yours with their events (the
 * seam district's events are in its own local coordinates, which the
 * embedded view does not place).
 */
export function cellGroups(blocks: Blocks): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (m: Map<string, string[]>) => { for (const [k, v] of m) out.set(k, v); };
  add(blockGroups(blocks.home, 'nodes'));
  add(blockGroups(blocks.seam, 'nodes'));
  // Your own player cells with their events (one subscription each), the seam's without.
  add(blockGroups(blocks.players, 'local'));
  add(blockGroups(blocks.playersSeam, 'players'));
  return out;
}

/** The always-on part of the positioned event tables: world-wide rows (GLOBAL_CELL). */
export function globalEventQueries(tables: readonly string[] = POSITIONED_EVENT_TABLES): string[] {
  return eventCellQueries(GLOBAL_CELL, tables);
}

const HEX = /^[0-9a-f]{64}$/;
/** An identity literal for SQL; null for anything that is not a 32-byte hex identity. */
export function identityLiteral(hex: string): string | null {
  const h = hex.toLowerCase().replace(/^0x/, '');
  return HEX.test(h) ? `0x${h}` : null;
}

/** Player rows (and their live positions) by identity, plus `extra` tables keyed the same way. Sorted, so the same set gives the same text. */
export function identityQueries(hexes: Iterable<string>, extra: readonly string[] = [], positions = true): string[] {
  const out: string[] = [];
  for (const hex of [...new Set(hexes)].sort()) {
    const lit = identityLiteral(hex);
    if (!lit) continue;
    out.push(`SELECT * FROM player WHERE identity = ${lit}`);
    if (positions) out.push(`SELECT * FROM player_pos WHERE identity = ${lit}`);
    for (const t of extra) out.push(`SELECT * FROM ${t} WHERE identity = ${lit}`);
  }
  return out;
}

/** Your expedition crew's and Spire party's player rows and positions, wherever they are. */
export function partyQueries(expeditionId: bigint | null, spireRunId: bigint | null): string[] {
  const out: string[] = [];
  const both = (table: string, where: string) => {
    out.push(`SELECT p.* FROM player p JOIN ${table} m ON p.identity = m.identity WHERE ${where}`);
    out.push(`SELECT q.* FROM player_pos q JOIN ${table} m ON q.identity = m.identity WHERE ${where}`);
  };
  if (expeditionId !== null) both('expedition_member', `m.expedition_id = ${expeditionId.toString()}`);
  if (spireRunId !== null) both('spire_member', `m.run_id = ${spireRunId.toString()}`);
  return out;
}

// ---- The manager ------------------------------------------------------------------

type Row = Record<string, any>;
type TableLike = {
  iter(): Iterable<Row>;
  onInsert(cb: (ctx: unknown, row: Row) => void): void;
  onDelete(cb: (ctx: unknown, row: Row) => void): void;
  onUpdate?(cb: (ctx: unknown, prev: Row, row: Row) => void): void;
  removeOnInsert(cb: unknown): void;
  removeOnDelete(cb: unknown): void;
  removeOnUpdate?(cb: unknown): void;
};
export interface InterestConn extends SubscribeConn {
  db: Record<string, TableLike | undefined>;
}

const hexOf = (id: any): string => (typeof id?.toHexString === 'function' ? id.toHexString() : String(id ?? ''));
const idValue = (id: any): unknown => id?.__identity__ ?? hexOf(id);

/** Max one-shot name lookups in flight (chat keeps CHAT_KEEP_ROWS lines). */
const NAME_BATCH = 64;

export interface InterestManager {
  /** The blocks held now (tests, debugging). */
  blocks(): Blocks;
  /** Every query currently held, by slot. */
  snapshot(): Record<string, string[]>;
  /** Ask for players' names by identity (one-shot lookups for ones not seen yet). */
  wantNames(hexes: Iterable<string>): void;
  /** Calls `cb` once your nearby block has been applied (at once if there is nothing to wait for). */
  whenReady(cb: () => void): void;
  dispose(): void;
}

/**
 * Follow your own row, friend list, duels, crew and party, and keep the
 * interest slots in step. `myHex` is your identity (`toHexString()`).
 */
export function startInterest(conn: InterestConn, myHex: string, onError: (queries: readonly string[]) => void = () => {}): InterestManager {
  const db = conn.db;
  let myId: unknown;
  const mine = (id: any) => (myId !== undefined ? idValue(id) === myId : hexOf(id) === myHex);
  let ready = false;
  const waiting: (() => void)[] = [];
  const flushReady = () => { if (ready) return; ready = true; for (const cb of waiting.splice(0)) cb(); };

  // Ready once every nearby cell (nodes, players, events; yours and the seam's) is applied or has failed.
  const checkReady = () => { if (cells.size && cells.applied) flushReady(); };
  const cells = new CellSubscriptions(conn, onError, () => checkReady());
  const focus = new QuerySlot(conn, onError);
  const friends = new QuerySlot(conn, onError);
  const party = new QuerySlot(conn, onError);
  const names = new QuerySlot(conn, onError, () => { for (const hex of names.queries.map((q) => q.slice(-64))) looked.add(hex); names.set([]); pumpNames(); });
  const slots = { focus, friends, party, names };
  // Characters with their live positions (playerView.ts): your own position drives the blocks.
  const people = db.player ? playerView(conn as unknown as { db: Record<string, any> }) : undefined;

  let blocks: Blocks = {};
  let me: Row | null = null;
  let targetHex: string | null = null;

  // Names: every player row seen feeds the directory; unknown chat senders are looked up once.
  const looked = new Set<string>();
  const wanted = new Set<string>();
  const known = new Set<string>();
  const pumpNames = () => {
    if (names.queries.length) return; // one batch at a time
    const batch: string[] = [];
    for (const hex of wanted) {
      if (known.has(hex) || looked.has(hex)) { wanted.delete(hex); continue; }
      batch.push(hex);
      if (batch.length >= NAME_BATCH) break;
    }
    names.set(identityQueries(batch, [], false));
  };

  const updateBlocks = () => {
    const next = nextBlocks(me ? { region: me.region, x: me.x, z: me.z } : null, blocks);
    const moved = next.home !== blocks.home || next.seam !== blocks.seam || next.players !== blocks.players || next.playersSeam !== blocks.playersSeam;
    blocks = next;
    if (moved) cells.set(cellGroups(next));
  };
  const updateFocus = () => {
    const t = me?.combatTarget ? hexOf(me.combatTarget) : null;
    const duels: string[] = []; // and trade partners
    for (const d of db.friendlyDuel?.iter() ?? []) {
      if (d.stage === 'complete') continue;
      if (mine(d.a)) duels.push(hexOf(d.b)); else if (mine(d.b)) duels.push(hexOf(d.a));
    }
    // trade is narrowed to your own trades by row-level security.
    for (const tr of db.trade?.iter() ?? []) duels.push(hexOf(tr.a), hexOf(tr.b));
    targetHex = t;
    focus.set(identityQueries([...(t ? [t] : []), ...duels].filter((h) => h !== myHex)));
  };
  const updateFriends = () => {
    const hexes: string[] = [];
    for (const f of db.friend?.iter() ?? []) if (mine(f.owner)) hexes.push(hexOf(f.friend));
    friends.set(identityQueries(hexes, ['mentor_stat']));
  };
  const updateParty = () => {
    let expedition: bigint | null = null, run: bigint | null = null;
    for (const m of db.expeditionMember?.iter() ?? []) if (mine(m.identity)) { expedition = m.expeditionId; break; }
    for (const m of db.spireMember?.iter() ?? []) if (mine(m.identity)) { run = m.runId; break; }
    party.set(partyQueries(expedition, run));
  };

  const findMe = () => {
    for (const p of people?.iter() ?? []) if (mine(p.identity)) return p;
    return null;
  };

  const notePlayer = (row: Row) => {
    const hex = hexOf(row.identity);
    known.add(hex);
    notePlayerName(hex, row.name);
  };
  const onPlayer = (_ctx: unknown, row: Row) => {
    notePlayer(row);
    if (!mine(row.identity)) return;
    if (myId === undefined) myId = idValue(row.identity);
    me = row;
    updateBlocks();
    const t = row.combatTarget ? hexOf(row.combatTarget) : null;
    if (t !== targetHex) updateFocus();
  };
  const onPlayerUpdate = (ctx: unknown, prev: Row, row: Row) => {
    if (prev.name !== row.name) notePlayerName(hexOf(row.identity), row.name);
    if (mine(row.identity)) onPlayer(ctx, row);
  };
  const onChat = (_ctx: unknown, row: Row) => {
    const hex = hexOf(row.sender);
    if (!known.has(hex) && !looked.has(hex)) { wanted.add(hex); pumpNames(); }
  };

  const listeners: [TableLike | undefined, 'insert' | 'update' | 'delete', any][] = [];
  const on = (table: TableLike | undefined, kind: 'insert' | 'update' | 'delete', cb: any) => {
    if (!table) return;
    if (kind === 'insert') table.onInsert(cb); else if (kind === 'delete') table.onDelete(cb); else table.onUpdate?.(cb);
    listeners.push([table, kind, cb]);
  };
  const any = (table: TableLike | undefined, cb: () => void) => {
    const f = () => cb();
    on(table, 'insert', f); on(table, 'update', f); on(table, 'delete', f);
  };

  on(people as TableLike | undefined, 'insert', onPlayer);
  on(people as TableLike | undefined, 'update', onPlayerUpdate);
  on(db.chatMessage, 'insert', onChat);
  any(db.friend, updateFriends);
  any(db.friendlyDuel, updateFocus);
  any(db.trade, updateFocus);
  any(db.expeditionMember, updateParty);
  any(db.spireMember, updateParty);

  for (const p of db.player?.iter() ?? []) notePlayer(p);
  const self = findMe();
  if (self) onPlayer(undefined, self);
  updateFocus(); updateFriends(); updateParty();
  for (const m of db.chatMessage?.iter() ?? []) onChat(undefined, m);

  return {
    blocks: () => blocks,
    snapshot: () => ({
      nodes: cells.queries('nodes:'),
      players: [...cells.queries('local:'), ...cells.queries('players:')].filter((q) => !q.includes('_event')),
      events: cells.queries('local:').filter((q) => q.includes('_event')),
      ...Object.fromEntries(Object.entries(slots).map(([k, s]) => [k, s.queries])),
    }),
    wantNames(hexes) {
      for (const h of hexes) if (!known.has(h) && !looked.has(h)) wanted.add(h);
      pumpNames();
    },
    whenReady(cb) {
      // Nothing nearby to wait for until your row arrives (or when its blocks are empty).
      if (ready || !cells.size) cb(); else waiting.push(cb);
    },
    dispose() {
      for (const [table, kind, cb] of listeners) {
        if (!table) continue;
        if (kind === 'insert') table.removeOnInsert(cb); else if (kind === 'delete') table.removeOnDelete(cb); else table.removeOnUpdate?.(cb);
      }
      for (const s of Object.values(slots)) s.dispose();
      cells.dispose();
      waiting.length = 0;
    },
  };
}
