import { beforeEach, describe, expect, it, vi } from 'vitest';
import { A, B, C, D, E, OWNER, R, spireHarness, type Identity, type SpireHarness } from './spireHarness';
import { PlayerState, Pending, type Tile } from '../types';
import { EventKind } from '../index';
import { worldBlockedSet } from '../social';
import { SPIRE_FLOOR, SPIRE_EXIT, SPIRE_GATE, spireStandable } from '../bossZones';
import { chebyshev } from '../grid';
import { homePoint, homeTarget, isHomeTarget } from '../frontier/homeMap';
import {
  BossEventKind, BossNoticeKind, HurtSource, SPIRE_KEY_ITEM_ID, PRISM_SHARD_ITEM_ID, SPIRE_MAX_LOBBIES, SPIRE_NONE, SPIRE_PATTERNS,
  SPIRE_POOLS, SPIRE_RULES_VERSION, SPIRE_SPAWNS, SPIRE_STAR_DAMAGE, SpireMemberState, SpireMode, SpireOutcome, SpirePatternKind,
  SpireStage, inSpireCourt, spireFightBullets, spireHitsMove, spireMiddle, spireSeed, spireStars, spireStarWave, BOSS_CONFIG_DEFAULTS,
} from '../index';

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

import * as spire from '../../../spacetimedb/src/reducers/spire';
import * as admin from '../../../spacetimedb/src/reducers/bossAdmin';
import * as inventory from '../../../spacetimedb/src/reducers/inventory';
import * as trade from '../../../spacetimedb/src/reducers/trade';
import { tick } from '../../../spacetimedb/src/reducers/tick';

const open = R(spire.spireOpen), join = R(spire.spireJoin), leave = R(spire.spireLeave), start = R(spire.spireStart);
const configure = R(admin.configureBosses), debug = R(admin.bossDebug), eat = R(inventory.eatBerry);
const RULES = { clientRules: SPIRE_RULES_VERSION };
const hexOf = (x: { toHexString(): string }) => x.toHexString();
const BLOCKED = worldBlockedSet([]);

let h: SpireHarness;
beforeEach(() => { h = spireHarness(R(tick)); });

/** Keys for everyone, the Spire open, a lobby led by members[0] with the rest joined by run id. */
function lobby(members: Identity[], keys = true): bigint {
  if (!h.db.bossConfig.id.find(0)) h.config();
  if (keys) for (const m of members) h.give(m, SPIRE_KEY_ITEM_ID, 1);
  open(h.as(members[0]), RULES);
  const runId = h.member(members[0]).runId as bigint;
  for (const m of members.slice(1)) join(h.as(m), { runId, ...RULES });
  return runId;
}

/** A started run (world tick unchanged: startTick = T + 5). */
function begin(members: Identity[]): bigint {
  const runId = lobby(members);
  start(h.as(members[0]), RULES);
  return runId;
}

/** A started run whose intro is over (the next tick is a fight tick), swings switched off. */
function fighting(members: Identity[]): bigint {
  const runId = begin(members);
  h.run(SPIRE_INTRO);
  for (const m of members) h.set(m, { nextSwingTick: 1_000_000 });
  return runId;
}
const SPIRE_INTRO = 5;

const FLOOR: Tile[] = [];
for (let z = SPIRE_FLOOR.z0; z <= SPIRE_FLOOR.z1; z++) for (let x = SPIRE_FLOOR.x0; x <= SPIRE_FLOOR.x1; x++) if (spireStandable({ x, z })) FLOOR.push({ x, z });

const hitAt = (f: any, T: number, tile: Tile) => spireHitsMove(spireFightBullets(f), T, tile, tile, tile);
/** A floor tile where standing still at tick T is hit (avoiding `skip`). */
function hitTile(f: any, T: number, skip: (t: Tile) => boolean = () => false): Tile | undefined {
  return FLOOR.find((t) => !skip(t) && hitAt(f, T, t) > 0);
}
function safeTile(f: any, T: number, skip: (t: Tile) => boolean = () => false): Tile | undefined {
  return FLOOR.find((t) => !skip(t) && hitAt(f, T, t) === 0);
}

/**
 * Publishes `kind` so that tick T sits `offset` ticks into it, choosing the first (kind, offset) where every tick
 * in T..T+span has a stationary hit tile. Returns the offset.
 */
function dangerousPattern(runId: bigint, kinds: number[], span = 0): number {
  const T = h.T() + 1;
  for (const kind of kinds) {
    for (let offset = 3; offset + span < SPIRE_PATTERNS[kind].duration; offset++) {
      h.pattern(runId, kind, T - offset, 5);
      const f = h.fight(runId);
      let ok = true;
      for (let k = 0; k <= span && ok; k++) ok = !!hitTile(f, T + k);
      if (ok) return offset;
    }
  }
  throw new Error('no dangerous pattern');
}

const ALL_KINDS = SPIRE_PATTERNS.map((p) => p.kind);
/** A fresh input budget (MAX_INPUTS_PER_TICK) without running a tick. */
const fresh = (who: Identity) => h.set(who, { lastInputTick: 0, inputsThisTick: 0 });

