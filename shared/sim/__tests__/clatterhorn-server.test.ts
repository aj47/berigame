import { adventureTables, testTable } from './adventureHarness';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState, Pending } from '../types';
import { STICK_ITEM_ID, STONE_CLUB_ITEM_ID } from '../items';
import { chebyshev, tileKey } from '../grid';
import { inGrace } from '../areas';
import { Cosmetic } from '../skills';
import {
  BOSS_CONFIG_DEFAULTS, BossEventKind, BossNoticeKind, CLATTERHORN_ID, CLATTER_DIR8, CLATTER_GLADE, CLATTER_HOME, CLATTER_STONES,
  ClatterEndKind, ClatterState, HurtSource, SPIRE_SPAWNS, clatterChooseLane, clatterLane, clatterSlam, clatterSlamTiles, clatterSpinTiles, clatterSwarmFreeLines, clatterTelegraph,
  clatterValidCentre, inBossRect,
} from '../index';

// Real reducers and the real tick against an in-memory database (the harness of
// boss-guards-server.test.ts): reducers become raw handlers, every table is a testTable.
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

import * as clatter from '../../../spacetimedb/src/reducers/clatterhorn';
import * as admin from '../../../spacetimedb/src/reducers/bossAdmin';
import * as movement from '../../../spacetimedb/src/reducers/movement';
import { tick as registeredTick } from '../../../spacetimedb/src/reducers/tick';

type Reducer = (ctx: any, args?: any) => void;
const R = (f: unknown) => f as Reducer;

type Identity = { toHexString(): string; __identity__: bigint };
const id = (n: number): Identity => {
  const hex = n.toString(16).padStart(64, '0');
  return { toHexString: () => hex, __identity__: BigInt(n) };
};
const A = id(1), B = id(2), C = id(3), OWNER = id(9), MODULE = id(10);

const KEYS: Record<string, [string, boolean]> = {
  player: ['identity', false], playerGrant: ['identity', false], appearance: ['identity', false], emoteCooldown: ['identity', false],
  playStats: ['identity', false], giantContribution: ['identity', false], mentee: ['identity', false], mentorStat: ['identity', false],
  world: ['id', false], accessPolicy: ['id', false], tree: ['id', false], trainingDummy: ['id', false], giant: ['id', false],
  giantRaid: ['id', false], inviteCode: ['code', false], socialPair: ['pair', false],
};

const playerRow = (who: Identity, name: string, over: object = {}) => ({
  identity: who, name, online: true, connections: 1, region: 'bramblewild', x: 35, z: 25, facing: 0,
  targetX: undefined, targetZ: undefined, hp: 30, maxHp: 30, state: PlayerState.Alive, respawnTick: 0,
  stance: 0, fightState: 0, combatTarget: undefined, hostile: false, nextSwingTick: 0, harvestTreeId: 0, harvestEndTick: 0,
  pending: 0, pendingId: 0n, lastInputTick: 0, inputsThisTick: 0, eatCooldownUntilTick: 0, weapon: '', ...over,
});

function harness() {
  const base: Record<string, any> = { ...adventureTables() };
  const db = new Proxy(base, {
    get(obj, name: string) {
      if (!(name in obj)) { const [pk, auto] = KEYS[name] ?? ['id', true]; obj[name] = testTable(pk, auto); }
      return obj[name];
    },
  });
  db.accessPolicy.insert({ id: 0, owner: OWNER, gateway: id(11), requireAdmission: false });
  db.world.insert({ id: 0, tick: 100 });
  const ctx: any = { db, sender: A, identity: MODULE, random: () => 0.99, timestamp: { microsSinceUnixEpoch: 1_000_000_000_000n } };
  for (const [who, name] of [[A, 'Ann'], [B, 'Bo'], [C, 'Cy']] as const) db.player.insert(playerRow(who, name));
  const p = (who: Identity) => db.player.identity.find(who);
  const place = (who: Identity, x: number, z: number, extra: object = {}) => db.player.identity.update({ ...p(who), x, z, ...extra });
  const give = (who: Identity, slot: number, itemId: string, quantity: number) => db.inventorySlot.insert({ id: 0n, owner: who, slot, itemId, quantity });
  const bag = (who: Identity) => [...db.inventorySlot.owner.filter(who)].map((r: any) => `${r.itemId}:${r.quantity}`).sort();
  const as = (who: Identity) => { ctx.sender = who; return ctx; };
  /** The last finished tick (reducers read it; the next tick runs at now() + 1). */
  const now = (): number => db.world.id.find(0).tick;
  const run = (n = 1) => { for (let i = 0; i < n; i++) { ctx.sender = MODULE; R(registeredTick)(ctx, { timer: {} }); } };
  const beetle = () => db.clatterhorn.id.find(CLATTERHORN_ID);
  const setBeetle = (over: object) => db.clatterhorn.id.update({ ...beetle(), ...over });
  const notices = (kind: number, who?: Identity) => [...db.bossNotice.iter()]
    .filter((n: any) => n.kind === kind && (!who || n.player.toHexString() === who.toHexString()));
  const events = (kind: number) => [...db.bossEvent.iter()].filter((e: any) => e.kind === kind);
  const configure = (over: object = {}) => R(admin.configureBosses)(as(OWNER), { ...BOSS_CONFIG_DEFAULTS, clatterhornOpen: true, ...over });
  const attack = (who: Identity) => R(clatter.attackClatterhorn)(as(who), {});
  const debug = (op: string, value = 0) => R(admin.bossDebug)(as(OWNER), { op, runId: 0n, value });
  /** Open, then a fight in progress with the AI held in a long Recover (swings land, nothing attacks). */
  const fight = (over: object = {}) => {
    configure();
    setBeetle({ state: ClatterState.Recover, stateUntilTick: 1_000_000, fightCount: 1, engagedTick: now(), lastHitTick: now(), ...over });
  };
  /** `who` stands at (x, z) with a stick (Coast key) or a club wielded, swinging at the beetle. */
  const swinger = (who: Identity, x: number, z: number, weapon = STICK_ITEM_ID, extra: object = {}) => {
    give(who, 0, weapon, 1);
    place(who, x, z, { weapon, ...extra });
    attack(who);
  };
  return { ctx, db, p, place, give, bag, as, now, run, beetle, setBeetle, notices, events, configure, attack, debug, fight, swinger };
}

