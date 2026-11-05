import type { Identity } from 'spacetimedb';
import { playerCell } from '../../../shared/sim/interest';
import type { Ctx, PlayerPosRow, PlayerRow } from './types';

/**
 * The one way server code reads and writes characters (tables.ts player and
 * player_pos). A character is stored in two rows:
 *
 * - `player`: everything (name, vitals, combat, pending, weapon, region...),
 *   written only when one of those changes;
 * - `player_pos`: while online, the columns that change every tick a
 *   character walks or every time it sends an input (MOTION below). The tick
 *   writes only this narrow row for a step, so the whole `player` row is not
 *   re-sent to every client that can see the walker.
 *
 * Reads overlay `player_pos` on `player` (loadPlayer, overlay, allPlayers), so
 * every reducer and the tick see the authoritative position. Writes
 * (storePlayer) split a merged row back: the motion columns go to
 * `player_pos` while online and to `player` while offline, and `player` is
 * written only when a non-motion column changed (or the character goes
 * offline, which folds its position back and deletes the `player_pos` row).
 *
 * Migration: a database published before `player_pos` existed has none of
 * its rows. Reads fall back to `player`; the first write of an online
 * character (the tick moving it, any input, a reconnect) inserts its row.
 *
 * Test harnesses whose fake database has no `playerPos` table get the old
 * single-row behaviour (everything in `player`).
 *
 * Never call `ctx.db.player.identity.update/insert` or read positions from
 * `ctx.db.player` directly elsewhere: the row's motion columns are stale
 * while a character is online (player-store-guard.test.ts checks).
 */

/** Columns `player_pos` owns while its character is online. */
export const MOTION_KEYS = ['x', 'z', 'facing', 'targetX', 'targetZ', 'lastInputTick', 'inputsThisTick'] as const;
const MOTION = new Set<string>(MOTION_KEYS);

type PosTable = {
  iter(): Iterable<PlayerPosRow>;
  insert(row: PlayerPosRow): unknown;
  identity: { find(id: Identity): PlayerPosRow | null | undefined; update(row: PlayerPosRow): unknown; delete(id: Identity): unknown };
};

/** The player_pos table, or undefined in a test harness without one. */
export function posTable(ctx: Ctx): PosTable | undefined {
  const t = (ctx.db as unknown as { playerPos?: PosTable }).playerPos;
  return t && typeof t.identity?.find === 'function' ? t : undefined;
}

/** A Map key for an identity: its u256 value (no string allocation), or its hex in test harnesses. */
export function idKey(id: Identity): bigint | string {
  const v = (id as unknown as { __identity__?: bigint }).__identity__;
  return v !== undefined ? v : id.toHexString();
}

/** `row` with `pos`'s columns on top (a new object), or `row` itself without one. */
export function withPos(row: PlayerRow, pos: PlayerPosRow | null | undefined): PlayerRow {
  if (!pos) return row;
  return {
    ...row,
    x: pos.x, z: pos.z, facing: pos.facing, targetX: pos.targetX, targetZ: pos.targetZ,
    lastInputTick: pos.lastInputTick, inputsThisTick: pos.inputsThisTick,
  };
}

/** A character's player_pos row, its subscription cell (shared/sim/interest.ts) included. */
export function posOf(p: PlayerRow): PlayerPosRow {
  const region = p.region || 'bramblewild';
  return {
    identity: p.identity, region,
    x: p.x, z: p.z, facing: p.facing, targetX: p.targetX, targetZ: p.targetZ,
    lastInputTick: p.lastInputTick, inputsThisTick: p.inputsThisTick,
    cell: playerCell(region, p.x, p.z),
  };
}

export function findPos(ctx: Ctx, id: Identity): PlayerPosRow | undefined {
  return posTable(ctx)?.identity.find(id) ?? undefined;
}

/** One character, position included. */
export function loadPlayer(ctx: Ctx, id: Identity): PlayerRow | undefined {
  const row = ctx.db.player.identity.find(id);
  if (!row) return undefined;
  return withPos(row, findPos(ctx, id));
}