describe('spire_open, spire_join, spire_leave: rejections in order', () => {
  it('spire_open refuses with every message of 5.1, in order', () => {
    const expectOpen = (msg: string, args = RULES) => { fresh(A); expect(() => open(h.as(A), args)).toThrow(msg); };
    expectOpen('This client is out of date; reload the page to enter the Spire', { clientRules: SPIRE_RULES_VERSION + 1 });
    expectOpen('The Sunken Spire is sealed');
    h.config();
    // Carrying the giant berry (a hauling expedition with A as the carrier).
    h.db.expedition.insert({ id: 0n, stage: 'hauling', carrier: A, leader: A });
    h.db.expeditionMember.insert({ identity: A, expeditionId: 1n });
    expectOpen('Put down the giant berry first; it needs both hands');
    h.db.expedition.id.update({ ...h.db.expedition.id.find(1n), carrier: undefined, stage: 'growing' });
    h.db.friendlyDuel.insert({ id: 0n, a: A, b: B, stage: 'active' });
    expectOpen('You cannot enter the Spire during a duel');
    h.db.friendlyDuel.id.delete(1n);
    expectOpen('You are on an expedition; finish or leave it first');
    // A finished expedition lingers 100 ticks and does not count.
    h.db.expedition.id.update({ ...h.db.expedition.id.find(1n), stage: 'complete' });
    h.place(A, { x: 40, z: 25 });
    expectOpen('Walk to the Sunken Spire gate (62,45) first');
    h.place(A, SPIRE_EXIT);
    h.give(B, SPIRE_KEY_ITEM_ID, 1);
    open(h.as(B), RULES);
    h.db.spireMember.insert({ ...h.member(B), identity: A, slot: 1 });
    expectOpen('You are already in a Spire party');
    h.db.spireMember.identity.delete(A);
    expectOpen('You need a spire key (3 obsidian and 1 gleamshell)');
    h.give(A, SPIRE_KEY_ITEM_ID, 1);
    for (let i = Number(h.db.spireRun.count()); i < SPIRE_MAX_LOBBIES; i++) {
      h.db.spireRun.insert({ ...h.runRow(1n), id: 0n, leader: C });
    }
    expectOpen('The Spire gate is crowded; join an open party instead');
    expect(h.member(A)).toBeUndefined();
  });

  it('spire_open inserts a public normal lobby led by the caller (slot 0, TTL 150)', () => {
    const runId = lobby([A]);
    const run = h.runRow(runId);
    expect(run).toMatchObject({ stage: SpireStage.Lobby, mode: SpireMode.Normal, isPublic: true, rules: SPIRE_RULES_VERSION, partySize: 1, createdTick: 100, endTick: 250 });
    expect(hexOf(run.leader)).toBe(hexOf(A));
    expect(h.member(A)).toMatchObject({ runId, slot: 0, state: SpireMemberState.Lobby, joinedTick: 100 });
    expect(h.count(A, SPIRE_KEY_ITEM_ID)).toBe(1); // nothing spent before the start
  });

  it('spire_join refuses with every message of 5.1, in order', () => {
    h.config();
    const expectJoin = (msg: string, runId = 0n, who: Identity = B) => { fresh(who); expect(() => join(h.as(who), { runId, ...RULES })).toThrow(msg); };
    expect(() => join(h.as(B), { runId: 0n, clientRules: 0 })).toThrow('This client is out of date; reload the page to enter the Spire');
    h.place(B, { x: 40, z: 25 });
    expectJoin('Walk to the Sunken Spire gate (62,45) first');
    h.place(B, SPIRE_EXIT);
    expectJoin('No open Spire party is waiting; open one instead');
    expectJoin('This party is gone', 77n);
    const runId = lobby([A]);
    h.setRun(runId, { stage: SpireStage.Active });
    expectJoin('This party has already gone down', runId);
    h.setRun(runId, { stage: SpireStage.Lobby, rules: SPIRE_RULES_VERSION + 1 });
    expectJoin('This party is from an older Spire; open a new one', runId);
    h.setRun(runId, { rules: SPIRE_RULES_VERSION });
    h.config({ spireOpen: false });
    expectJoin('The Sunken Spire is sealed', runId);
    h.config();
    for (const [who, slot] of [[C, 1], [D, 2], [E, 3]] as const) h.db.spireMember.insert({ ...h.member(A), identity: who, slot });
    expectJoin('This party is full', runId);
    h.db.spireMember.identity.delete(E);
    h.run(1); // a fresh tick for the input budget
    expectJoin('You need a spire key (3 obsidian and 1 gleamshell)', runId);
    h.give(B, SPIRE_KEY_ITEM_ID, 1);
    join(h.as(B), { runId, ...RULES });
    expect(h.member(B)).toMatchObject({ runId, slot: 3, state: SpireMemberState.Lobby });
    expectJoin('You are already in a Spire party', runId);
  });

  it('quick join takes the newest public lobby with a free slot and this rules version; explicit ids fill the lowest slot', () => {
    h.config();
    const first = lobby([A]);
    h.run(1);
    const second = lobby([C]);
    h.run(1);
    h.give(B, SPIRE_KEY_ITEM_ID, 1);
    join(h.as(B), { runId: 0n, ...RULES });
    expect(h.member(B).runId).toBe(second);
    expect(h.runRow(second).partySize).toBe(2);
    // The newest lobby is full: quick join falls back to the older one.
    h.db.spireMember.insert({ ...h.member(C), identity: { toHexString: () => 'f1', __identity__: 1n }, slot: 2 });
    h.db.spireMember.insert({ ...h.member(C), identity: { toHexString: () => 'f2', __identity__: 2n }, slot: 3 });
    h.give(D, SPIRE_KEY_ITEM_ID, 1);
    join(h.as(D), { runId: 0n, ...RULES });
    expect(h.member(D)).toMatchObject({ runId: first, slot: 1 });
  });

  it('spire_leave: not in a party; a lobby member leaves; the leader hands off; the last one deletes the run', () => {
    expect(() => leave(h.as(A))).toThrow('You are not in a Spire party');
    const runId = lobby([A, B, C]);
    leave(h.as(B));
    expect(h.member(B)).toBeUndefined();
    expect(h.runRow(runId).partySize).toBe(2);
    leave(h.as(A));
    expect(hexOf(h.runRow(runId).leader)).toBe(hexOf(C));
    expect(h.runRow(runId).partySize).toBe(1);
    leave(h.as(C));
    expect(h.runRow(runId)).toBeUndefined();
    expect(h.count(A, SPIRE_KEY_ITEM_ID)).toBe(1);
  });
});

describe('lobby upkeep', () => {
  it('drops offline members (leadership passes on) and deletes an empty lobby', () => {
    const runId = lobby([A, B]);
    h.set(A, { online: false });
    h.run(1);
    expect(h.member(A)).toBeUndefined();
    expect(hexOf(h.runRow(runId).leader)).toBe(hexOf(B));
    expect(h.runRow(runId).partySize).toBe(1);
    h.set(B, { online: false });
    h.run(1);
    expect(h.runRow(runId)).toBeUndefined();
    expect(h.member(B)).toBeUndefined();
  });

  it('deletes a lobby at its TTL (150 ticks) and tells its members', () => {
    const runId = lobby([A, B]);
    h.run(149);
    expect(h.runRow(runId)).toBeDefined();
    h.run(1);
    expect(h.runRow(runId)).toBeUndefined();
    expect(h.member(A)).toBeUndefined();
    expect(h.socials(B)).toContain('The Spire party broke up');
  });
});