let h: ReturnType<typeof harness>;
beforeEach(() => { h = harness(); });

const HOME = CLATTER_HOME;

describe('availability', () => {
  it('is closed by default: the tick writes nothing and attacks are refused', () => {
    h.run(30);
    expect(h.db.clatterhorn.rows.size).toBe(0);
    expect(h.db.clatterhornCredit.rows.size).toBe(0);
    expect(h.db.bossEvent.rows.size).toBe(0);
    h.place(A, HOME.x, HOME.z - 2);
    expect(() => h.attack(A)).toThrow('The glade is quiet: Clatterhorn is away');
  });

  it('opens via configure_bosses (Dormant at home) and a player entering the glade wakes it with 300 HP', () => {
    h.configure();
    expect(h.beetle()).toMatchObject({ state: ClatterState.Dormant, x: HOME.x, z: HOME.z, hp: 300, maxHp: 300, fightCount: 0 });
    h.run(5);
    expect(h.beetle().state).toBe(ClatterState.Dormant);
    h.place(A, HOME.x, CLATTER_GLADE.z0 + 1);
    h.run(1);
    expect(h.beetle()).toMatchObject({ state: ClatterState.Idle, hp: 300, maxHp: 300, challengers: 0, fightCount: 1, engagedTick: h.now() });
    expect(h.events(BossEventKind.ClatterWake)).toHaveLength(1);
  });

  it('a player in grace never wakes it; a due swing at the sleeping beetle ends that grace and wakes it', () => {
    h.configure();
    h.give(A, 0, STICK_ITEM_ID, 1);
    h.place(A, HOME.x, HOME.z - 2, { weapon: STICK_ITEM_ID, respawnTick: h.now() + 300 });
    h.place(B, HOME.x + 4, HOME.z, { respawnTick: h.now() + 300 });
    h.run(3);
    expect(h.beetle().state).toBe(ClatterState.Dormant);
    h.attack(A);
    h.run(1);
    expect(inGrace(h.p(A), h.now() + 1)).toBe(false);
    expect(inGrace(h.p(B), h.now() + 1)).toBe(true);
    expect(h.beetle()).toMatchObject({ state: ClatterState.Idle, fightCount: 1 });
  });

  it('lonely: one write when it becomes lonely, then a reset after 100 ticks that deletes only unpaid-for credit', () => {
    h.fight({ state: ClatterState.Idle, stateUntilTick: 0, hp: 120, maxHp: 350, challengers: 1, x: 86, z: 106 });
    h.db.clatterhornCredit.insert({ identity: A, fight: 1, damage: 30, lastHitTick: h.now(), owed: 0 });
    h.db.clatterhornCredit.insert({ identity: B, fight: 0, damage: 30, lastHitTick: h.now(), owed: 1 });
    h.run(1);
    const lonelyAt = h.now();
    expect(h.beetle()).toMatchObject({ state: ClatterState.Idle, stateUntilTick: lonelyAt + 100 });
    const update = vi.spyOn(h.db.clatterhorn.id, 'update');
    h.run(99);
    expect(update).not.toHaveBeenCalled();
    h.run(1);
    expect(h.beetle()).toMatchObject({ state: ClatterState.Dormant, x: HOME.x, z: HOME.z, hp: 300, maxHp: 300, challengers: 0, fightCount: 1 });
    expect(h.events(BossEventKind.ClatterReset)).toHaveLength(1);
    expect([...h.db.clatterhornCredit.iter()].map((c: any) => c.identity.toHexString())).toEqual([B.toHexString()]);
  });
});

