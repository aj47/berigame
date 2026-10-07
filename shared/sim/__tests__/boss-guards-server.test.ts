import { adventureTables, testTable } from './adventureHarness';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EAT_COOLDOWN_TICKS } from '../constants';
import { PlayerState } from '../types';
import { RECIPES } from '../nodes';
import { STICK_ITEM_ID, STONE_CLUB_ITEM_ID } from '../items';
import { chebyshev } from '../grid';
import {
  BOSS_CONFIG_DEFAULTS, SPIRE_EXIT, SPIRE_GATE, SPIRE_MEALS, SPIRE_SPAWNS, SpireMemberState, SpireMode, SpireStage, inBoulders, inSpireFloor, inSpireGateZone,
} from '../index';
import { advance, seedCreatures } from '../frontier/engine';
import { newProfile } from '../frontier/model';
import { REGIONS } from '../frontier/catalog';
import { isHomeTarget } from '../frontier/homeMap';
import type { Actor, Repository, World } from '../frontier/model';

// Real reducers against an in-memory database (the harness of server-reducers.test.ts and
// frontier-server.test.ts): reducers become raw handlers, every table is a testTable.
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
// The boss effects belong to WP4/WP5; here only their dispatch is observed.
vi.mock('../../../spacetimedb/src/lib/clatterhorn', async (original) => ({
  ...(await original<typeof import('../../../spacetimedb/src/lib/clatterhorn')>()),
  clatterClose: vi.fn(), clatterOpen: vi.fn(), clatterDebug: vi.fn(),
}));
vi.mock('../../../spacetimedb/src/lib/spire', async (original) => ({
  ...(await original<typeof import('../../../spacetimedb/src/lib/spire')>()),
  spireCloseMode: vi.fn(), spireDebug: vi.fn(),
}));

import * as combat from '../../../spacetimedb/src/reducers/combat';
import * as inventory from '../../../spacetimedb/src/reducers/inventory';
import * as tradeReducers from '../../../spacetimedb/src/reducers/trade';
import * as adventure from '../../../spacetimedb/src/reducers/adventure';
import * as craftReducers from '../../../spacetimedb/src/reducers/craft';
import * as frontier from '../../../spacetimedb/src/reducers/frontier';
import * as harvest from '../../../spacetimedb/src/reducers/harvest';
import * as social from '../../../spacetimedb/src/reducers/social';
import * as giant from '../../../spacetimedb/src/reducers/giant';
import * as garden from '../../../spacetimedb/src/reducers/garden';
import * as friends from '../../../spacetimedb/src/reducers/friends';
import * as admin from '../../../spacetimedb/src/reducers/bossAdmin';
import { tick as registeredTick } from '../../../spacetimedb/src/reducers/tick';
import { countRaiders } from '../../../spacetimedb/src/lib/raid';
import { statsPosition } from '../../../spacetimedb/src/lib/stats';
import { frontierRepository, projectFrontier } from '../../../spacetimedb/src/lib/frontier';
import { clatterClose, clatterDebug, clatterOpen } from '../../../spacetimedb/src/lib/clatterhorn';
import { spireCloseMode, spireDebug } from '../../../spacetimedb/src/lib/spire';

type Reducer = (ctx: any, args?: any) => void;
const R = (f: unknown) => f as Reducer;

/** Identity stand-ins: the server code compares and indexes identities by their hex string only. */
type Identity = { toHexString(): string; __identity__: bigint };
const id = (n: number): Identity => {
  const hex = n.toString(16).padStart(64, '0');
  return { toHexString: () => hex, __identity__: BigInt(n) };
};
const A = id(1), B = id(2), C = id(3), OWNER = id(9), MODULE = id(10);