describe('spire_start', () => {
  it('refuses with every message of 5.1, in order (no queue: a full Spire refuses)', () => {
    const expectStart = (msg: string, who: Identity = A) => { fresh(who); expect(() => start(h.as(who), RULES)).toThrow(msg); };
    h.config();
    expect(() => start(h.as(A), { clientRules: 0 })).toThrow('This client is out of date; reload the page to enter the Spire');
    expectStart('You are not leading a Spire party');
    const runId = lobby([A, B, C]);
    expectStart('You are not leading a Spire party', B);
    h.config({ spireOpen: false });
    expectStart('The Sunken Spire is sealed');
    h.config();
    h.run(1);
    h.set(B, { online: false });
    expectStart('This party is waiting for Bo: they are away');
    h.set(B, { online: true, region: 'settlement' });
    expectStart('This party is waiting for Bo: they left Bramblewild');
    h.set(B, { region: 'bramblewild', x: 40, z: 25 });
    expectStart('This party is waiting for Bo: walk to the gate');
    h.place(B, SPIRE_EXIT);
    h.run(1);
    h.db.inventorySlot.id.delete([...h.db.inventorySlot.owner.filter(C)][0].id);
    expectStart('This party is waiting for Cy: needs a spire key');
    h.give(C, SPIRE_KEY_ITEM_ID, 1);
    h.db.expedition.insert({ id: 0n, stage: 'hauling', carrier: C, leader: C });
    h.db.expeditionMember.insert({ identity: C, expeditionId: 1n });
    expectStart('This party is waiting for Cy: is carrying the giant berry');
    h.db.expedition.id.update({ ...h.db.expedition.id.find(1n), carrier: undefined, stage: 'growing' });
    h.run(1);
    h.db.friendlyDuel.insert({ id: 0n, a: C, b: D, stage: 'countdown' });
    expectStart('This party is waiting for Cy: is in a duel');
    h.db.friendlyDuel.id.delete(1n);
    expectStart('This party is waiting for Cy: is on an expedition');
    // A finished expedition (member row lingering) does not block.
    h.db.expedition.id.update({ ...h.db.expedition.id.find(1n), stage: 'complete' });
    h.config({ spireMaxRuns: 1 });
    h.db.spireRun.insert({ ...h.runRow(runId), id: 0n, stage: SpireStage.Active });
    expectStart('The Sunken Spire is full right now. Try again in a minute');
    expect(h.runRow(runId).stage).toBe(SpireStage.Lobby);
    expect(h.count(A, SPIRE_KEY_ITEM_ID)).toBe(1);
    h.config({ spireMaxRuns: 2 });
    fresh(A);
    start(h.as(A), RULES);
    expect(h.runRow(runId).stage).toBe(SpireStage.Active);
    expect(() => start(h.as(A), RULES)).toThrow('This party has already gone down');
  });

  it('a member whose row says settlement (x/z near the gate) blocks the start and spends no key', () => {
    lobby([A, B]);
    h.set(B, { region: 'settlement', x: SPIRE_GATE.x - 1, z: SPIRE_GATE.z });
    expect(() => start(h.as(A), RULES)).toThrow('This party is waiting for Bo: they left Bramblewild');
    expect(h.count(A, SPIRE_KEY_ITEM_ID)).toBe(1);
    expect(h.count(B, SPIRE_KEY_ITEM_ID)).toBe(1);
  });

  it('start effects: keys spent, interactions, trades and targets cleared, grace ended, teleport, fight row with the first pattern', () => {
    const runId = lobby([A, B]);
    // A trade with an outsider, C chasing A, A on a queued walk to the Meadows, B in first-spawn grace.
    h.db.trade.insert({ id: 0n, a: A, b: C, accepted: true, aOffer: '', bOffer: '', aCoins: 0, bCoins: 0, aConfirmed: false, bConfirmed: false, createdTick: 99 });
    h.set(C, { combatTarget: A, hostile: true });
    h.set(D, { combatTarget: B, pending: Pending.Trade });
    const walk = homeTarget(homePoint({ x: 10, z: 10 }, 'settlement'));
    h.set(A, { targetX: walk.x, targetZ: walk.z, pending: Pending.Harvest, pendingId: 3n });
    h.set(B, { respawnTick: 98 });
    h.give(A, 'berry_blueberry', 2);
    start(h.as(A), RULES);
    const T = 100, startTick = T + SPIRE_INTRO;
    expect(h.count(A, SPIRE_KEY_ITEM_ID)).toBe(0);
    expect(h.count(B, SPIRE_KEY_ITEM_ID)).toBe(0);
    expect(h.bag(A)).toEqual(['berry_blueberry:2']);
    expect(h.p(A)).toMatchObject({ x: SPIRE_SPAWNS[0].x, z: SPIRE_SPAWNS[0].z, targetX: undefined, pending: Pending.None });
    expect(h.p(B)).toMatchObject({ x: SPIRE_SPAWNS[1].x, z: SPIRE_SPAWNS[1].z, respawnTick: T - 10 });
    expect([...h.db.trade.iter()]).toHaveLength(0);
    expect(h.p(C)).toMatchObject({ combatTarget: undefined, hostile: false });
    expect(h.p(D)).toMatchObject({ combatTarget: undefined, pending: Pending.None });
    expect(h.member(A).state).toBe(SpireMemberState.In);
    expect(h.member(B).state).toBe(SpireMemberState.In);
    const run = h.runRow(runId);
    expect(run).toMatchObject({ stage: SpireStage.Active, startTick, endTick: startTick + 600, phase: 1, partySize: 2 });
    const f = h.fight(runId);
    expect(f).toMatchObject({ hp: 1700, maxHp: 1700, phase: 1, seed: spireSeed(runId, startTick), patternCount: 1, curStart: startTick, prevKind: SPIRE_NONE, starWave: 0, starMask: 0 });
    expect(SPIRE_POOLS[1]).toContain(f.curKind);
    expect(h.events(BossEventKind.SpireRunStart)).toHaveLength(1);
    expect(h.events(BossEventKind.SpireRunStart)[0]).toMatchObject({ runId, quantity: 2 });
    // The queued Meadows walk is gone: ticks keep A on the floor in Bramblewild.
    h.run(3);
    expect(h.p(A)).toMatchObject({ region: 'bramblewild', x: SPIRE_SPAWNS[0].x, z: SPIRE_SPAWNS[0].z });
    expect(isHomeTarget({ x: h.p(A).targetX, z: h.p(A).targetZ })).toBe(false);
  });

  it('no bullet can land before startTick + 3', () => {
    const runId = begin([A]);
    const f = h.fight(runId);
    for (let T = 101; T <= f.curStart + 2; T++) for (const t of FLOOR) expect(hitAt(f, T, t)).toBe(0);
    h.run(SPIRE_INTRO + 2);
    expect(h.fight(runId).hits0).toBe(0);
    expect(h.p(A).hp).toBe(30);
  });
});

