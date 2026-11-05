import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { adventureTables, testTable } from './adventureHarness';
import { PlayerState } from '../types';
import { inSafeRing } from '../areas';

vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({
  t: new Proxy({}, { get: () => () => ({}) }),
  SenderError: class SenderError extends Error {},
}));
vi.mock('../../../spacetimedb/src/schema', () => ({
  default: {
    reducer: (...args: unknown[]) => args[args.length - 1],
    init: (fn: unknown) => fn, clientConnected: (fn: unknown) => fn, clientDisconnected: (fn: unknown) => fn,
  },
}));
vi.mock('../../../spacetimedb/src/tables', () => ({ tickSchedule: { rowType: {} } }));

import { tick as registeredTick } from '../../../spacetimedb/src/reducers/tick';
import { setTarget as registeredTarget } from '../../../spacetimedb/src/reducers/movement';
import { attack as registeredAttack } from '../../../spacetimedb/src/reducers/combat';
import { onConnect as registeredConnect, onDisconnect as registeredDisconnect } from '../../../spacetimedb/src/reducers/lifecycle';
import { loadPlayer, storePlayer } from '../../../spacetimedb/src/lib/playerStore';

/**
 * player_pos (spacetimedb/src/lib/playerStore.ts): a step rewrites only the
 * narrow player_pos row, reducers and the tick read positions from it, and a
 * database from before it existed gets its rows on the first tick.
 */

type Reducer = (ctx: any, args?: any) => void;
const R = (f: unknown) => f as Reducer;
type Identity = { toHexString(): string; __identity__: bigint };
const id = (n: number): Identity => {
  const hex = n.toString(16).padStart(64, '0');
  return { toHexString: () => hex, __identity__: BigInt(n) };
};
const A = id(1), B = id(2), OWNER = id(9), MODULE = id(10);
const KEYS: Record<string, [string, boolean]> = {
  playerGrant: ['identity', false], appearance: ['identity', false], emoteCooldown: ['identity', false], playStats: ['identity', false],
  giantContribution: ['identity', false], mentee: ['identity', false], mentorStat: ['identity', false], idleState: ['identity', false],
  world: ['id', false], accessPolicy: ['id', false], tree: ['id', false], trainingDummy: ['id', false], giant: ['id', false],
  giantRaid: ['id', false], inviteCode: ['code', false], socialPair: ['pair', false], pendingDeposit: ['identity', false],
  dailyActivity: ['key', false], clatterhornCredit: ['identity', false],
};

/** Counts writes to one table, through insert and any index's update/delete. */
function counted(table: any) {
  const n = { insert: 0, update: 0, delete: 0 };
  const wrapped = new Proxy(table, {
    get(obj: any, field: string) {
      const v = obj[field];
      if (field === 'insert') return (row: any) => { n.insert++; return v(row); };
      if (v && typeof v === 'object' && 'update' in v) {
        return { ...v, update: (row: any) => { n.update++; return v.update(row); }, delete: (k: any) => { n.delete++; return v.delete(k); } };
      }
      return v;
    },
  });
  return { wrapped, n, reset: () => { n.insert = 0; n.update = 0; n.delete = 0; } };
}

const row = (who: Identity, over: object = {}) => ({
  identity: who, name: `P${who.__identity__}`, online: true, connections: 1, lastSeenAt: { microsSinceUnixEpoch: 0n },
  region: 'bramblewild', x: 35, z: 25, facing: 0, targetX: undefined, targetZ: undefined, hp: 30, maxHp: 30,
  state: PlayerState.Alive, respawnTick: 0, stance: 0, fightState: 0, combatTarget: undefined, hostile: false,
  nextSwingTick: 0, lastExchangeTick: 0, outOfRangeTicks: 0, pending: 0, pendingId: 0n, harvestTreeId: 0, harvestEndTick: 0,
  eatCooldownUntilTick: 0, lastInputTick: 0, inputsThisTick: 0, weapon: '', load: 0, ...over,
});