/** Primary keys of the tables the reducers touch; anything else is an autoInc event or row table. */
const KEYS: Record<string, [string, boolean]> = {
  player: ['identity', false], playerGrant: ['identity', false], appearance: ['identity', false], emoteCooldown: ['identity', false],
  playStats: ['identity', false], giantContribution: ['identity', false], mentee: ['identity', false], mentorStat: ['identity', false],
  world: ['id', false], accessPolicy: ['id', false], tree: ['id', false], trainingDummy: ['id', false], giant: ['id', false],
  giantRaid: ['id', false], inviteCode: ['code', false], socialPair: ['pair', false],
};

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
  for (const [who, name] of [[A, 'Ann'], [B, 'Bo'], [C, 'Cy']] as const) {
    db.player.insert({
      identity: who, name, online: true, connections: 1, region: 'bramblewild', x: 35, z: 25, facing: 0,
      targetX: undefined, targetZ: undefined, hp: 20, maxHp: 30, state: PlayerState.Alive, respawnTick: 0,
      stance: 0, fightState: 0, combatTarget: undefined, hostile: false, nextSwingTick: 0, harvestTreeId: 0, harvestEndTick: 0,
      pending: 0, pendingId: 0n, lastInputTick: 0, inputsThisTick: 0, eatCooldownUntilTick: 0, weapon: '',
    });
  }
  const p = (who: Identity) => db.player.identity.find(who);
  const place = (who: Identity, x: number, z: number, extra: object = {}) => db.player.identity.update({ ...p(who), x, z, ...extra });
  const give = (who: Identity, slot: number, itemId: string, quantity: number) =>
    db.inventorySlot.insert({ id: 0n, owner: who, slot, itemId, quantity });
  const bag = (who: Identity) => [...db.inventorySlot.owner.filter(who)].map((r: any) => `${r.slot}:${r.itemId}:${r.quantity}`).sort();
  const as = (who: Identity) => { ctx.sender = who; return ctx; };
  const setTick = (T: number) => db.world.id.update({ id: 0, tick: T });
  /** A run with members inserted directly (the WP4 reducers are not needed for guards). */
  const run = (stage: number, members: Identity[]) => {
    const row = db.spireRun.insert({
      id: 0n, leader: members[0], stage, outcome: 0, mode: SpireMode.Normal, isPublic: true, rules: 1, partySize: members.length,
      createdTick: 90, queuedTick: 0, startTick: stage === SpireStage.Active ? 95 : 0, endTick: 1000, phase: 1, clearTicks: 0,
    });
    members.forEach((who, slot) => db.spireMember.insert({
      identity: who, runId: row.id, slot, state: stage === SpireStage.Active ? SpireMemberState.In : SpireMemberState.Lobby,
      joinedTick: 90, awaySinceTick: 0, awayCount: 0, downUntilTick: 0, reviveSinceTick: 0, meals: 0,
    }));
    return row.id as bigint;
  };
  /** `who` stands on the floor as an In member of a fresh Active run. */
  const inside = (who: Identity, slot = 0) => {
    const runId = run(SpireStage.Active, [who]);
    const s = SPIRE_SPAWNS[slot];
    place(who, s.x, s.z);
    return runId;
  };
  return { ctx, db, p, place, give, bag, as, setTick, run, inside };
}

let h: ReturnType<typeof harness>;
beforeEach(() => { h = harness(); vi.clearAllMocks(); });

const GLADE = { x: 84, z: 104 };
const NEAR_GATE = { x: SPIRE_GATE.x, z: SPIRE_GATE.z - 1 };