describe('write cadence', () => {
  it('Dormant with nobody around writes nothing; a crowd fight writes the row at most once per tick', () => {
    h.configure();
    const update = vi.spyOn(h.db.clatterhorn.id, 'update');
    h.run(20);
    expect(update).not.toHaveBeenCalled();
    h.swinger(A, HOME.x, HOME.z - 2);
    h.swinger(B, HOME.x + 2, HOME.z, STONE_CLUB_ITEM_ID);
    h.swinger(C, HOME.x - 2, HOME.z + 1);
    for (let i = 0; i < 40; i++) {
      const before = update.mock.calls.length;
      h.run(1);
      expect(update.mock.calls.length - before).toBeLessThanOrEqual(1);
      for (const who of [A, B, C]) if (h.p(who).hp < 15) h.db.player.identity.update({ ...h.p(who), hp: 30 });
    }
    expect(h.beetle().challengers).toBe(3);
  });

  it('a swing in a new fight first pays a reward still owed from an older fight', () => {
    h.fight({ fightCount: 2, owedLeft: 1 });
    h.db.clatterhornCredit.insert({ identity: A, fight: 1, damage: 40, lastHitTick: h.now(), owed: 1 });
    h.swinger(A, HOME.x, HOME.z - 2);
    h.ctx.sender = MODULE;
    // The payout batch of the next tick would also pay it; the swing must not overwrite an owed row either way.
    h.db.clatterhorn.id.update({ ...h.beetle(), owedLeft: 0 });
    h.run(1);
    expect(h.bag(A)).toContain('gleamshell:2');
    expect(h.db.clatterhornCredit.identity.find(A)).toMatchObject({ fight: 2, damage: 6, owed: 0 });
    expect(h.beetle()).toMatchObject({ owedLeft: 0, challengers: 1 });
  });
});

describe('attack_clatterhorn', () => {
  it('refuses with every message, in order', () => {
    h.place(A, SPIRE_SPAWNS[0].x, SPIRE_SPAWNS[0].z);
    expect(() => h.attack(A)).toThrow('You cannot do that inside the Sunken Spire');
    h.place(A, HOME.x, HOME.z - 6);
    const e = h.db.expedition.insert({ id: 0n, leader: A, stage: 'hauling', carrier: A });
    h.db.expeditionMember.insert({ identity: A, expeditionId: e.id, contributions: 0, cooldown: 0, tracked: false });
    expect(() => h.attack(A)).toThrow('Put down the giant berry first; it needs both hands');
    h.db.expeditionMember.identity.delete(A);
    expect(() => h.attack(A)).toThrow('The glade is quiet: Clatterhorn is away');
    h.configure();
    h.configure({ clatterhornOpen: false });
    expect(() => h.attack(A)).toThrow('The glade is quiet: Clatterhorn is away');
    h.configure();
    h.setBeetle({ state: ClatterState.Burrowed, stateUntilTick: h.now() + 300 });
    expect(() => h.attack(A)).toThrow('The beetle has burrowed away. Clatterhorn returns in 180 s');
    h.setBeetle({ stateUntilTick: h.now() + 7 });
    expect(() => h.attack(A)).toThrow('Clatterhorn returns in 5 s');
    h.place(A, HOME.x, HOME.z - 6, { state: PlayerState.Dead });
    expect(() => h.attack(A)).toThrow('you are dead');
    expect(h.p(A).pending).toBe(Pending.None);
  });

  it('walks into reach, keeps the rhythm when re-selected, and never sets hostile', () => {
    h.configure();
    h.give(A, 0, STICK_ITEM_ID, 1);
    h.place(A, HOME.x, CLATTER_GLADE.z0, { nextSwingTick: h.now() + 3 });
    h.attack(A);
    const a = h.p(A);
    expect(a).toMatchObject({ pending: Pending.Clatterhorn, pendingId: 1n, hostile: false, nextSwingTick: h.now() + 3 });
    expect(chebyshev({ x: a.targetX, z: a.targetZ }, HOME)).toBe(2);
    h.place(A, HOME.x, HOME.z - 2, { targetX: undefined, targetZ: undefined, nextSwingTick: h.now() + 2 });
    h.attack(A);
    expect(h.p(A)).toMatchObject({ pending: Pending.Clatterhorn, nextSwingTick: h.now() + 2, targetX: undefined });
    h.place(A, HOME.x, HOME.z - 2, { pending: 0, pendingId: 0n, nextSwingTick: 0 });
    h.attack(A);
    expect(h.p(A).nextSwingTick).toBe(h.now() + 1);
  });
});

