import { describe, expect, it, vi } from 'vitest';
import { mergedPlayer, testTable } from './adventureHarness';
import { PlayerState } from '../types';
import { GRID_SIZE } from '../constants';
import { isLandTile } from '../grid';
import { inSafeRing } from '../areas';
import { worldBlockedSet } from '../social';
import { tileKey } from '../grid';

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

/**
 * Scale: 2000 online players and tens of thousands of stored characters on
 * the real tick. The player table here is an instrumented stand-in with the
 * module's btree indexes on `online` and `state`; it counts every row the
 * tick reads. After the first tick (the once-per-instance terrain repair and
 * offline-holder scan), a tick must read only active rows, the same number
 * whether 2k or 48k characters sit offline, and finish inside a CI-safe budget.
 */

type Id = { toHexString(): string; __identity__: bigint };
const id = (n: number): Id => {
  const hex = n.toString(16).padStart(64, '0');
  return { toHexString: () => hex, __identity__: BigInt(n) };
};
const MODULE = id(0xfffff0), OWNER = id(0xfffff1);
const tick = registeredTick as unknown as (ctx: any, args?: any) => void;

interface Reads { iterRows: number; indexRows: number; finds: number; updates: number }

/** The player table with the module's indexes (tables.ts: online, state), counting reads. */
function indexedPlayers(reads: Reads) {
  const rows = new Map<string, any>();
  const online = new Map<boolean, Set<string>>([[true, new Set()], [false, new Set()]]);
  const state = new Map<number, Set<string>>();
  const unindex = (k: string, r: any) => { online.get(r.online)!.delete(k); state.get(r.state)?.delete(k); };
  const index = (k: string, r: any) => {
    online.get(r.online)!.add(k);
    if (!state.has(r.state)) state.set(r.state, new Set());
    state.get(r.state)!.add(k);
  };
  const put = (row: any) => {
    const k = row.identity.toHexString(), old = rows.get(k);
    if (old) unindex(k, old);
    const copy = { ...row };
    rows.set(k, copy);
    index(k, copy);
    return { ...copy };
  };
  const scan = (keys: Set<string> | undefined) => {
    const out = [...(keys ?? [])].map((k) => rows.get(k));
    reads.indexRows += out.length;
    return out;
  };
  return {
    rows,
    *iter() { for (const r of rows.values()) { reads.iterRows++; yield r; } },
    count: () => BigInt(rows.size),
    insert: put,
    identity: {
      find: (who: Id) => { reads.finds++; return rows.get(who.toHexString()); },
      update: (row: any) => { reads.updates++; return put(row); },
      delete: (who: Id) => { const k = who.toHexString(), old = rows.get(k); if (old) unindex(k, old); return rows.delete(k); },
    },
    online: { filter: (v: boolean) => scan(online.get(v)) },
    state: { filter: (v: number) => scan(state.get(v)) },
  };
}

const KEYS: Record<string, string> = {
  playerPos: 'identity', playerGrant: 'identity', appearance: 'identity', emoteCooldown: 'identity', playStats: 'identity', giantContribution: 'identity',
  mentee: 'identity', mentorStat: 'identity', idleState: 'identity', pendingDeposit: 'identity', clatterhornCredit: 'identity',
  spireMember: 'identity', expeditionMember: 'identity', adventureProfile: 'identity', playerSkill: 'identity', playerCosmetic: 'identity',
  gardenShowcase: 'identity', spireFight: 'runId', inviteCode: 'code', socialPair: 'pair', dailyActivity: 'key',
  frontierObject: 'key', frontierPrivate: 'key', frontierView: 'key', expeditionCredit: 'key',
};
const AUTO = new Set(['groundItem', 'inventorySlot', 'combatEvent', 'dummyEvent', 'giantEvent', 'bossEvent', 'bossNotice', 'socialEvent', 'trade', 'spireRun', 'expedition', 'friendlyDuel', 'chatMessage', 'friend', 'gardenPlot']);