describe('combat guards (attack, follow)', () => {
  const attack = R(combat.attack), follow = R(combat.follow);

  it('refuses attacks with either player on the floor', () => {
    h.inside(A);
    h.place(B, SPIRE_SPAWNS[1].x, SPIRE_SPAWNS[1].z);
    expect(() => attack(h.as(A), { target: B })).toThrow('No fighting inside the Sunken Spire');
    h.place(A, 40, 25);
    expect(() => attack(h.as(A), { target: B })).toThrow('No fighting inside the Sunken Spire');
    expect(h.p(A).hostile).toBe(false);
  });

  it("refuses attacks in Clatterhorn's Glade and at the Spire gate (either player)", () => {
    h.place(A, GLADE.x, GLADE.z); h.place(B, GLADE.x + 1, GLADE.z);
    expect(() => attack(h.as(A), { target: B })).toThrow("No fighting in Clatterhorn's Glade");
    h.place(A, 75, 104);
    expect(() => attack(h.as(A), { target: B })).toThrow("No fighting in Clatterhorn's Glade");
    h.place(A, NEAR_GATE.x, NEAR_GATE.z); h.place(B, NEAR_GATE.x + 1, NEAR_GATE.z);
    expect(() => attack(h.as(A), { target: B })).toThrow('No fighting at the Spire gate');
    expect(h.p(A).combatTarget).toBeUndefined();
  });

  it('still allows ordinary attacks elsewhere', () => {
    h.place(B, 36, 25);
    attack(h.as(A), { target: B });
    expect(h.p(A).hostile).toBe(true);
  });

  it('refuses follow across the boundary and between runs, allows it inside one run', () => {
    h.inside(A);
    expect(() => follow(h.as(B), { target: A })).toThrow('You cannot follow players into or out of the Sunken Spire');
    expect(() => follow(h.as(A), { target: B })).toThrow('You cannot follow players into or out of the Sunken Spire');
    h.inside(B, 1); // a second run on the same tiles
    expect(() => follow(h.as(A), { target: B })).toThrow('You cannot follow players into or out of the Sunken Spire');
    // C joins A's run.
    const runA = h.db.spireMember.identity.find(A).runId;
    h.db.spireMember.insert({ ...h.db.spireMember.identity.find(A), identity: C, slot: 2, runId: runA });
    h.place(C, SPIRE_SPAWNS[2].x, SPIRE_SPAWNS[2].z);
    follow(h.as(C), { target: A });
    expect(h.p(C).combatTarget?.toHexString()).toBe(A.toHexString());
    expect(h.p(C).hostile).toBe(false);
  });
});

describe('trade, duel, drop, pickup and craft guards', () => {
  it('refuses trade requests with either player on the floor', () => {
    h.inside(A);
    h.place(B, SPIRE_SPAWNS[1].x, SPIRE_SPAWNS[1].z);
    expect(() => R(tradeReducers.requestTrade)(h.as(A), { target: B })).toThrow('You cannot trade inside the Sunken Spire');
    expect(() => R(tradeReducers.requestTrade)(h.as(C), { target: A })).toThrow('You cannot trade inside the Sunken Spire');
    expect([...h.db.trade.iter()]).toHaveLength(0);
  });

  it('refuses duel challenges and accepts with either player on the floor, but lets a duel be declined', () => {
    h.inside(A);
    h.place(B, SPIRE_SPAWNS[1].x, SPIRE_SPAWNS[1].z);
    expect(() => R(adventure.duelAction)(h.as(A), { action: 'challenge', target: B })).toThrow('You cannot duel inside the Sunken Spire');
    expect(() => R(adventure.duelAction)(h.as(C), { action: 'accept', target: A })).toThrow('You cannot duel inside the Sunken Spire');
    R(adventure.duelAction)(h.as(A), { action: 'decline', target: C });
    expect([...h.db.friendlyDuel.iter()]).toHaveLength(0);
  });

  it('refuses drops, pickups and crafting on the floor', () => {
    h.inside(A);
    h.give(A, 0, 'berry_blueberry', 3);
    expect(() => R(inventory.dropItem)(h.as(A), { slot: 0, quantity: 1 })).toThrow('You cannot drop items inside the Sunken Spire');
    expect(h.bag(A)).toEqual(['0:berry_blueberry:3']);
    const item = h.db.groundItem.insert({ id: 0n, itemId: 'berry_blueberry', quantity: 1, x: SPIRE_SPAWNS[0].x + 1, z: SPIRE_SPAWNS[0].z, droppedTick: 1 });
    expect(() => R(inventory.pickupItem)(h.as(A), { id: item.id })).toThrow('You cannot pick that up inside the Sunken Spire');
    expect(() => R(craftReducers.craft)(h.as(A), { recipe: RECIPES[0].id })).toThrow('You cannot craft inside the Sunken Spire');
    expect([...h.db.groundItem.iter()]).toHaveLength(1);
  });
});