function harness(withPos = true) {
  const player = counted(testTable('identity'));
  const pos = counted(testTable('identity'));
  const base: Record<string, any> = { ...adventureTables(), player: player.wrapped };
  if (withPos) base.playerPos = pos.wrapped;
  const db = new Proxy(base, {
    get(obj, name: string) {
      if (name === 'playerPos' && !withPos) return undefined;
      if (!(name in obj)) { const [pk, auto] = KEYS[name] ?? ['id', true]; obj[name] = testTable(pk, auto); }
      return obj[name];
    },
  });
  db.accessPolicy.insert({ id: 0, owner: OWNER, gateway: id(11), requireAdmission: false });
  db.world.insert({ id: 0, tick: 100, tickStartedAt: { microsSinceUnixEpoch: 0n } });
  const ctx: any = { db, sender: A, identity: MODULE, random: () => 0.99, timestamp: { microsSinceUnixEpoch: 1_000_000_000_000n } };
  const run = (n = 1) => { for (let i = 0; i < n; i++) { ctx.sender = MODULE; R(registeredTick)(ctx, { timer: {} }); } };
  const as = (who: Identity) => { ctx.sender = who; return ctx; };
  const stored = (who: Identity) => db.player.rows.get(who.toHexString());
  const posRow = (who: Identity) => db.playerPos?.rows.get(who.toHexString());
  return { ctx, db, run, as, stored, posRow, player: player.n, pos: pos.n, reset: () => { player.reset(); pos.reset(); } };
}

let h: ReturnType<typeof harness>;
beforeEach(() => { h = harness(); });