describe('swings, crowd HP and grace', () => {
  it('the first landed swing adds a challenger (+200) before its damage; a second challenger adds 200 more', () => {
    h.fight();
    h.swinger(A, HOME.x, HOME.z - 2);
    h.run(1);
    expect(h.beetle()).toMatchObject({ challengers: 1, maxHp: 500, hp: 494, lastHitTick: h.now() });
    expect(h.notices(BossNoticeKind.YouHit, A)).toEqual([expect.objectContaining({ amount: 6, total: 6, boss: 1 })]);
    // Recipient only: nobody else gets a row for A's swing.
    expect([...h.db.bossNotice.iter()].every((n: any) => n.player.toHexString() === A.toHexString())).toBe(true);
    h.swinger(B, HOME.x + 2, HOME.z, STONE_CLUB_ITEM_ID);
    h.run(1);
    expect(h.beetle()).toMatchObject({ challengers: 2, maxHp: 700, hp: 494 + 200 - 8 });
    h.run(3);
    expect(h.beetle()).toMatchObject({ challengers: 2, maxHp: 700, hp: 494 + 200 - 8 - 6 });
    expect(h.db.clatterhornCredit.identity.find(A)).toMatchObject({ fight: 1, damage: 12, owed: 0 });
    expect(h.p(A).hostile).toBe(false);
  });

  it('caps the challenger count at 120 and clamps HP at 0 (a killing swing defeats it)', () => {
    h.fight({ challengers: 120, hp: 5, maxHp: 18200 });
    h.swinger(A, HOME.x, HOME.z - 2);
    h.run(1);
    expect(h.beetle()).toMatchObject({ state: ClatterState.Burrowed, hp: 0, defeats: 1 });
    expect(h.notices(BossNoticeKind.YouHit, A)[0]).toMatchObject({ amount: 6 });
  });

  it('a player in first-spawn grace who lands a swing is out of grace on the next tick and takes the next blow on its tile', () => {
    h.fight();
    h.swinger(A, HOME.x, HOME.z - 2, STICK_ITEM_ID, { respawnTick: h.now() + 300 });
    h.place(C, HOME.x + 2, HOME.z + 2, { respawnTick: h.now() + 300 });
    // A spin lands in the very tick of the first swing: A was still in grace at the top of it.
    h.setBeetle({ state: ClatterState.SpinWindup, stateUntilTick: h.now() + 1 });
    h.run(1);
    expect(h.notices(BossNoticeKind.YouHit, A)).toHaveLength(1);
    expect(h.p(A).hp).toBe(30);
    expect(inGrace(h.p(A), h.now() + 1)).toBe(false);
    h.setBeetle({ state: ClatterState.SpinWindup, stateUntilTick: h.now() + 1 });
    h.run(1);
    expect(h.p(A).hp).toBe(20);
    expect(h.p(A).pending).toBe(Pending.Clatterhorn);
    expect(h.notices(BossNoticeKind.Hurt, A)).toEqual([expect.objectContaining({ amount: 10, hp: 20, quantity: HurtSource.Spin })]);
    // C stood on the ring in grace and never swung.
    expect(h.p(C).hp).toBe(30);
  });
});