describe('collision through the real tick', () => {
  it('standing on a danger tile is hit once for the phase damage; a sidestep is safe', () => {
    const runId = fighting([A]);
    dangerousPattern(runId, [SpirePatternKind.PetalRing]);
    const T = h.T() + 1, f = h.fight(runId);
    const tile = hitTile(f, T)!;
    h.place(A, tile);
    h.run(1);
    expect(h.fight(runId)).toMatchObject({ hitTick0: T, hits0: 1 });
    expect(h.p(A).hp).toBe(27);
    const hurt = h.notices(BossNoticeKind.Hurt, A);
    expect(hurt).toHaveLength(1);
    expect(hurt[0]).toMatchObject({ amount: 3, hp: 27, quantity: HurtSource.Bullet, runId });
    expect([1, 2]).toContain(hurt[0].half);

    // Sidestep: a one-step move out of a danger tile that the swept rule clears.
    const h2 = spireHarness(R(tick)); h = h2;
    const run2 = fighting([A]);
    let found: { p0: Tile; p2: Tile } | undefined;
    for (const kind of ALL_KINDS) {
      dangerousPattern(run2, [kind]);
      const f2 = h.fight(run2), T2 = h.T() + 1;
      for (const p0 of FLOOR) {
        if (hitAt(f2, T2, p0) === 0) continue;
        for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
          const p2 = { x: p0.x + dx, z: p0.z + dz };
          if (found || (!dx && !dz) || !spireStandable(p2) || (dx && dz)) continue;
          if (spireHitsMove(spireFightBullets(f2), T2, p0, spireMiddle(p0, p2, BLOCKED), p2) === 0) found = { p0, p2 };
        }
      }
      if (found) break;
    }
    expect(found).toBeDefined();
    h.place(A, found!.p0, { targetX: found!.p2.x, targetZ: found!.p2.z });
    h.run(1);
    expect(h.p(A)).toMatchObject({ x: found!.p2.x, z: found!.p2.z, hp: 30 });
    expect(h.fight(run2).hits0).toBe(0);
  });

  it('a diagonal slip through a sheet row is hit although both ends are safe standing still', () => {
    const runId = fighting([A]);
    let found: { p0: Tile; p2: Tile } | undefined;
    const T = h.T() + 1;
    search: for (const kind of [SpirePatternKind.GlassSheet, ...ALL_KINDS]) {
      for (let seed = 0; seed < 64; seed += 7) {
        for (let offset = 3; offset < SPIRE_PATTERNS[kind].duration; offset++) {
          h.pattern(runId, kind, T - offset, seed);
          const f = h.fight(runId), b = spireFightBullets(f);
          for (const p0 of FLOOR) {
            if (hitAt(f, T, p0)) continue;
            for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
              const p2 = { x: p0.x + dx, z: p0.z + dz };
              if (!spireStandable(p2) || hitAt(f, T, p2)) continue;
              if (spireHitsMove(b, T, p0, spireMiddle(p0, p2, BLOCKED), p2)) { found = { p0, p2 }; break search; }
            }
          }
        }
      }
    }
    expect(found).toBeDefined();
    h.place(A, found!.p0, { targetX: found!.p2.x, targetZ: found!.p2.z });
    h.run(1);
    expect(h.p(A)).toMatchObject({ x: found!.p2.x, z: found!.p2.z });
    expect(h.fight(runId).hits0).toBe(1);
    expect(h.p(A).hp).toBeLessThan(30);
  });

  it('i-frames: two ticks immune after a hit, hit again on the third', () => {
    const runId = fighting([A]);
    dangerousPattern(runId, ALL_KINDS, 3);
    const T = h.T() + 1, f = h.fight(runId);
    for (let k = 0; k < 4; k++) {
      h.place(A, hitTile(f, T + k)!);
      h.run(1);
    }
    expect(h.fight(runId).hits0).toBe(2);
    expect(h.fight(runId).hitTick0).toBe(T + 3);
    expect(h.notices(BossNoticeKind.Hurt, A).map((n: any) => n.tick)).toEqual([T, T + 3]);
  });

  it('enrage: +1 bullet damage from tick 420 of the fight', () => {
    const runId = fighting([A]);
    dangerousPattern(runId, [SpirePatternKind.PetalRing], 3);
    const T = h.T() + 1, f = h.fight(runId);
    h.setRun(runId, { startTick: T - 419, endTick: T - 419 + 600 });
    h.place(A, hitTile(f, T)!);
    h.run(1);
    expect(h.p(A).hp).toBe(27);
    h.setFight(runId, { hitTick0: 0 });
    h.place(A, hitTile(f, T + 1)!);
    h.run(1);
    expect(h.p(A).hp).toBe(23);
    expect(h.notices(BossNoticeKind.Hurt, A).map((n: any) => n.amount)).toEqual([3, 4]);
  });

  it('a 2-HP member hit by a 5-damage bullet writes 0 (never 253) and is knocked out', () => {
    const runId = fighting([A, B]);
    dangerousPattern(runId, ALL_KINDS);
    h.setFight(runId, { phase: 4 });
    const T = h.T() + 1, f = h.fight(runId);
    const tile = hitTile(f, T)!;
    h.place(A, tile, { hp: 2 });
    h.place(B, safeTile(f, T)!);
    h.run(1);
    expect(h.notices(BossNoticeKind.Hurt, A)[0]).toMatchObject({ amount: 5, hp: 0 });
    expect(h.member(A).state).toBe(SpireMemberState.Out);
    expect(h.p(A)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z, hp: 10 });
  });
});