describe('the meal cap', () => {
  const eat = R(inventory.eatBerry);

  it(`allows ${SPIRE_MEALS} meals per member per run, then refuses without spending food`, () => {
    h.inside(A);
    h.give(A, 0, 'berry_goldberry', 10);
    let T = 100;
    for (let i = 0; i < SPIRE_MEALS; i++) {
      h.setTick(T); h.place(A, SPIRE_SPAWNS[0].x, SPIRE_SPAWNS[0].z, { hp: 5 });
      eat(h.as(A), { slot: 0 });
      T += EAT_COOLDOWN_TICKS;
    }
    expect(h.db.spireMember.identity.find(A).meals).toBe(SPIRE_MEALS);
    expect(h.bag(A)).toEqual(['0:berry_goldberry:4']);
    h.setTick(T);
    expect(() => eat(h.as(A), { slot: 0 })).toThrow(`You have eaten your fill in the Spire (${SPIRE_MEALS}/${SPIRE_MEALS})`);
    expect(h.bag(A)).toEqual(['0:berry_goldberry:4']);
    expect(h.db.spireMember.identity.find(A).meals).toBe(SPIRE_MEALS);
  });

  it('counts no meal for a refused bite (still chewing) or off the floor', () => {
    h.inside(A);
    h.give(A, 0, 'berry_goldberry', 3);
    eat(h.as(A), { slot: 0 });
    expect(() => eat(h.as(A), { slot: 0 })).toThrow('still chewing');
    expect(h.db.spireMember.identity.find(A).meals).toBe(1);
    // A Lobby member waiting outside eats freely.
    h.run(SpireStage.Lobby, [B]);
    h.give(B, 0, 'berry_goldberry', 2);
    eat(h.as(B), { slot: 0 });
    expect(h.db.spireMember.identity.find(B).meals).toBe(0);
  });
});

describe('frontier, harvest, dummy, Giant, garden and expedition guards', () => {
  it('refuses region actions on the floor', () => {
    h.inside(A);
    expect(() => R(frontier.frontierAction)(h.as(A), { command: JSON.stringify({ action: 'enter' }) }))
      .toThrow('You cannot use region actions inside the Sunken Spire');
  });

  it.each([
    ['startHarvest', () => R(harvest.startHarvest)(h.ctx, { treeId: 1 })],
    ['attackDummy', () => R(social.attackDummy)(h.ctx, { dummyId: 1 })],
    ['attackGiant', () => R(giant.attackGiant)(h.ctx, { giantId: 1 })],
    ['plantGarden', () => R(garden.plantGarden)(h.ctx, { plot: 0, itemId: 'berry_blueberry' })],
    ['harvestGarden', () => R(garden.harvestGarden)(h.ctx, { plot: 0 })],
    ['expeditionAction', () => R(adventure.expeditionAction)(h.ctx, { action: 'start', expeditionId: 0n, target: undefined, x: 0, z: 0, destination: 'market' })],
  ])('%s on the floor: "You cannot do that inside the Sunken Spire"', (_name, call) => {
    h.db.tree.insert({ id: 1, x: SPIRE_SPAWNS[0].x + 1, z: SPIRE_SPAWNS[0].z, itemId: 'berry_blueberry', harvester: undefined, cooldownUntilTick: 0 });
    h.inside(A);
    h.as(A);
    expect(call).toThrow('You cannot do that inside the Sunken Spire');
    expect(h.p(A).pending).toBe(0);
  });
});