describe('player_pos', () => {
  it('migrates: an online character saved before player_pos gets its row on the first tick, offline ones do not', () => {
    h.db.player.insert(row(A, { x: 40, z: 30 }));
    h.db.player.insert(row(B, { online: false, connections: 0, x: 50, z: 50 }));
    expect(h.posRow(A)).toBeUndefined();
    // Reads fall back to the player row until then.
    expect(loadPlayer(h.ctx, A as any)).toMatchObject({ x: 40, z: 30 });
    h.run();
    expect(h.posRow(A)).toMatchObject({ region: 'bramblewild', x: 40, z: 30, facing: 0, targetX: undefined });
    expect(h.posRow(B)).toBeUndefined();
    // Standing still: no player write at all.
    expect(h.player.update).toBe(0);
  });

  it('a walk rewrites only player_pos, every tick; the player row keeps its last saved position', () => {
    h.db.player.insert(row(A, { x: 33, z: 30 }));
    h.run();
    R(registeredTarget)(h.as(A), { x: 39, z: 30 });
    // The click itself: target and input counter live in player_pos too.
    expect(h.player.update).toBe(0);
    expect(h.posRow(A)).toMatchObject({ targetX: 39, targetZ: 30, inputsThisTick: 1 });
    h.reset();
    const xs: number[] = [];
    for (let i = 0; i < 6; i++) { h.run(); xs.push(h.posRow(A).x); }
    expect(xs[0]).toBeGreaterThan(33);
    expect(xs.at(-1)).toBe(39);
    expect(h.posRow(A).targetX).toBeUndefined(); // arrived
    expect(h.player.update).toBe(0);
    expect(h.pos.update).toBeGreaterThanOrEqual(3);
    expect(h.stored(A)).toMatchObject({ x: 33, z: 30 });
    expect(loadPlayer(h.ctx, A as any)).toMatchObject({ x: 39, z: 30 });
  });

  it('writes the player row only when something else changes, with the live position', () => {
    h.db.player.insert(row(A, { x: 40, z: 30 }));
    h.run();
    R(registeredTarget)(h.as(A), { x: 46, z: 30 });
    h.run(2);
    h.reset();
    const p = loadPlayer(h.ctx, A as any)!;
    storePlayer(h.ctx, { ...p, hp: 12 });
    expect(h.player.update).toBe(1);
    expect(h.pos.update).toBe(0);
    expect(h.stored(A)).toMatchObject({ hp: 12, x: p.x, z: p.z });
    // An identical save writes nothing.
    h.reset();
    storePlayer(h.ctx, loadPlayer(h.ctx, A as any)!);
    expect(h.player.update + h.pos.update + h.pos.insert).toBe(0);
  });

  it('reducers see the live position: an attack from outside the safe ring while the saved row is inside it', () => {
    h.db.player.insert(row(A, { x: 25, z: 25 }));
    h.db.player.insert(row(B, { x: 36, z: 25 }));
    h.run();
    expect(inSafeRing({ x: 25, z: 25 })).toBe(true);
    // A walked out: only player_pos knows.
    h.db.playerPos.identity.update({ ...h.posRow(A), x: 35, z: 25 });
    expect(h.stored(A)).toMatchObject({ x: 25, z: 25 });
    R(registeredAttack)(h.as(A), { target: B });
    expect(loadPlayer(h.ctx, A as any)).toMatchObject({ hostile: true });
    // The tick swings from the live tile (adjacent), not from the saved one 11 tiles away.
    h.run(2);
    expect(loadPlayer(h.ctx, B as any)!.hp).toBeLessThan(30);
  });

  it('the tick moves a walker from its player_pos tile', () => {
    h.db.player.insert(row(A, { x: 40, z: 30 }));
    h.run();
    h.db.playerPos.identity.update({ ...h.posRow(A), x: 34, z: 30, targetX: 37, targetZ: 30 });
    h.run();
    expect(h.posRow(A).x).toBeGreaterThan(34);
    expect(h.stored(A).x).toBe(40);
  });

  it('going offline folds the position back into player and deletes player_pos; coming back recreates it', () => {
    h.db.player.insert(row(A, { x: 40, z: 30 }));
    h.run();
    h.db.playerPos.identity.update({ ...h.posRow(A), x: 44, z: 31, facing: 3 });
    R(registeredDisconnect)(h.as(A));
    expect(h.posRow(A)).toBeUndefined();
    expect(h.stored(A)).toMatchObject({ online: false, x: 44, z: 31, facing: 3 });
    R(registeredConnect)(h.as(A));
    expect(h.stored(A).online).toBe(true);
    expect(h.posRow(A)).toMatchObject({ x: 44, z: 31, facing: 3 });
  });

  it('a new character starts with both rows', () => {
    R(registeredConnect)(h.as(A));
    expect(h.stored(A)).toMatchObject({ online: true });
    expect(h.posRow(A)).toMatchObject({ x: h.stored(A).x, z: h.stored(A).z, region: 'bramblewild' });
  });

  it('without a player_pos table (old test harnesses) everything stays in the player row', () => {
    const old = harness(false);
    old.db.player.insert(row(A, { x: 33, z: 30 }));
    old.run();
    R(registeredTarget)(old.as(A), { x: 37, z: 30 });
    old.run(4);
    expect(old.stored(A)).toMatchObject({ x: 37, z: 30 });
  });
});