describe('stars and court swings', () => {
  it('stars are caught at P2 and through P1, 15 damage each, the mask written once, reset each wave', () => {
    const runId = fighting([A, B]);
    h.pattern(runId, SpirePatternKind.PetalRing, h.T() - 30); // nothing left to dodge
    const run = h.runRow(runId);
    let T = h.T() + 1;
    const f0 = h.fight(runId);
    const wave = spireStarWave(run.startTick, T);
    const stars = spireStars(f0.seed, wave, 4);
    // A steps onto star 0; B stands on it too (already taken): one catch.
    h.place(A, stars[0]); h.place(B, stars[0]);
    h.run(1);
    let f = h.fight(runId);
    expect(f.stars0).toBe(1);
    expect(f.stars1).toBe(0);
    expect(f.hp).toBe(f0.hp - SPIRE_STAR_DAMAGE);
    expect(f.starMask).toBe(1);
    expect(f.dmg0).toBe(SPIRE_STAR_DAMAGE);
    expect(h.notices(BossNoticeKind.Star, A)[0]).toMatchObject({ amount: 15, total: 1 });
    // Standing on a caught star catches nothing more.
    h.run(1);
    expect(h.fight(runId).stars0).toBe(1);
    // B walks two steps through star 1 (it is the middle tile, P1).
    T = h.T() + 1;
    const s1 = stars[1];
    let route: { p0: Tile; p2: Tile } | undefined;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const p0 = { x: s1.x - dx, z: s1.z - dz }, p2 = { x: s1.x + dx, z: s1.z + dz };
      const mid = spireMiddle(p0, p2, BLOCKED);
      if (spireStandable(p0) && spireStandable(p2) && mid.x === s1.x && mid.z === s1.z && !stars.some((s) => s.x === p2.x && s.z === p2.z)) { route = { p0, p2 }; break; }
    }
    expect(route).toBeDefined();
    h.place(B, route!.p0, { targetX: route!.p2.x, targetZ: route!.p2.z });
    h.place(A, FLOOR.find((t) => !stars.some((s) => chebyshev(s, t) < 2))!);
    h.run(1);
    f = h.fight(runId);
    expect(h.p(B)).toMatchObject({ x: route!.p2.x, z: route!.p2.z });
    expect(f.stars1).toBe(1);
    expect(f.starMask).toBe(0b11);
    // The next wave clears the mask.
    const next = run.startTick + (wave + 1) * 12;
    const quiet = FLOOR.filter((t) => !spireStars(f0.seed, wave + 1, 4).some((s) => chebyshev(s, t) < 1));
    h.place(A, quiet[0]); h.place(B, quiet[1]);
    while (h.T() < next) h.run(1);
    f = h.fight(runId);
    expect(f.starWave).toBe(wave + 1);
    expect(f.starMask).toBe(0);
  });

  it('court swings land only on the slot tick, within 4 of the heart, for the weapon base damage', () => {
    const runId = fighting([A]);
    h.pattern(runId, SpirePatternKind.PetalRing, h.T() - 30);
    const near = { x: 77, z: 60 }; // Chebyshev 2: in the court, never a star
    expect(inSpireCourt(near)).toBe(true);
    h.place(A, near, { nextSwingTick: 0 });
    const run = h.runRow(runId), seed = h.fight(runId).seed;
    const swings: number[] = [];
    for (let i = 0; i < 8; i++) {
      const before = h.fight(runId).dmg0;
      h.run(1);
      if (h.fight(runId).dmg0 > before) swings.push(h.T());
    }
    expect(swings.length).toBe(2);
    for (const T of swings) expect((T - run.startTick) % 4).toBe(0);
    expect(h.fight(runId).dmg0).toBe(6); // two punches
    // Outside the court (and off every star of the next waves): no swing.
    const waves = [0, 1, 2].map((k) => spireStarWave(run.startTick, h.T() + 1) + k);
    const outside = FLOOR.find((t) => !inSpireCourt(t) && waves.every((w) => spireStars(seed, w, 3).every((s) => s.x !== t.x || s.z !== t.z)))!;
    h.place(A, outside);
    h.run(8);
    expect(h.fight(runId).dmg0).toBe(6);
  });

  it('a meal one tick before the slot tick skips that court swing', () => {
    const runId = fighting([A]);
    h.pattern(runId, SpirePatternKind.PetalRing, h.T() - 30);
    h.place(A, { x: 77, z: 60 }, { nextSwingTick: 0, hp: 20 });
    h.give(A, 'berry_blueberry', 3);
    const startTick = h.runRow(runId).startTick;
    while ((h.T() + 1 - startTick) % 4 !== 0) h.run(1);
    eat(h.as(A), { slot: [...h.db.inventorySlot.owner.filter(A)].find((r: any) => r.itemId === 'berry_blueberry').slot });
    expect(h.member(A).meals).toBe(1);
    h.run(1);
    expect(h.fight(runId).dmg0).toBe(0);
    h.run(4);
    expect(h.fight(runId).dmg0).toBe(3);
  });

  it('the 7th meal of a run is refused', () => {
    fighting([A]);
    h.give(A, 'berry_blueberry', 10);
    h.set(A, { hp: 5 });
    for (let i = 0; i < 6; i++) {
      eat(h.as(A), { slot: 0 });
      h.set(A, { eatCooldownUntilTick: 0, hp: 5, inputsThisTick: 0 });
    }
    expect(h.member(A).meals).toBe(6);
    expect(() => eat(h.as(A), { slot: 0 })).toThrow('You have eaten your fill in the Spire (6/6)');
  });
});