describe('the frontier lobby guard', () => {
  function enableFrontier() {
    const repo = frontierRepository(h.ctx);
    repo.put('config', { id: 'world', enabled: true, pausedAt: 0, sequence: 0 });
    for (const who of [A, B]) repo.put('profile', newProfile(who.toHexString()));
    projectFrontier(h.ctx, repo);
    for (const who of [A, B]) { h.give(who, 0, STICK_ITEM_ID, 1); h.give(who, 1, STONE_CLUB_ITEM_ID, 1); }
    h.place(A, 22, 18); h.place(B, 22, 19);
  }
  const enter = (who: Identity) => R(frontier.frontierAction)(h.as(who), { command: JSON.stringify({ action: 'enter' }) });

  it('refuses a Meadows walk for a Lobby member and leaves the player row unchanged', () => {
    enableFrontier();
    h.run(SpireStage.Lobby, [A]);
    const before = { ...h.p(A) };
    expect(() => enter(A)).toThrow('You are waiting in a Spire party; leave it first');
    const after = h.p(A);
    for (const key of ['region', 'x', 'z', 'targetX', 'targetZ'] as const) expect(after[key]).toEqual(before[key]);
  });

  it('allows the same walk for a player outside any party', () => {
    enableFrontier();
    enter(B);
    const b = h.p(B);
    expect(isHomeTarget({ x: b.targetX, z: b.targetZ })).toBe(true);
  });
});

describe('invites and the floor', () => {
  const redeem = R(friends.redeemInvite);
  const code = (inviter: Identity, c = 'ABCDEFGH') => {
    h.db.inviteCode.insert({ code: c, inviter, expiresAtMicros: h.ctx.timestamp.microsSinceUnixEpoch + 1_000_000_000n });
    return c;
  };

  it('a redeemer on the floor becomes a friend but is not moved', () => {
    h.inside(A);
    h.place(B, 30, 30);
    redeem(h.as(A), { code: code(B) });
    expect(h.p(A).x).toBe(SPIRE_SPAWNS[0].x);
    expect(h.p(A).z).toBe(SPIRE_SPAWNS[0].z);
    expect([...h.db.friend.owner.filter(A)]).toHaveLength(1);
    const notice = [...h.db.socialEvent.iter()].find((n: any) => n.to.toHexString() === A.toHexString());
    expect(notice.text).toMatch(/Meet them after your Spire run\.$/);
  });

  it('an inviter on the floor lands joiners near the exit, never on the floor', () => {
    h.inside(B);
    h.place(A, 30, 30);
    h.give(A, 0, STICK_ITEM_ID, 1); h.give(A, 1, STONE_CLUB_ITEM_ID, 1);
    redeem(h.as(A), { code: code(B) });
    const a = h.p(A);
    expect(inSpireFloor(a)).toBe(false);
    expect(chebyshev(a, SPIRE_EXIT)).toBeLessThanOrEqual(2);
  });
});