/** Every player_pos row by idKey (one scan of the online characters' rows). */
export function positions(ctx: Ctx): Map<bigint | string, PlayerPosRow> | undefined {
  const table = posTable(ctx);
  if (!table) return undefined;
  const m = new Map<bigint | string, PlayerPosRow>();
  for (const pos of table.iter()) m.set(idKey(pos.identity), pos);
  return m;
}

/** `rows` with their positions: a lookup each for a few, one scan of player_pos for many. */
export function overlay(ctx: Ctx, rows: Iterable<PlayerRow>, map?: Map<bigint | string, PlayerPosRow>): PlayerRow[] {
  const list = [...rows];
  const table = posTable(ctx);
  if (!table || !list.length) return list;
  if (!map && list.length > 8) map = positions(ctx);
  return list.map((r) => withPos(r, map ? map.get(idKey(r.identity)) : table.identity.find(r.identity)));
}

/** Every stored character, positions included (admin, terrain repair: full scans by design). */
export function allPlayers(ctx: Ctx): PlayerRow[] {
  return overlay(ctx, ctx.db.player.iter());
}

function sameValue(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return false;
  const a = x as Record<string, any>, b = y as Record<string, any>;
  if ('__identity__' in a && '__identity__' in b) return a.__identity__ === b.__identity__;
  if ('microsSinceUnixEpoch' in a && 'microsSinceUnixEpoch' in b) return a.microsSinceUnixEpoch === b.microsSinceUnixEpoch;
  if (typeof a.toHexString === 'function' && typeof b.toHexString === 'function') return a.toHexString() === b.toHexString();
  return false;
}

/** Whether `a` and `b` agree on every column (`motion` false: every non-motion column; true: only the motion ones). */
function sameColumns(a: PlayerRow, b: PlayerRow, which: 'all' | 'rest' | 'motion'): boolean {
  const keys = which === 'motion' ? MOTION_KEYS : new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (which === 'rest' && MOTION.has(k)) continue;
    if (!sameValue((a as any)[k], (b as any)[k])) return false;
  }
  return true;
}

function samePos(a: PlayerPosRow, b: PlayerPosRow): boolean {
  return a.region === b.region && a.x === b.x && a.z === b.z && a.facing === b.facing && a.targetX === b.targetX
    && a.targetZ === b.targetZ && a.lastInputTick === b.lastInputTick && a.inputsThisTick === b.inputsThisTick && a.cell === b.cell;
}

/**
 * Save a character (a merged row, as loadPlayer returns, changed). Writes only
 * what changed: `player_pos` for motion while online, `player` for anything
 * else. `known` skips the lookups when the caller has the stored state (the
 * tick): `before` is the merged row as loaded, `pos` its player_pos row.
 */
export function storePlayer(ctx: Ctx, next: PlayerRow, known?: { before: PlayerRow; pos: PlayerPosRow | undefined }): void {
  const table = posTable(ctx);
  const pos = known ? known.pos : table?.identity.find(next.identity) ?? undefined;
  let before = known?.before;
  if (!before) {
    const row = ctx.db.player.identity.find(next.identity);
    // A missing row: let the table report it, as a plain update always did.
    if (!row) { ctx.db.player.identity.update(next); return; }
    before = withPos(row, pos);
  }
  if (!table) {
    if (!sameColumns(before, next, 'all')) ctx.db.player.identity.update(next);
    return;
  }
  let rowWrite = !sameColumns(before, next, 'rest');
  if (next.online) {
    const np = posOf(next);
    if (!pos) table.insert(np);
    else if (!samePos(pos, np)) table.identity.update(np);
  } else if (pos) {
    // Going offline: fold the position back into player.
    table.identity.delete(next.identity);
    rowWrite = true;
  } else if (!sameColumns(before, next, 'motion')) {
    rowWrite = true;
  }
  if (rowWrite) ctx.db.player.identity.update(next);
}

/** A new character (lifecycle onConnect). */
export function insertPlayer(ctx: Ctx, row: PlayerRow): void {
  ctx.db.player.insert(row);
  const table = posTable(ctx);
  if (!table || !row.online) return;
  if (table.identity.find(row.identity)) table.identity.update(posOf(row));
  else table.insert(posOf(row));
}