describe('knockout, away, wipe and timeout', () => {
  it('a solo knockout ejects at once with hp 10, grace and the bag untouched; the run is wiped and cleaned up after 20 ticks', () => {
    const runId = fighting([A]);
    h.give(A, 'berry_blueberry', 2);
    const bag = h.bag(A);
    dangerousPattern(runId, ALL_KINDS);
    const T = h.T() + 1;
    h.place(A, hitTile(h.fight(runId), T)!, { hp: 1 });
    h.run(1);
    expect(h.member(A).state).toBe(SpireMemberState.Out);
    expect(h.p(A)).toMatchObject({ state: PlayerState.Alive, x: SPIRE_EXIT.x, z: SPIRE_EXIT.z, hp: 10, respawnTick: T });
    expect(h.bag(A)).toEqual(bag);
    expect([...h.db.groundItem.iter()]).toHaveLength(0);
    expect([...h.db.combatEvent.iter()].filter((e: any) => e.kind === EventKind.Death)).toHaveLength(0);
    expect(h.notices(BossNoticeKind.KnockedOut, A)).toHaveLength(1);
    expect(h.runRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.Wiped, endTick: T + 20 });
    expect(h.notices(BossNoticeKind.RunResult, A)[0]).toMatchObject({ quantity: SpireOutcome.Wiped });
    h.run(19);
    expect(h.runRow(runId)).toBeDefined();
    h.run(1);
    expect(h.runRow(runId)).toBeUndefined();
    expect(h.fight(runId)).toBeUndefined();
    expect(h.member(A)).toBeUndefined();
  });

  it('an away member: frozen tile still hit, first episode floors HP at 1, no stars, back within 50 resumes', () => {
    const runId = fighting([A, B]);
    h.pattern(runId, SpirePatternKind.PetalRing, h.T() - 30);
    const f0 = h.fight(runId), run = h.runRow(runId);
    // A disconnects standing on a star: it catches nothing.
    const star = spireStars(f0.seed, spireStarWave(run.startTick, h.T() + 1), 4)[0];
    h.place(A, star, { online: false, hp: 2 });
    h.place(B, FLOOR.find((t) => chebyshev(t, star) > 3)!);
    h.run(1);
    expect(h.member(A)).toMatchObject({ awaySinceTick: h.T(), awayCount: 1, state: SpireMemberState.In });
    expect(h.fight(runId).stars0).toBe(0);
    // A lethal hit on the frozen tile floors at 1 in the first episode.
    dangerousPattern(runId, ALL_KINDS);
    const T = h.T() + 1;
    h.place(A, hitTile(h.fight(runId), T)!);
    h.place(B, safeTile(h.fight(runId), T)!);
    h.run(1);
    expect(h.p(A).hp).toBe(1);
    expect(h.fight(runId).hits0).toBe(1);
    expect(h.member(A).state).toBe(SpireMemberState.In);
    // Back: the episode ends.
    h.set(A, { online: true });
    h.pattern(runId, SpirePatternKind.PetalRing, h.T() - 30);
    h.run(1);
    expect(h.member(A)).toMatchObject({ awaySinceTick: 0, awayCount: 1 });
    // Second episode: a lethal hit knocks out (direct row eject, bag kept).
    h.give(A, 'berry_blueberry', 1);
    h.set(A, { online: false });
    h.run(1);
    expect(h.member(A).awayCount).toBe(2);
    dangerousPattern(runId, ALL_KINDS);
    const T2 = h.T() + 1;
    h.place(A, hitTile(h.fight(runId), T2)!);
    h.place(B, safeTile(h.fight(runId), T2)!);
    h.run(1);
    expect(h.member(A).state).toBe(SpireMemberState.Out);
    expect(h.p(A)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z, hp: 10 });
    expect(h.bag(A)).toEqual(['berry_blueberry:1']);
  });

  it('awayCount saturates at 255 after 300 toggles and Flawless stays false', () => {
    const runId = fighting([A, B]);
    h.setFight(runId, { hp: 1_000_000, maxHp: 1_000_000 });
    for (let i = 0; i < 300; i++) {
      h.pattern(runId, SpirePatternKind.PetalRing, h.T() - 30);
      h.setRun(runId, { endTick: h.T() + 100 });
      h.set(A, { online: false }); h.run(1);
      h.set(A, { online: true }); h.run(1);
    }
    expect(h.member(A).awayCount).toBe(255);
    // A clears with 3 stars and no hits: still not flawless.
    h.setFight(runId, { hp: 15, stars0: 3, stars1: 3 });
    const f = h.fight(runId), run = h.runRow(runId);
    const star = spireStars(f.seed, spireStarWave(run.startTick, h.T() + 1), 4).find((_, j) => !(f.starMask & (1 << j)))!;
    h.place(A, star);
    h.run(1);
    expect(h.runRow(runId).stage).toBe(SpireStage.Cleared);
    expect(h.notices(BossNoticeKind.Keepsake, A).map((n: any) => n.quantity)).toEqual([13]);
  });

  it('away 50+ ticks while a teammate is present: Left, ejected, no reward', () => {
    const runId = fighting([A, B]);
    h.setFight(runId, { hp: 1_000_000, maxHp: 1_000_000 });
    h.set(A, { online: false });
    for (let i = 0; i < 50; i++) { h.pattern(runId, SpirePatternKind.PetalRing, h.T() - 30); h.run(1); }
    expect(h.member(A).state).toBe(SpireMemberState.In);
    h.run(1);
    expect(h.member(A).state).toBe(SpireMemberState.Left);
    expect(h.p(A)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z });
    // B clears; A gets nothing even though it caught stars earlier.
    h.setFight(runId, { hp: 15, stars0: 5, stars1: 3 });
    h.set(A, { online: true });
    const f = h.fight(runId), run = h.runRow(runId);
    h.place(B, spireStars(f.seed, spireStarWave(run.startTick, h.T() + 1), 4).find((_, j) => !(f.starMask & (1 << j)))!);
    h.run(1);
    expect(h.runRow(runId).stage).toBe(SpireStage.Cleared);
    expect(h.count(A, PRISM_SHARD_ITEM_ID)).toBe(0);
    expect(h.count(B, PRISM_SHARD_ITEM_ID)).toBe(1);
  });

  it('the whole party away 50 ticks: Abandoned, one key refunded to each In member', () => {
    const runId = fighting([A, B]);
    h.setFight(runId, { hp: 1_000_000, maxHp: 1_000_000 });
    h.set(A, { online: false });
    h.run(5);
    h.set(B, { online: false });
    for (let i = 0; i < 50; i++) { h.pattern(runId, SpirePatternKind.PetalRing, h.T() - 30); h.run(1); }
    expect(h.runRow(runId).stage).toBe(SpireStage.Active);
    h.run(1);
    expect(h.runRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.Abandoned });
    expect(h.count(A, SPIRE_KEY_ITEM_ID)).toBe(1);
    expect(h.count(B, SPIRE_KEY_ITEM_ID)).toBe(1);
    expect(h.member(A).state).toBe(SpireMemberState.Left);
    expect(h.p(A)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z });
    expect(h.p(B)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z });
  });

  it('times out at startTick + 600: present members ejected with hp >= 10', () => {
    const runId = fighting([A]);
    h.setFight(runId, { hp: 1_000_000, maxHp: 1_000_000 });
    const endTick = h.runRow(runId).endTick;
    h.set(A, { hp: 4 });
    while (h.T() < endTick - 1) {
      // Stand somewhere the next tick cannot hit.
      const f = h.fight(runId);
      h.place(A, safeTile(f, h.T() + 1)!, { hp: Math.max(4, h.p(A).hp) });
      h.run(1);
    }
    expect(h.runRow(runId).stage).toBe(SpireStage.Active);
    h.place(A, safeTile(h.fight(runId), h.T() + 1)!);
    h.run(1);
    expect(h.runRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.TimedOut });
    expect(h.member(A).state).toBe(SpireMemberState.Done);
    expect(h.p(A)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z });
    expect(h.p(A).hp).toBeGreaterThanOrEqual(10);
    expect(h.count(A, SPIRE_KEY_ITEM_ID)).toBe(0);
  });
});