describe('tick and library guards', () => {
  it('phaseDeath never drops a bag on the floor', () => {
    h.inside(A);
    h.give(A, 0, 'berry_blueberry', 3);
    h.give(A, 1, STICK_ITEM_ID, 1);
    h.place(A, SPIRE_SPAWNS[0].x, SPIRE_SPAWNS[0].z, { hp: 0 });
    h.ctx.sender = h.ctx.identity;
    R(registeredTick)(h.ctx, { timer: {} });
    expect(h.p(A).state).toBe(PlayerState.Alive);
    expect(h.bag(A)).toEqual(['0:berry_blueberry:3', '1:stick:1']);
    expect([...h.db.groundItem.iter()]).toHaveLength(0);
  });

  it('countRaiders ignores players waiting in the Spire gate zone', () => {
    const at = (x: number, z: number) => ({ online: true, state: PlayerState.Alive, x, z }) as any;
    expect(countRaiders([at(NEAR_GATE.x, NEAR_GATE.z)])).toBe(0);
    expect(countRaiders([at(SPIRE_GATE.x + 3, SPIRE_GATE.z + 3)])).toBe(0);
    // Outside the gate zone but inside the Boulders still counts.
    let raider: { x: number; z: number } | undefined;
    for (let x = 40; x < 100 && !raider; x++) for (let z = 40; z < 100 && !raider; z++) {
      if (inBoulders({ x, z }) && !inSpireGateZone({ x, z })) raider = { x, z };
    }
    expect(countRaiders([at(raider!.x, raider!.z), at(NEAR_GATE.x, NEAR_GATE.z)])).toBe(1);
  });

  it('statsPosition skips the floor (no play_stats read per dodge)', () => {
    const find = vi.fn(() => undefined);
    const ctx: any = { db: { playStats: { identity: { find, update: vi.fn() }, insert: vi.fn() } }, timestamp: { microsSinceUnixEpoch: 1n } };
    statsPosition(ctx, A as any, SPIRE_SPAWNS[0]);
    expect(find).not.toHaveBeenCalled();
    statsPosition(ctx, A as any, NEAR_GATE);
    expect(find).toHaveBeenCalled();
  });

  it('a companion does not teleport to an owner on the floor', () => {
    let data: Record<string, any> = {};
    const repo: Repository = {
      get: (k, key) => structuredClone(data[`${k}:${key}`]),
      all: (k) => Object.entries(data).filter(([key]) => key.startsWith(k + ':')).map(([, v]) => structuredClone(v)),
      put: (k, v) => { data[`${k}:${v.id}`] = structuredClone(v); },
      remove: (k, key) => { delete data[`${k}:${key}`]; },
    };
    const owner: Actor = { id: 'a', region: 'bramblewild', ...SPIRE_SPAWNS[0], online: true, alive: true, hp: 30, weapon: '', combat: false, hostile: false, bag: Array(28).fill(null) };
    const w: World = { repo, actors: [owner], now: 10 * 86_400_000, save: () => {} };
    repo.put('config', { id: 'world', enabled: true, pausedAt: 0, sequence: 0 });
    repo.put('profile', newProfile('a'));
    seedCreatures(w);
    const pet: any = { ...repo.all('creature')[0], owner: 'a', active: true, region: 'settlement', ...REGIONS.settlement.spawn, nextMove: 0 };
    repo.put('creature', pet);
    advance(w);
    const still = repo.get('creature', pet.id)!;
    expect([still.region, still.x, still.z]).toEqual([pet.region, pet.x, pet.z]);
    // Off the floor the same companion catches up at once.
    Object.assign(owner, { x: 30, z: 30 });
    w.now += 1000;
    advance(w);
    const moved = repo.get('creature', pet.id)!;
    expect(moved.region).toBe('bramblewild');
    expect(chebyshev(moved, owner)).toBeLessThanOrEqual(1);
  });
});