describe('attacks', () => {
  it('a charge lands on end tiles only: the player who stayed takes 14 and keeps swinging, one 2 tiles aside takes 0; grace is skipped', () => {
    h.fight();
    const lane = clatterLane(HOME, 6);  // east
    expect(lane.len).toBeGreaterThanOrEqual(3);
    h.swinger(A, HOME.x + 1, HOME.z);
    h.place(B, HOME.x + 2, HOME.z);
    h.place(C, HOME.x + 2, HOME.z - 1, { respawnTick: h.now() + 300 });
    h.setBeetle({ state: ClatterState.ChargeWindup, attack: 1, dir: 6, endX: lane.end.x, endZ: lane.end.z, endKind: lane.endKind, chain: 0, stateUntilTick: h.now() + 2 });
    h.run(1);
    R(movement.setTarget)(h.as(B), { x: HOME.x + 2, z: HOME.z + 2 });
    h.run(1);
    expect(h.beetle()).toMatchObject({ x: lane.end.x, z: lane.end.z });
    expect(lane.tiles).toContain(tileKey({ x: HOME.x + 1, z: HOME.z }));
    expect(h.p(A)).toMatchObject({ hp: 16, pending: Pending.Clatterhorn });
    expect(h.notices(BossNoticeKind.Hurt, A)).toEqual([expect.objectContaining({ amount: 14, hp: 16, quantity: HurtSource.Charge })]);
    expect(h.p(B)).toMatchObject({ x: HOME.x + 2, z: HOME.z + 2, hp: 30 });
    expect(h.p(C).hp).toBe(30);
  });

  it('after a charge, out-of-reach swingers re-chase to a tile within reach at 2 tiles per tick', () => {
    h.fight();
    const lane = clatterLane(HOME, 2);  // west
    expect(lane.len).toBeGreaterThanOrEqual(4);
    h.swinger(A, HOME.x + 2, HOME.z);
    h.setBeetle({ state: ClatterState.ChargeWindup, attack: 1, dir: 2, endX: lane.end.x, endZ: lane.end.z, endKind: lane.endKind, chain: 0, stateUntilTick: h.now() + 1 });
    h.run(1);
    const a = h.p(A), end = lane.end;
    expect(chebyshev(a, end)).toBeGreaterThan(2);
    expect(a.pending).toBe(Pending.Clatterhorn);
    expect(chebyshev({ x: a.targetX, z: a.targetZ }, end)).toBeLessThanOrEqual(2);
    h.run(1);
    expect(chebyshev(h.p(A), a)).toBe(2);
  });

  it('a swinger still walking in stops at the first tile in reach of where the beetle now stands', () => {
    h.fight();
    h.swinger(A, HOME.x - 7, HOME.z);
    const a0 = h.p(A);
    expect(a0.targetX).toBeDefined();
    expect(chebyshev({ x: a0.targetX, z: a0.targetZ }, HOME)).toBeLessThanOrEqual(2);
    // A charge lands right beside the walker (centre 2 tiles east of A), far from the old target's centre.
    const landed = [{ x: a0.x + 2, z: a0.z }, { x: a0.x + 2, z: a0.z - 1 }, { x: a0.x + 2, z: a0.z + 1 }].find((c) => clatterValidCentre(c))!;
    expect(landed).toBeDefined();
    h.setBeetle({ x: landed.x, z: landed.z });
    h.run(3);
    const a = h.p(A);
    expect(chebyshev(a, landed)).toBeLessThanOrEqual(2);
    expect(a.targetX).toBeUndefined();
    expect(a.pending).toBe(Pending.Clatterhorn);
  });

  it('re-selecting the beetle in reach drops a walk target aimed at its old centre', () => {
    h.fight();
    h.swinger(A, HOME.x + 2, HOME.z);
    h.place(A, HOME.x + 2, HOME.z, { targetX: HOME.x + 9, targetZ: HOME.z });
    h.attack(A);
    expect(h.p(A)).toMatchObject({ pending: Pending.Clatterhorn, targetX: undefined, targetZ: undefined });
  });

  it('aligned bait behind a stone flips it (Flipped 7 ticks in phase 1) and swings deal x2', () => {
    // Find a beetle centre, a stone and a target standing behind it on the charge line.
    let setup: { c: { x: number; z: number }; t: { x: number; z: number }; dir: number } | undefined;
    const stones = new Set(CLATTER_STONES.map(tileKey));
    for (let x = CLATTER_GLADE.x0 + 1; x < CLATTER_GLADE.x1 && !setup; x++) {
      for (let z = CLATTER_GLADE.z0 + 1; z < CLATTER_GLADE.z1 && !setup; z++) {
        const c = { x, z };
        if (!clatterValidCentre(c)) continue;
        for (let dir = 0; dir < 8 && !setup; dir++) {
          const lane = clatterLane(c, dir), [dx, dz] = CLATTER_DIR8[dir];
          if (lane.endKind !== ClatterEndKind.Flip || lane.len < 2) continue;
          const t = { x: lane.end.x + 3 * dx, z: lane.end.z + 3 * dz };
          if (!inBossRect(t, CLATTER_GLADE) || stones.has(tileKey(t)) || chebyshev(t, c) <= 2) continue;
          const chosen = clatterChooseLane(c, t, 0);
          if (chosen?.dir === dir && chosen.endKind === ClatterEndKind.Flip) setup = { c, t, dir };
        }
      }
    }
    expect(setup).toBeDefined();
    const { c, t, dir } = setup!;
    h.fight({ state: ClatterState.Idle, stateUntilTick: 0, x: c.x, z: c.z, attackCount: 0 });
    h.place(B, t.x, t.z);
    h.run(1);
    expect(h.beetle()).toMatchObject({ state: ClatterState.ChargeWindup, dir, endKind: ClatterEndKind.Flip, stateUntilTick: h.now() + 3 });
    h.run(3);
    const landed = h.now();
    expect(h.beetle()).toMatchObject({ state: ClatterState.Flipped, stateUntilTick: landed + 7 });
    expect(h.p(B).hp).toBe(30);
    const end = h.beetle();
    h.swinger(A, end.x, end.z);
    h.run(1);
    expect(h.notices(BossNoticeKind.YouHit, A)[0]).toMatchObject({ amount: 12 });
  });

  it('the spin hits Chebyshev ring 2 only', () => {
    h.fight();
    h.place(A, HOME.x + 2, HOME.z - 1);
    h.place(B, HOME.x + 1, HOME.z + 1);
    h.place(C, HOME.x - 3, HOME.z);
    h.setBeetle({ state: ClatterState.SpinWindup, attack: 2, stateUntilTick: h.now() + 1 });
    expect(clatterSpinTiles(HOME)).toContain(tileKey({ x: HOME.x + 2, z: HOME.z - 1 }));
    h.run(1);
    expect([h.p(A).hp, h.p(B).hp, h.p(C).hp]).toEqual([20, 30, 30]);
    expect(h.beetle()).toMatchObject({ state: ClatterState.Recover, stateUntilTick: h.now() + 2 });
  });

  it('from phase 2 a Shell Slam hits the body (the eye) and spares ring 2', () => {
    let n = 0;
    while (!clatterSlam({ attack: 2, phase: 2, fightCount: 1, attackCount: n })) n++;
    h.fight({ phase: 2 });
    h.place(A, HOME.x + 2, HOME.z - 1);   // ring 2: safe from a slam
    h.place(B, HOME.x + 1, HOME.z + 1);   // the eye: hit
    h.place(C, HOME.x, HOME.z);           // under its centre: hit
    h.setBeetle({ state: ClatterState.SpinWindup, attack: 2, attackCount: n, stateUntilTick: h.now() + 1 });
    expect(clatterTelegraph(h.beetle())).toMatchObject({ attack: 'slam', tiles: clatterSlamTiles(HOME) });
    h.run(1);
    expect([h.p(A).hp, h.p(B).hp, h.p(C).hp]).toEqual([30, 20, 20]);
    expect(h.notices(BossNoticeKind.Hurt, B)).toEqual([expect.objectContaining({ amount: 10, quantity: HurtSource.Spin })]);
  });

  it('swings never land from outside the glade: a swinger standing there walks in first', () => {
    const edge = { x: CLATTER_GLADE.x0 + 1, z: HOME.z };
    h.fight({ x: edge.x, z: edge.z });
    h.swinger(A, CLATTER_GLADE.x0 - 1, HOME.z);
    // The walk goal is a glade tile within reach.
    expect(h.p(A).targetX).toBeGreaterThanOrEqual(CLATTER_GLADE.x0);
    // A stale swinger outside with no walk target is re-pathed by the tick instead of landing a free hit.
    h.place(A, CLATTER_GLADE.x0 - 1, HOME.z, { targetX: undefined, targetZ: undefined, nextSwingTick: 0 });
    const hp = h.beetle().hp;
    h.run(1);
    expect(h.notices(BossNoticeKind.YouHit, A)).toEqual([]);
    expect(h.beetle().hp).toBe(hp);
    expect(h.p(A).pending).toBe(Pending.Clatterhorn);
    for (let i = 0; i < 6 && h.notices(BossNoticeKind.YouHit, A).length === 0; i++) h.run(1);
    expect(h.notices(BossNoticeKind.YouHit, A)).toHaveLength(1);
    expect(h.p(A).x).toBeGreaterThanOrEqual(CLATTER_GLADE.x0);
  });

  it('in phase 2 the swarm hits a stationary player in a used column, never one in a free column, and nothing else lands while it is live', () => {
    h.fight({ phase: 2, state: ClatterState.DrumWindup, attack: 3, swarmSide: 0, swarmFree: 0, stateUntilTick: h.now() + 1, attackCount: 6 });
    const free = clatterSwarmFreeLines({ ...h.beetle(), swarmTick: h.now() + 1 });
    expect(free).toContain(79);
    expect(free).not.toContain(77);
    h.place(A, 77, 105);   // column i = 1: wave A
    h.place(B, 79, 105);   // column i = 3: free
    h.place(C, 78, 109);   // column i = 2: wave B
    h.run(1);
    const F = h.now();
    expect(h.beetle()).toMatchObject({ state: ClatterState.Drumming, swarmTick: F, stateUntilTick: F + 20 });
    h.run(20);
    // No i-frames against runners: a stationary player is hit as its runner arrives and again as it leaves cardinally.
    expect(h.p(A).hp).toBe(20);
    expect(h.p(C).hp).toBe(20);
    expect(h.p(B).hp).toBe(30);
    const hurts = [...h.db.bossNotice.iter()].filter((n: any) => n.kind === BossNoticeKind.Hurt);
    expect(hurts.every((n: any) => n.quantity === HurtSource.Runner && n.amount === 5)).toBe(true);
    expect(hurts).toHaveLength(4);
    // At most one runner hit per player per tick.
    expect(new Set(hurts.map((n: any) => `${n.tick}:${n.player.toHexString()}`)).size).toBe(4);
    expect(h.beetle().state).toBe(ClatterState.Recover);
  });

  it('a runner hitting a 2-HP player writes hp 0 (not 254) and the Hurt notice says 0', () => {
    h.fight({ phase: 2, state: ClatterState.DrumWindup, attack: 3, swarmSide: 0, swarmFree: 0, stateUntilTick: h.now() + 1 });
    h.place(A, 77, 100, { hp: 2 });
    for (let i = 0; i < 12 && h.notices(BossNoticeKind.Hurt, A).length === 0; i++) h.run(1);
    const hurt = h.notices(BossNoticeKind.Hurt, A);
    expect(hurt).toEqual([expect.objectContaining({ amount: 5, hp: 0, quantity: HurtSource.Runner })]);
    expect(h.p(A).hp).toBe(0);
    expect(h.p(A).state).toBe(PlayerState.Dead);
  });
});