describe('clear and rewards', () => {
  it('ejects first, then pays qualifiers only; the pendant only when flawless; cleanup after 20 ticks', () => {
    const runId = fighting([A, B, C, D]);
    // A: 3 stars, never hit (flawless). B: 2 stars (no reward). C: knocked out earlier with 5 stars (reward, no pendant).
    // D: forfeited (Left: nothing).
    h.setFight(runId, { hp: 15, stars0: 3, stars1: 2, stars2: 5, stars3: 9, hits2: 4 });
    h.setMember(C, { state: SpireMemberState.Out });
    h.place(C, SPIRE_EXIT);
    leave(h.as(D));
    expect(h.member(D).state).toBe(SpireMemberState.Left);
    const f = h.fight(runId), run = h.runRow(runId);
    const T = h.T() + 1;
    const stars = spireStars(f.seed, spireStarWave(run.startTick, T), run.partySize + 2);
    h.pattern(runId, SpirePatternKind.PetalRing, h.T() - 30);
    h.place(A, stars[0]);
    h.place(B, FLOOR.find((t) => stars.every((s) => chebyshev(s, t) > 1))!);
    h.run(1);
    expect(h.runRow(runId)).toMatchObject({ stage: SpireStage.Cleared, outcome: SpireOutcome.Cleared, endTick: T + 20, clearTicks: T - run.startTick });
    expect(h.fight(runId).hp).toBe(0);
    for (const who of [A, B]) {
      expect(h.member(who).state).toBe(SpireMemberState.Done);
      expect(h.p(who)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z });
    }
    expect(h.bag(A)).toEqual(['berry_goldberry:4', 'prism_shard:1']);
    expect(h.bag(B)).toEqual([]);
    expect(h.bag(C)).toEqual(['berry_goldberry:4', 'prism_shard:1']);
    expect(h.bag(D)).toEqual([]);
    expect(h.notices(BossNoticeKind.Keepsake, A).map((n: any) => n.quantity)).toEqual([13, 14]);
    expect(h.notices(BossNoticeKind.Keepsake, C).map((n: any) => n.quantity)).toEqual([13]);
    expect(h.db.playerCosmetic.identity.find(B)).toBeUndefined();
    expect(h.db.adventureProfile.identity.find(A).fightingXp).toBe(100);
    expect(h.db.adventureProfile.identity.find(B)).toBeUndefined();
    for (const who of [A, B, C]) expect(h.notices(BossNoticeKind.RunResult, who)[0]).toMatchObject({ quantity: SpireOutcome.Cleared, total: T - run.startTick });
    expect(h.notices(BossNoticeKind.RunResult, D)).toHaveLength(0);
    const ev = h.events(BossEventKind.SpireClear);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ runId, quantity: 4, value: T - run.startTick, text: 'Ann, Bo, Cy, Di' });
    h.run(20);
    expect(h.runRow(runId)).toBeUndefined();
    expect(h.fight(runId)).toBeUndefined();
    expect([...h.db.spireMember.iter()]).toHaveLength(0);
  });

  it('a star that overkills a 10-HP boss writes hp = 0 and clears; offline knocked-out members are not paid', () => {
    const runId = fighting([A, B]);
    h.setFight(runId, { hp: 10, stars0: 3, stars1: 4 });
    h.setMember(B, { state: SpireMemberState.Out });
    h.place(B, SPIRE_EXIT, { online: false });
    const f = h.fight(runId), run = h.runRow(runId);
    h.pattern(runId, SpirePatternKind.PetalRing, h.T() - 30);
    h.place(A, spireStars(f.seed, spireStarWave(run.startTick, h.T() + 1), 4)[0]);
    h.run(1);
    expect(h.fight(runId).hp).toBe(0);
    expect(h.runRow(runId).stage).toBe(SpireStage.Cleared);
    expect(h.count(A, PRISM_SHARD_ITEM_ID)).toBe(1);
    expect(h.count(B, PRISM_SHARD_ITEM_ID)).toBe(0);
  });
});

describe('member-row lifecycle', () => {
  it('an Out member is refused a new party until it leaves, and the old clear then pays it nothing', () => {
    const runId = fighting([A, B]);
    h.setFight(runId, { stars0: 5 });
    h.setMember(A, { state: SpireMemberState.Out });
    h.place(A, SPIRE_EXIT);
    h.give(A, SPIRE_KEY_ITEM_ID, 1);
    const s = Math.ceil((h.runRow(runId).endTick - h.T()) * 0.6);
    expect(() => open(h.as(A), RULES)).toThrow(`You still belong to a party that is fighting (${s} s left); leave it to give up its reward`);
    expect(() => join(h.as(A), { runId: 0n, ...RULES })).toThrow('You still belong to a party that is fighting');
    expect(h.db.spireRun.count()).toBe(1n);
    leave(h.as(A));
    expect(h.member(A)).toBeUndefined();
    open(h.as(A), RULES);
    const mine = h.member(A).runId;
    expect(mine).not.toBe(runId);
    // B clears the old run: A (no longer a member) gets nothing.
    h.setFight(runId, { hp: 15, stars1: 3 });
    const f = h.fight(runId), run = h.runRow(runId);
    h.pattern(runId, SpirePatternKind.PetalRing, h.T() - 30);
    h.place(B, spireStars(f.seed, spireStarWave(run.startTick, h.T() + 1), 4)[0]);
    h.run(1);
    expect(h.runRow(runId).stage).toBe(SpireStage.Cleared);
    expect(h.count(A, PRISM_SHARD_ITEM_ID)).toBe(0);
    expect(h.count(B, PRISM_SHARD_ITEM_ID)).toBe(1);
    expect(h.member(A).runId).toBe(mine);
  });

  it('a forfeit (Left) member of an Active run opens at once; the old run keeps its slot columns', () => {
    const runId = fighting([A, B]);
    h.setFight(runId, { stars0: 2, dmg0: 30 });
    leave(h.as(A));
    expect(h.member(A).state).toBe(SpireMemberState.Left);
    expect(h.p(A)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z });
    expect(h.notices(BossNoticeKind.RunResult, A)).toHaveLength(0);
    h.give(A, SPIRE_KEY_ITEM_ID, 1);
    open(h.as(A), RULES);
    expect(h.member(A).runId).not.toBe(runId);
    expect(h.fight(runId)).toMatchObject({ stars0: 2, dmg0: 30 });
    expect(h.runRow(runId).partySize).toBe(2);
  });

  it('a stale row of a finished run is replaced', () => {
    const runId = fighting([A]);
    h.setRun(runId, { stage: SpireStage.Failed, outcome: SpireOutcome.Wiped, endTick: h.T() + 20 });
    h.place(A, SPIRE_EXIT);
    h.give(A, SPIRE_KEY_ITEM_ID, 1);
    open(h.as(A), RULES);
    expect(h.member(A).runId).not.toBe(runId);
  });
});