describe('configure_bosses', () => {
  const configure = R(admin.configureBosses);
  const args = (over: object = {}) => ({ ...BOSS_CONFIG_DEFAULTS, ...over });

  it('requires the world owner', () => {
    expect(() => configure(h.as(A), args({ clatterhornOpen: true }))).toThrow('world owner required');
    expect([...h.db.bossConfig.iter()]).toHaveLength(0);
  });

  it.each([
    { spireMaxRuns: 0 }, { spireMaxRuns: 33 }, { spireHpBase: 49 }, { spireHpBase: 20001 }, { spireHpPerMember: 49 },
    { spireHpPerMember: 20001 }, { clatterHpBase: 49 }, { clatterHpBase: 20001 }, { clatterHpPerChallenger: 49 }, { clatterHpPerChallenger: 20001 },
  ])('refuses %o as out of range', (bad) => {
    expect(() => configure(h.as(OWNER), args({ spireOpen: true, ...bad }))).toThrow('This value is out of range');
    expect([...h.db.bossConfig.iter()]).toHaveLength(0);
    expect(clatterOpen).not.toHaveBeenCalled();
  });

  it('accepts the range limits and upserts row 0', () => {
    configure(h.as(OWNER), args({ spireMaxRuns: 1, spireHpBase: 50, spireHpPerMember: 20000, clatterHpBase: 50, clatterHpPerChallenger: 20000 }));
    configure(h.as(OWNER), args({ clatterhornOpen: true, spireOpen: true, spirePracticeOpen: true, spireMaxRuns: 32 }));
    expect([...h.db.bossConfig.iter()]).toEqual([{ id: 0, ...args({ clatterhornOpen: true, spireOpen: true, spirePracticeOpen: true, spireMaxRuns: 32 }) }]);
  });

  it('dispatches Clatterhorn effects on transitions only and closes the Spire whenever it is closed', () => {
    configure(h.as(OWNER), args());
    expect(clatterOpen).not.toHaveBeenCalled();
    expect(clatterClose).not.toHaveBeenCalled();
    expect(spireCloseMode).toHaveBeenCalledTimes(1);
    expect(spireCloseMode).toHaveBeenLastCalledWith(h.ctx, 100, SpireMode.Normal);
    configure(h.as(OWNER), args({ clatterhornOpen: true, spireOpen: true, clatterHpBase: 300 }));
    expect(clatterOpen).toHaveBeenCalledTimes(1);
    expect(clatterOpen).toHaveBeenLastCalledWith(h.ctx, 100, args({ clatterhornOpen: true, spireOpen: true, clatterHpBase: 300 }));
    expect(spireCloseMode).toHaveBeenCalledTimes(1);
    configure(h.as(OWNER), args({ clatterhornOpen: true, spireOpen: true, clatterHpBase: 400 }));
    expect(clatterOpen).toHaveBeenCalledTimes(1);
    configure(h.as(OWNER), args({ spireOpen: true }));
    expect(clatterClose).toHaveBeenCalledTimes(1);
    expect(clatterClose).toHaveBeenLastCalledWith(h.ctx, 100);
    configure(h.as(OWNER), args());
    expect(spireCloseMode).toHaveBeenCalledTimes(2);
  });
});

describe('boss_debug', () => {
  const debug = R(admin.bossDebug);

  it('requires the world owner', () => {
    expect(() => debug(h.as(A), { op: 'clatter_wake', runId: 0n, value: 0 })).toThrow('world owner required');
    expect(clatterDebug).not.toHaveBeenCalled();
  });

  it('refuses unknown ops', () => {
    for (const op of ['', 'clatter_explode', 'spire_kick', 'SPIRE_HP']) {
      expect(() => debug(h.as(OWNER), { op, runId: 0n, value: 0 })).toThrow('This debug action does not exist');
    }
    expect(clatterDebug).not.toHaveBeenCalled();
    expect(spireDebug).not.toHaveBeenCalled();
  });

  it('refuses run ops on a missing or non-Active run', () => {
    const lobby = h.run(SpireStage.Lobby, [A]);
    for (const op of ['spire_hp', 'spire_phase']) {
      expect(() => debug(h.as(OWNER), { op, runId: 999n, value: 50 })).toThrow('This run is not active');
      expect(() => debug(h.as(OWNER), { op, runId: lobby, value: 50 })).toThrow('This run is not active');
    }
    expect(spireDebug).not.toHaveBeenCalled();
  });

  it('dispatches valid ops to the boss helpers', () => {
    const active = h.run(SpireStage.Active, [B]);
    debug(h.as(OWNER), { op: 'clatter_hp', runId: 0n, value: 40 });
    expect(clatterDebug).toHaveBeenLastCalledWith(h.ctx, 100, 'clatter_hp', 40);
    debug(h.as(OWNER), { op: 'spire_phase', runId: active, value: 3 });
    expect(spireDebug).toHaveBeenLastCalledWith(h.ctx, 100, 'spire_phase', active, 3);
    debug(h.as(OWNER), { op: 'spire_fail_all', runId: 0n, value: 0 });
    expect(spireDebug).toHaveBeenLastCalledWith(h.ctx, 100, 'spire_fail_all', 0n, 0);
  });
});