describe('defeat and rewards', () => {
  /** n extra online contributors with qualifying credit, standing outside the glade. */
  let next = 100;
  const crowd = (n: number, fight: number, over: (i: number) => object = () => ({})) => {
    const ids: Identity[] = [];
    for (let i = 0; i < n; i++) {
      const who = id(next++);
      h.db.player.insert(playerRow(who, `P${i}`, { x: 40, z: 40 }));
      h.db.clatterhornCredit.insert({ identity: who, fight, damage: 16, lastHitTick: h.now(), owed: 0, ...over(i) });
      ids.push(who);
    }
    return ids;
  };

  it('pays 30 qualifying contributors 25 then 5 over two ticks, nobody else, then stays Burrowed 300 ticks', () => {
    h.fight({ hp: 3, maxHp: 350, challengers: 1 });
    const paid = crowd(29, 1);
    const [short] = crowd(1, 1, () => ({ damage: 15 }));
    const [old] = crowd(1, 1, () => ({ fight: 0 }));
    const [offline] = crowd(1, 1);
    h.db.player.identity.update({ ...h.p(offline), online: false });
    h.db.clatterhornCredit.insert({ identity: A, fight: 1, damage: 20, lastHitTick: h.now(), owed: 0 });
    h.swinger(A, HOME.x, HOME.z - 2);
    h.place(B, HOME.x + 2, HOME.z, { pending: Pending.Clatterhorn, pendingId: 1n, targetX: HOME.x + 1, targetZ: HOME.z });
    h.run(1);
    const T = h.now();
    expect(h.beetle()).toMatchObject({ state: ClatterState.Burrowed, stateUntilTick: T + 300, hp: 0, defeats: 1, owedLeft: 30, x: HOME.x, z: HOME.z, fightCount: 1 });
    expect(h.events(BossEventKind.ClatterDefeat)).toEqual([expect.objectContaining({ quantity: 30 })]);
    expect(h.p(A).pending).toBe(Pending.None);
    expect(h.p(B)).toMatchObject({ pending: Pending.None, targetX: undefined });
    for (const who of [short, old, offline]) expect(h.db.clatterhornCredit.identity.find(who)).toBeUndefined();
    expect(h.db.clatterhornCredit.rows.size).toBe(30);

    h.run(1);
    expect(h.beetle().owedLeft).toBe(5);
    expect(h.db.clatterhornCredit.rows.size).toBe(5);
    h.run(1);
    expect(h.beetle().owedLeft).toBe(0);
    expect(h.db.clatterhornCredit.rows.size).toBe(0);
    for (const who of [A, ...paid]) {
      expect(h.bag(who).filter((s) => !s.startsWith('stick'))).toEqual(['berry_goldberry:2', 'gleamshell:2']);
      expect(h.db.playerCosmetic.identity.find(who).unlocked & (1 << Cosmetic.ClatterhornHorn)).toBeTruthy();
      expect(h.notices(BossNoticeKind.Reward, who)).toHaveLength(2);
      expect(h.notices(BossNoticeKind.Keepsake, who)).toEqual([expect.objectContaining({ quantity: 12 })]);
      // No combat power: same max HP.
      expect(h.p(who).maxHp).toBe(30);
    }
    for (const who of [short, old, offline, B]) expect(h.bag(who)).toEqual([]);
    expect(h.db.adventureProfile.identity.find(A)).toBeDefined();
    // Burrowed for 300 ticks, then back home Dormant (fightCount kept).
    expect(() => h.attack(A)).toThrow(/The beetle has burrowed away/);
    h.run(297);
    expect(h.beetle().state).toBe(ClatterState.Burrowed);
    h.run(1);
    expect(h.beetle()).toMatchObject({ state: ClatterState.Dormant, hp: 300, fightCount: 1, defeats: 1 });
    expect(h.events(BossEventKind.ClatterRespawn)).toHaveLength(1);
  });

  it('a contributor who swung twice then stood elsewhere for 101+ ticks is not paid; one who swung within 100 ticks is', () => {
    h.fight();
    h.swinger(A, HOME.x, HOME.z - 2, STONE_CLUB_ITEM_ID);
    h.run(5);
    expect(h.db.clatterhornCredit.identity.find(A)).toMatchObject({ damage: 16 });
    R(movement.setTarget)(h.as(A), { x: HOME.x, z: CLATTER_GLADE.z0 - 3 });
    h.swinger(B, HOME.x + 2, HOME.z, STONE_CLUB_ITEM_ID);
    h.run(101);
    expect(h.p(A).pending).toBe(Pending.None);
    h.setBeetle({ hp: 1 });
    h.run(4);
    expect(h.beetle().state).toBe(ClatterState.Burrowed);
    h.run(1);
    expect(h.bag(B)).toContain('gleamshell:2');
    expect(h.bag(A)).not.toContain('gleamshell:2');
  });
});