describe('isolation, stranded sweep, rules reset, owner effects', () => {
  it("logical instancing: run A's bullets, stars and swings never touch run B", () => {
    const runA = fighting([A]);
    const runB = begin([B]);
    h.run(SPIRE_INTRO);
    h.set(B, { nextSwingTick: 1_000_000 });
    h.setFight(runA, { hitTick0: 0 });
    const hitsA = h.fight(runA).hits0, starsA = h.fight(runA).stars0;
    dangerousPattern(runA, ALL_KINDS);
    const T = h.T() + 1;
    const fa = h.fight(runA);
    h.pattern(runB, SpirePatternKind.PetalRing, h.T() - 30);
    const tile = hitTile(fa, T, (t) => hitAt(h.fight(runB), T, t) > 0)!;
    h.place(A, tile); h.place(B, tile);
    h.run(1);
    expect(h.fight(runA).hits0).toBe(hitsA + 1);
    expect(h.fight(runB).hits0).toBe(0);
    expect(h.p(B).hp).toBe(30);
    // A star of run A under both players: only run A's mask and HP move.
    const sa = spireStars(h.fight(runA).seed, spireStarWave(h.runRow(runA).startTick, h.T() + 1), 3);
    const fb0 = h.fight(runB);
    const freeA = sa.findIndex((_, j) => !(h.fight(runA).starMask & (1 << j)));
    h.pattern(runA, SpirePatternKind.PetalRing, h.T() - 30);
    h.place(A, sa[freeA]); h.place(B, sa[freeA]);
    h.run(1);
    expect(h.fight(runA).stars0).toBe(starsA + 1);
    expect(h.fight(runB).hp).toBe(fb0.hp - ((h.fight(runB).stars0 - fb0.stars0) * SPIRE_STAR_DAMAGE));
    expect(h.member(A).runId).toBe(runA);
  });

  it('respond_trade refuses on the floor (two runs side by side)', () => {
    fighting([A]);
    fighting([B]);
    h.place(A, { x: 72, z: 60 }); h.place(B, { x: 73, z: 60 });
    const row = h.db.trade.insert({ id: 0n, a: B, b: A, accepted: false, aOffer: '', bOffer: '', aCoins: 0, bCoins: 0, aConfirmed: false, bConfirmed: false, createdTick: h.T() });
    expect(() => R(trade.respondTrade)(h.as(A), { tradeId: row.id, accept: true })).toThrow('You cannot trade inside the Sunken Spire');
    expect(h.db.trade.id.find(row.id).accepted).toBe(false);
  });

  it('the stranded sweep ejects anyone on the floor without a present In membership', () => {
    h.place(C, { x: 72, z: 60 }, { hp: 3 });
    h.run(1);
    expect(h.p(C)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z, hp: 10 });
    // A member of a lingering (finished) run is swept too.
    const runId = fighting([A]);
    h.setRun(runId, { stage: SpireStage.Cleared, endTick: h.T() + 20 });
    h.run(1);
    expect(h.p(A)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z });
  });

  it('a rules version change resets: Active runs fail with refunds, lobbies are deleted with a notice', () => {
    const runId = fighting([A]);
    const lobbyId = lobby([B]);
    h.setRun(runId, { rules: SPIRE_RULES_VERSION + 1 });
    h.setRun(lobbyId, { rules: SPIRE_RULES_VERSION + 1 });
    h.run(1);
    expect(h.runRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.Reset });
    expect(h.count(A, SPIRE_KEY_ITEM_ID)).toBe(1);
    expect(h.p(A)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z });
    expect(h.runRow(lobbyId)).toBeUndefined();
    expect(h.member(B)).toBeUndefined();
    expect(h.socials(B)).toContain('The Spire was updated: open a new party');
  });

  it('configure_bosses with spireOpen false deletes lobbies and fails Active runs with refunds', () => {
    const runId = fighting([A, B]);
    const lobbyId = lobby([C]);
    configure(h.as(OWNER), { ...BOSS_CONFIG_DEFAULTS, spireOpen: false });
    expect(h.runRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.Closed });
    for (const who of [A, B]) {
      expect(h.count(who, SPIRE_KEY_ITEM_ID)).toBe(1);
      expect(h.p(who)).toMatchObject({ x: SPIRE_EXIT.x, z: SPIRE_EXIT.z });
      expect(h.member(who).state).toBe(SpireMemberState.Done);
    }
    expect(h.runRow(lobbyId)).toBeUndefined();
    expect(h.member(C)).toBeUndefined();
    expect(h.socials(C)).toContain('The Sunken Spire was sealed; your party broke up');
    // Closing again is a no-op; the lingering run is cleaned up by the tick.
    configure(h.as(OWNER), { ...BOSS_CONFIG_DEFAULTS, spireOpen: false });
    expect(h.count(A, SPIRE_KEY_ITEM_ID)).toBe(1);
    h.run(20);
    expect(h.runRow(runId)).toBeUndefined();
  });

  it('boss_debug spire_hp, spire_phase and spire_fail_all through the real reducer', () => {
    const runId = fighting([A]);
    debug(h.as(OWNER), { op: 'spire_hp', runId, value: 50 });
    expect(h.fight(runId).hp).toBe(500);
    debug(h.as(OWNER), { op: 'spire_hp', runId, value: 0 });
    expect(h.fight(runId).hp).toBe(1);
    debug(h.as(OWNER), { op: 'spire_phase', runId, value: 9 });
    expect(h.fight(runId).phase).toBe(4);
    debug(h.as(OWNER), { op: 'spire_hp', runId, value: 100 });
    // The phase shows at the next pattern boundary (and never goes back).
    const due = h.fight(runId).curStart + SPIRE_PATTERNS[h.fight(runId).curKind].duration;
    h.setFight(runId, { hitTick0: 0 });
    while (h.T() < due) { h.place(A, safeTile(h.fight(runId), h.T() + 1)!); h.run(1); }
    expect(SPIRE_POOLS[4]).toContain(h.fight(runId).curKind);
    expect(h.runRow(runId).phase).toBe(4);
    const other = begin([B]);
    debug(h.as(OWNER), { op: 'spire_fail_all', runId: 0n, value: 0 });
    for (const [id, who] of [[runId, A], [other, B]] as const) {
      expect(h.runRow(id)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.Closed });
      expect(h.count(who, SPIRE_KEY_ITEM_ID)).toBe(1);
    }
    expect(() => debug(h.as(OWNER), { op: 'spire_hp', runId, value: 1 })).toThrow('This run is not active');
  });
});

describe('write cost', () => {
  it('no runs: zero boss-table writes over 50 ticks', () => {
    h.run(50);
    for (const t of ['spireRun', 'spireMember', 'spireFight', 'bossNotice', 'bossEvent']) {
      expect(h.log.insert[t] ?? 0).toBe(0);
      expect(h.log.update[t] ?? 0).toBe(0);
    }
  });

  it('one active run: at most one spire_fight update per tick', () => {
    const runId = fighting([A, B]);
    h.setFight(runId, { hp: 1_000_000, maxHp: 1_000_000 });
    h.set(A, { nextSwingTick: 0 });
    h.place(A, { x: 77, z: 60 });
    for (let i = 0; i < 120; i++) {
      const before = h.log.update.spireFight ?? 0;
      h.set(A, { hp: 30 }); h.set(B, { hp: 30 });
      h.run(1);
      expect((h.log.update.spireFight ?? 0) - before).toBeLessThanOrEqual(1);
      expect(h.runRow(runId).stage).toBe(SpireStage.Active);
    }
  });
});