describe('player_pos guard', () => {
  /** Server code must go through lib/playerStore.ts for positions and writes (the player row's motion columns are stale while online). */
  it('no server file writes player rows or reads every player row directly', () => {
    const root = join(__dirname, '../../../spacetimedb/src');
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
    walk(root);
    const allowed = new Set(['lib/playerStore.ts', 'lib/activePlayers.ts']);
    const bad: string[] = [];
    for (const f of files) {
      const rel = f.slice(root.length + 1);
      if (allowed.has(rel)) continue;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // Writes and lookups by identity must go through the store; full scans are allowed only for names (no positions).
        if (/db\.player\.(identity\.(find|update|delete)|insert)\b/.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim()}`);
        if (/db\.player\.iter\(\)/.test(line) && !/names only/.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

describe('player_pos cells and the per-step caches', () => {
  it('keeps player_pos.cell on the walker\'s cell, and heals a cell an owner edit left stale', async () => {
    const { playerCell } = await import('../interest');
    h.db.player.insert(row(A, { x: 22, z: 30 }));
    h.run();
    expect(h.posRow(A).cell).toBe(playerCell('bramblewild', 22, 30));
    // Walk across a 27-tile border (inside the Grove): the row carries the new cell.
    R(registeredTarget)(h.as(A), { x: 30, z: 30 });
    h.run(6);
    expect(h.posRow(A).x).toBe(30);
    expect(h.posRow(A).cell).toBe(playerCell('bramblewild', 30, 30));
    expect(h.posRow(A).cell).not.toBe(playerCell('bramblewild', 22, 30));
    // An owner `UPDATE player_pos SET x = ...` without the cell: the next tick puts it right.
    h.db.playerPos.identity.update({ ...h.posRow(A), x: 100, z: 100 });
    h.run();
    expect(h.posRow(A).cell).toBe(playerCell('bramblewild', 100, 100));
  });

  it('set_target hands its route to the tick, which walks it without searching again', async () => {
    const { ROUTES } = await import('../../../spacetimedb/src/lib/routes');
    h.db.player.insert(row(A, { x: 33, z: 30 }));
    h.run();
    R(registeredTarget)(h.as(A), { x: 39, z: 30 });
    const seeded = ROUTES.get(A.toHexString())!;
    expect(seeded).toMatchObject({ aim: '39,30,0', origin: { x: 33, z: 30 } });
    expect(seeded.path.at(-1)).toEqual({ x: 39, z: 30 });
    expect(seeded.path[1]).toEqual({ x: 35, z: 30 }); // the search goes straight
    // Swap in another legal route of the same length: a tick that searched again would go straight instead.
    const detour = [{ x: 34, z: 31 }, { x: 35, z: 31 }, { x: 36, z: 31 }, { x: 37, z: 31 }, { x: 38, z: 31 }, { x: 39, z: 30 }];
    ROUTES.set(A.toHexString(), { ...seeded, path: detour });
    h.run();
    expect({ x: h.posRow(A).x, z: h.posRow(A).z }).toEqual({ x: 35, z: 31 });
  });

  it('refreshes the load glow for marked bags at once and catches unmarked edits at the minute sweep', async () => {
    const { markLoad } = await import('../../../spacetimedb/src/lib/inventory');
    const { LOAD_REFRESH_TICKS } = await import('../banking');
    h.db.player.insert(row(A, { x: 40, z: 30 }));
    h.run();
    const toRefresh = () => { while ((h.db.world.id.find(0).tick + 1) % LOAD_REFRESH_TICKS !== 0) h.run(); h.run(); };
    const give = (itemId: string, quantity: number) => h.db.inventorySlot.insert({ id: 0n, owner: A, slot: h.db.inventorySlot.rows.size, itemId, quantity });
    toRefresh();
    expect(loadPlayer(h.ctx, A as any)!.load ?? 0).toBe(0);
    // A write that bypasses lib/inventory.ts (an owner SQL edit): not seen at the next refresh...
    give('flint', 90);
    toRefresh();
    expect(loadPlayer(h.ctx, A as any)!.load ?? 0).toBe(0);
    // ...but at the sweep (every 100 ticks).
    while ((h.db.world.id.find(0).tick + 1) % 100 !== 0) h.run();
    h.run();
    expect(loadPlayer(h.ctx, A as any)!.load).toBe(2);
    // A marked write (every server path, writeSlots) shows at the next refresh.
    for (const r of [...h.db.inventorySlot.rows.values()]) h.db.inventorySlot.id.delete(r.id);
    markLoad(A as any);
    toRefresh();
    expect(loadPlayer(h.ctx, A as any)!.load ?? 0).toBe(0);
  });
});