describe('owner effects (configure_bosses, boss_debug)', () => {
  it('open -> closed drops every swinger and deletes unowed credit; owed rewards still pay while closed and after a reopen', () => {
    h.fight({ owedLeft: 1, fightCount: 4 });
    h.swinger(A, HOME.x, CLATTER_GLADE.z0);
    expect(h.p(A).targetX).toBeDefined();
    h.db.clatterhornCredit.insert({ identity: B, fight: 4, damage: 40, lastHitTick: h.now(), owed: 0 });
    h.db.clatterhornCredit.insert({ identity: C, fight: 3, damage: 40, lastHitTick: h.now(), owed: 1 });
    h.configure({ clatterhornOpen: false });
    expect(h.beetle()).toMatchObject({ state: ClatterState.Closed, fightCount: 4, owedLeft: 1 });
    expect(h.p(A)).toMatchObject({ pending: Pending.None, targetX: undefined });
    expect([...h.db.clatterhornCredit.iter()].map((c: any) => c.identity.toHexString())).toEqual([C.toHexString()]);
    expect(() => h.attack(A)).toThrow('The glade is quiet: Clatterhorn is away');
    h.run(1);
    expect(h.bag(C)).toEqual(['berry_goldberry:2', 'gleamshell:2']);
    expect(h.beetle()).toMatchObject({ state: ClatterState.Closed, owedLeft: 0 });

    // Reopen with an owed row: still paid, fightCount kept, and the next fight's first swing is a new challenger.
    h.db.clatterhornCredit.insert({ identity: B, fight: 4, damage: 40, lastHitTick: h.now(), owed: 1 });
    h.setBeetle({ owedLeft: 1 });
    h.configure();
    expect(h.beetle()).toMatchObject({ state: ClatterState.Dormant, hp: 300, maxHp: 300, fightCount: 4, owedLeft: 1 });
    h.swinger(A, HOME.x, HOME.z - 2);
    h.run(1);
    expect(h.bag(B)).toContain('gleamshell:2');
    expect(h.beetle()).toMatchObject({ state: ClatterState.Idle, fightCount: 5, owedLeft: 0 });
    h.run(1);
    expect(h.beetle()).toMatchObject({ challengers: 1, maxHp: 500 });
    expect(h.db.clatterhornCredit.identity.find(A)).toMatchObject({ fight: 5, damage: 6 });
  });

  it('boss_debug clatter_wake, clatter_hp, clatter_drum and clatter_respawn through the real reducer', () => {
    expect(() => h.debug('clatter_wake')).toThrow('The glade is quiet: Clatterhorn is away');
    h.configure();
    h.place(A, HOME.x + 4, HOME.z);
    h.debug('clatter_wake');
    expect(h.beetle()).toMatchObject({ state: ClatterState.Idle, fightCount: 1, engagedTick: h.now() });
    expect(h.events(BossEventKind.ClatterWake)).toEqual([expect.objectContaining({ quantity: 1 })]);
    expect(() => h.debug('clatter_wake')).toThrow('The beetle is already awake');

    h.setBeetle({ maxHp: 350, hp: 350 });
    h.debug('clatter_hp', 40);
    expect(h.beetle().hp).toBe(140);
    h.debug('clatter_hp', 0);
    expect(h.beetle().hp).toBe(1);
    h.setBeetle({ hp: 350 });

    h.setBeetle({ state: ClatterState.Recover, stateUntilTick: h.now() + 1, attackCount: 2 });
    h.debug('clatter_drum');
    expect(h.beetle()).toMatchObject({ phase: 2, attackCount: 4 });
    h.run(1);
    expect(h.beetle()).toMatchObject({ state: ClatterState.DrumWindup, attackCount: 5 });

    expect(() => h.debug('clatter_respawn')).toThrow('The beetle is not burrowed');
    h.setBeetle({ state: ClatterState.Burrowed, stateUntilTick: h.now() + 300, hp: 0 });
    expect(() => h.debug('clatter_hp', 50)).toThrow('The beetle is not fighting');
    h.debug('clatter_respawn');
    expect(h.beetle()).toMatchObject({ state: ClatterState.Dormant, hp: 300, x: HOME.x, z: HOME.z, fightCount: 1 });
    expect(h.events(BossEventKind.ClatterRespawn)).toHaveLength(1);
  });
});