/** Deterministic tile picker over open land outside the safe ring. */
function landPicker(seed: number) {
  const blocked = worldBlockedSet([]);
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  const open = (t: { x: number; z: number }) => isLandTile(t) && !blocked.has(tileKey(t)) && !inSafeRing(t);
  const pick = (): { x: number; z: number } => {
    for (;;) {
      const t = { x: Math.floor(rnd() * GRID_SIZE), z: Math.floor(rnd() * GRID_SIZE) };
      if (open(t)) return t;
    }
  };
  /** An open tile a few steps from `t` (short walks keep the BFS small, as in real play). */
  const near = (t: { x: number; z: number }): { x: number; z: number } => {
    for (let i = 0; i < 50; i++) {
      const n = { x: t.x + Math.floor(rnd() * 13) - 6, z: t.z + Math.floor(rnd() * 13) - 6 };
      if (n.x >= 0 && n.z >= 0 && n.x < GRID_SIZE && n.z < GRID_SIZE && open(n)) return n;
    }
    return t;
  };
  return { pick, near };
}

function world(offline: number, onlineCount: number) {
  const reads: Reads = { iterRows: 0, indexRows: 0, finds: 0, updates: 0 };
  const player = indexedPlayers(reads);
  const base: Record<string, any> = { player };
  const db = new Proxy(base, {
    get(obj, name: string) {
      if (!(name in obj)) obj[name] = testTable(KEYS[name] ?? 'id', AUTO.has(name));
      return obj[name];
    },
  });
  db.accessPolicy.insert({ id: 0, owner: OWNER, gateway: id(0xfffff2), requireAdmission: false });
  db.world.insert({ id: 0, tick: 1000, tickStartedAt: { microsSinceUnixEpoch: 0n } });
  const ctx: any = { db, sender: MODULE, identity: MODULE, random: () => 0.99, timestamp: { microsSinceUnixEpoch: 1_000_000_000_000n } };
  const land = landPicker(42);
  const row = (n: number, extra: object) => {
    const at = land.pick();
    return {
      identity: id(n), name: `P${n}`, online: false, connections: 0, lastSeenAt: ctx.timestamp, x: at.x, z: at.z, facing: 0,
      targetX: undefined, targetZ: undefined, hp: 30, maxHp: 30, state: PlayerState.Alive, respawnTick: 0, stance: 0, fightState: 0,
      combatTarget: undefined, hostile: false, nextSwingTick: 0, lastExchangeTick: 0, outOfRangeTicks: 0, pending: 0, pendingId: 0n,
      harvestTreeId: 0, harvestEndTick: 0, eatCooldownUntilTick: 0, lastInputTick: 1000, inputsThisTick: 0, weapon: '',
      region: 'bramblewild', load: 0, ...extra,
    };
  };
  let n = 1;
  for (let i = 0; i < offline; i++) player.insert(row(n++, {}));
  // A few offline characters the tick must still load: the dead (respawn) and legacy holders of a combat target.
  const dead: Id[] = [], holders: Id[] = [];
  for (let i = 0; i < 10; i++) { const r = row(n++, { state: PlayerState.Dead, hp: 0, respawnTick: 1003 }); dead.push(r.identity); player.insert(r); }
  const walkers: Id[] = [];
  const firstOnline = n;
  for (let i = 0; i < onlineCount; i++) {
    const r = row(n++, { online: true, connections: 1 });
    if (i % 4 === 0) { const to = land.near(r); Object.assign(r, { targetX: to.x, targetZ: to.z }); walkers.push(r.identity); }
    player.insert(r);
  }
  for (let i = 0; i < 5; i++) {
    const r = row(n++, { combatTarget: id(firstOnline + i), hostile: true });
    holders.push(r.identity); player.insert(r);
  }
  const run = () => { ctx.sender = MODULE; tick(ctx, { timer: {} }); };
  const p = (who: Id) => mergedPlayer(db, who);
  return { ctx, db, reads, run, p, dead, holders, walkers };
}

const reset = (r: Reads) => { r.iterRows = 0; r.indexRows = 0; r.finds = 0; r.updates = 0; };

/** Reads and wall time of `ticks` ticks after the warm-up tick. */
function measure(offline: number, online: number, ticks: number) {
  const w = world(offline, online);
  w.run(); // warm-up: the once-per-instance terrain repair and offline-holder scan read every row
  const warm = { ...w.reads };
  const per: Reads[] = [], times: number[] = [];
  for (let i = 0; i < ticks; i++) {
    reset(w.reads);
    const t0 = performance.now();
    w.run();
    times.push(performance.now() - t0);
    per.push({ ...w.reads });
  }
  times.sort((a, b) => a - b);
  return { w, warm, per, median: times[Math.floor(times.length / 2)], max: times[times.length - 1] };
}

describe('tick at 2000 online players', () => {
  const ONLINE = 2000, TICKS = 12;

  it('reads only active rows, however many characters are stored', { timeout: 120_000 }, () => {
    const small = measure(2_000, ONLINE, TICKS);
    const big = measure(48_000, ONLINE, TICKS);
    const stored = 48_000 + 10 + ONLINE + 5;
    expect(big.w.db.player.rows.size).toBe(stored);
    // world.online: the global count clients read instead of subscribing to every player.
    expect(big.w.db.world.id.find(0).online).toBe(ONLINE);

    // The first tick of a module instance reads every row (terrain repair + holder scan), once.
    expect(big.warm.iterRows).toBeLessThanOrEqual(2 * stored);
    for (const r of big.per) {
      // No full scan of the player table after that.
      expect(r.iterRows).toBe(0);
      // Index reads: online players (several passes: tick, loads, heartbeat) plus the few offline dead.
      expect(r.indexRows).toBeLessThanOrEqual(3 * (ONLINE + 10));
      // Primary-key reads stay O(active), never O(stored).
      expect(r.finds).toBeLessThanOrEqual(ONLINE + 100);
    }
    // Identical reads with 2k or 48k characters offline (writes depend on where the walkers stand).
    const total = (x: Reads[]) => x.reduce((a, r) => ({ iterRows: a.iterRows + r.iterRows, indexRows: a.indexRows + r.indexRows, finds: a.finds + r.finds }), { iterRows: 0, indexRows: 0, finds: 0 });
    expect(total(big.per)).toEqual(total(small.per));

    console.log(`[tick-scale] 2000 online + 48k offline: median ${big.median.toFixed(1)} ms, max ${big.max.toFixed(1)} ms per tick; `
      + `2000 online + 2k offline: median ${small.median.toFixed(1)} ms; reads/tick ${JSON.stringify(big.per[big.per.length - 1])}`);
    // A CI-safe ceiling (the real budget is the 600 ms tick, on faster native storage).
    expect(big.median).toBeLessThan(400);
  });

  it('still processes the offline rows the old full scan kept', { timeout: 60_000 }, () => {
    const w = world(5_000, 200);
    const before = w.walkers.map((who) => ({ ...w.p(who) }));
    for (let i = 0; i < 6; i++) w.run();
    // Offline dead respawn on schedule (respawnTick 1003), still offline.
    for (const who of w.dead) expect(w.p(who)).toMatchObject({ state: PlayerState.Alive, online: false });
    // Walkers moved toward their targets.
    const moved = w.walkers.filter((who, i) => w.p(who).x !== before[i].x || w.p(who).z !== before[i].z);
    expect(moved.length).toBeGreaterThan(w.walkers.length / 2);
    // Legacy offline holders are loaded every tick: when their target dies, the target is cleared.
    const holder = w.holders[0], target = w.p(holder).combatTarget;
    w.db.player.identity.update({ ...w.p(target), hp: 0 });
    w.run();
    expect(w.p(target).state).toBe(PlayerState.Dead);
    expect(w.p(holder).combatTarget).toBeUndefined();
    expect(w.p(holder).hostile).toBe(false);
    // Once cleared it is no longer re-read (the holder set shrinks; nothing else changes).
    reset(w.reads);
    w.run();
    expect(w.reads.iterRows).toBe(0);
  });
});
