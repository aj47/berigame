import { beforeEach, describe, expect, it, vi } from 'vitest';
import { A, B, C, D, E, OWNER, R, spireHarness, type Identity, type SpireHarness } from './spireHarness';
import { PlayerState, Pending, type Tile } from '../types';
import { EventKind } from '../index';
import { LANTERN_EXIT, LANTERN_FLOOR, LANTERN_GATE, SPIRE_EXIT, lanternStandable } from '../bossZones';
import {
  BossEventKind, BossId, BossNoticeKind, HurtSource, LANTERN_BAIT, LANTERN_BITE_DAMAGE, LANTERN_CONFIG_DEFAULTS, LANTERN_DAILY_PAID_CLEARS,
  LANTERN_ENTRY_FEE, LANTERN_INTRO_TICKS, LANTERN_NONE, LANTERN_PLANK, LANTERN_RULES_VERSION, LANTERN_SPAWNS, LANTERN_SPRINGS,
  LANTERN_STANDABLE, LANTERN_TILES, LanternStage, SPIRE_KEY_ITEM_ID, SPIRE_RULES_VERSION, SpireMemberState, SpireOutcome, SpireStage,
  lanternAdvance, lanternBlowAt, lanternFreshFight, lanternHazardMask, lanternInCourt, lanternLocal, lanternMoves, lanternNewRun,
  lanternResolveTick, lanternSeed, lanternTile, lanternUtcDay, type LanternConfigLike, type LanternFightLike, type LanternRunSim,
} from '../index';
import { frontierRepository } from '../../../spacetimedb/src/lib/frontier';
import { newProfile } from '../frontier/model';

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

import * as lantern from '../../../spacetimedb/src/reducers/lantern';
import * as spire from '../../../spacetimedb/src/reducers/spire';
import * as admin from '../../../spacetimedb/src/reducers/bossAdmin';
import * as inventory from '../../../spacetimedb/src/reducers/inventory';
import * as trade from '../../../spacetimedb/src/reducers/trade';
import * as harvest from '../../../spacetimedb/src/reducers/harvest';
import * as craftReducers from '../../../spacetimedb/src/reducers/craft';
import { recipeStatus } from '../nodes';
import { tick } from '../../../spacetimedb/src/reducers/tick';

const open = R(lantern.lanternOpen), join = R(lantern.lanternJoin), leave = R(lantern.lanternLeave), start = R(lantern.lanternStart), readyUp = R(lantern.lanternReady);
const configure = R(lantern.configureLanternmaw), debug = R(admin.bossDebug), eat = R(inventory.eatBerry);
const RULES = { clientRules: LANTERN_RULES_VERSION };
const hexOf = (x: { toHexString(): string }) => x.toHexString();

let h: SpireHarness;
beforeEach(() => { h = spireHarness(R(tick)); });

const lanternRow = (runId: bigint) => h.db.lanternRun.id.find(runId);
const fight = (runId: bigint) => h.db.lanternFight.runId.find(runId);
const member = (who: Identity) => h.db.lanternMember.identity.find(who);
const setFight = (runId: bigint, patch: object) => h.db.lanternFight.runId.update({ ...fight(runId), ...patch });
const setMember = (who: Identity, patch: object) => h.db.lanternMember.identity.update({ ...member(who), ...patch });
const coins = (who: Identity) => frontierRepository(h.ctx).get('profile', hexOf(who))?.coins ?? 0;
const setCoins = (who: Identity, n: number) => {
  const repo = frontierRepository(h.ctx);
  const p = repo.get('profile', hexOf(who));
  repo.put('profile', { ...(p ?? newProfile(hexOf(who))), coins: n });
};
function config(patch: Partial<LanternConfigLike> = {}) {
  const row = { id: 0, ...LANTERN_CONFIG_DEFAULTS, lanternOpen: true, ...patch };
  if (h.db.lanternConfig.id.find(0)) h.db.lanternConfig.id.update(row); else h.db.lanternConfig.insert(row);
}
/** A stone club in the hotbar and wielded, one Fen Bait, enough coins, standing at the gate. */
function ready(who: Identity, bait = 1, fee = LANTERN_ENTRY_FEE) {
  h.give(who, 'stone_club', 1);
  if (bait) h.give(who, LANTERN_BAIT.itemId, bait);
  setCoins(who, fee);
  h.place(who, LANTERN_EXIT, { weapon: 'stone_club' });
}
const fresh = (who: Identity) => h.set(who, { lastInputTick: 0, inputsThisTick: 0 });
function lobby(members: Identity[]): bigint {
  if (!h.db.lanternConfig.id.find(0)) config();
  for (const m of members) ready(m);
  open(h.as(members[0]), RULES);
  const runId = member(members[0]).runId as bigint;
  for (const m of members.slice(1)) join(h.as(m), { runId, ...RULES });
  return runId;
}
/** Every non-leader member sends ready (a party start needs it). */
function readyAll(members: Identity[]) { for (const m of members.slice(1)) { fresh(m); readyUp(h.as(m)); } }
function begin(members: Identity[]): bigint {
  const runId = lobby(members);
  readyAll(members);
  start(h.as(members[0]), RULES);
  return runId;
}
/** Started, intro over (the next tick is fight tick startTick). */
function fighting(members: Identity[]): bigint {
  const runId = begin(members);
  h.run(LANTERN_INTRO_TICKS - 1);
  return runId;
}
const FLOOR: Tile[] = [];
for (let z = LANTERN_FLOOR.z0; z <= LANTERN_FLOOR.z1; z++) for (let x = LANTERN_FLOOR.x0; x <= LANTERN_FLOOR.x1; x++) if (lanternStandable({ x, z })) FLOOR.push({ x, z });
const FIGHT_KEYS: (keyof LanternFightLike)[] = ['seed', 'hp', 'maxHp', 'phase', 'partySize', 'stage', 'cycle', 'denCount', 'patternCount',
  'curKind', 'curStart', 'curSeed', 'curAim', 'surfaceTick', 'spring', 'pulseSeed', 'capped'];
const fightLike = (f: any): LanternFightLike => Object.fromEntries(FIGHT_KEYS.map((k) => [k, f[k]])) as any;

describe('closed by default and the owner switch', () => {
  it('ships closed: no lantern_config row refuses every entry, and the tick writes nothing', () => {
    ready(A);
    expect(() => open(h.as(A), RULES)).toThrow('The Drowned Hollow is sealed');
    h.run(30);
    expect(h.log.insert.lanternRun ?? 0).toBe(0);
    expect(h.log.insert.lanternFight ?? 0).toBe(0);
    expect(h.log.update.lanternFight ?? 0).toBe(0);
  });

  it('configure_lanternmaw: owner only, ranges checked, opening announces it, closing refunds bait and fee', () => {
    const args = { lanternOpen: true, lanternMaxRuns: 12, lanternHpBase: 810, lanternHpPerMember: 970 };
    expect(() => configure(h.as(A), args)).toThrow();
    expect(() => configure(h.as(OWNER), { ...args, lanternMaxRuns: 0 })).toThrow('This value is out of range');
    expect(() => configure(h.as(OWNER), { ...args, lanternHpBase: 20001 })).toThrow('This value is out of range');
    configure(h.as(OWNER), args);
    expect(h.db.lanternConfig.id.find(0)).toMatchObject({ id: 0, ...args });
    expect(h.events(BossEventKind.LanternOpened)).toHaveLength(1);
    expect(h.events(BossEventKind.LanternOpened)[0]).toMatchObject({ boss: BossId.Lanternmaw, x: LANTERN_GATE.x, z: LANTERN_GATE.z });
    // Re-opening while open announces nothing new.
    configure(h.as(OWNER), args);
    expect(h.events(BossEventKind.LanternOpened)).toHaveLength(1);
    const lobbyId = lobby([C]);
    const runId = begin([A, B]);
    expect(h.count(A, LANTERN_BAIT.itemId)).toBe(0);
    expect(coins(A)).toBe(0);
    configure(h.as(OWNER), { ...args, lanternOpen: false });
    expect(lanternRow(lobbyId)).toBeUndefined();
    expect(member(C)).toBeUndefined();
    expect(lanternRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.Closed });
    for (const who of [A, B]) {
      expect(h.count(who, LANTERN_BAIT.itemId)).toBe(1);
      expect(coins(who)).toBe(LANTERN_ENTRY_FEE);
      expect(h.p(who)).toMatchObject({ x: LANTERN_EXIT.x, z: LANTERN_EXIT.z });
      expect(member(who).state).toBe(SpireMemberState.Done);
    }
  });

  it('configure_lanternmaw changes the HP knobs live: an Active run keeps its HP, the next run uses the new values', () => {
    configure(h.as(OWNER), { lanternOpen: true, lanternMaxRuns: 12, lanternHpBase: 810, lanternHpPerMember: 970 });
    const runId = fighting([A]);
    expect(fight(runId)).toMatchObject({ hp: 810, maxHp: 810 });
    configure(h.as(OWNER), { lanternOpen: true, lanternMaxRuns: 12, lanternHpBase: 600, lanternHpPerMember: 700 });
    expect(h.db.lanternConfig.id.find(0)).toMatchObject({ lanternOpen: true, lanternHpBase: 600, lanternHpPerMember: 700 });
    // Still open: nothing closed or refunded, the fighting run is untouched.
    expect(lanternRow(runId).stage).toBe(SpireStage.Active);
    expect(fight(runId).maxHp).toBe(810);
    h.run(1);
    expect(fight(runId).maxHp).toBe(810);
    const solo = begin([B]);
    expect(fight(solo)).toMatchObject({ hp: 600, maxHp: 600 });
    const duo = begin([C, D]);
    expect(fight(duo)).toMatchObject({ hp: 1300, maxHp: 1300 });
    expect(h.events(BossEventKind.LanternOpened)).toHaveLength(1);
  });

  it('boss_debug lantern_soon announces an opening; lantern_hp sets a percent; lantern_fail_all refunds', () => {
    config();
    debug(h.as(OWNER), { op: 'lantern_soon', runId: 0n, value: 10 });
    expect(h.events(BossEventKind.LanternSoon)[0]).toMatchObject({ boss: BossId.Lanternmaw, value: 10 });
    const runId = begin([A]);
    debug(h.as(OWNER), { op: 'lantern_hp', runId, value: 50 });
    expect(fight(runId).hp).toBe(405);
    expect(() => debug(h.as(OWNER), { op: 'lantern_hp', runId: 99n, value: 50 })).toThrow('This run is not active');
    debug(h.as(OWNER), { op: 'lantern_fail_all', runId: 0n, value: 0 });
    expect(lanternRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.Closed });
    expect(h.count(A, LANTERN_BAIT.itemId)).toBe(1);
    expect(() => debug(h.as(A), { op: 'lantern_soon', runId: 0n, value: 10 })).toThrow();
  });
});

describe('lantern_open, lantern_join, lantern_leave', () => {
  it('lantern_open refuses in order: rules, sealed, gate, the weapon, the bait, the fee, another party', () => {
    const expectOpen = (msg: string, args = RULES) => { fresh(A); expect(() => open(h.as(A), args)).toThrow(msg); };
    expectOpen('This client is out of date; reload the page to enter the Drowned Hollow', { clientRules: LANTERN_RULES_VERSION + 1 });
    expectOpen('The Drowned Hollow is sealed');
    config();
    h.place(A, { x: 40, z: 25 });
    expectOpen(`Walk to the Fen Gate (${LANTERN_GATE.x},${LANTERN_GATE.z}) first`);
    h.place(A, LANTERN_EXIT);
    expectOpen('Bring a weapon to the Drowned Hollow: a stone club or better');
    h.give(A, 'stick', 1);
    expectOpen('Bring a weapon to the Drowned Hollow: a stone club or better');
    h.give(A, 'stone_club', 1);
    expectOpen('You need a Fen Bait');
    h.give(A, LANTERN_BAIT.itemId, 1);
    expectOpen(`You need ${LANTERN_ENTRY_FEE} coins`);
    setCoins(A, LANTERN_ENTRY_FEE);
    // A Spire party blocks a Lanternmaw party (one boss party at a time).
    h.db.spireRun.insert({ id: 0n, leader: A, stage: SpireStage.Lobby, outcome: 0, mode: 0, isPublic: true, rules: SPIRE_RULES_VERSION, partySize: 1, createdTick: 100, queuedTick: 0, startTick: 0, endTick: 250, phase: 1, clearTicks: 0 });
    h.db.spireMember.insert({ identity: A, runId: 1n, slot: 0, state: SpireMemberState.Lobby, joinedTick: 100, awaySinceTick: 0, awayCount: 0, downUntilTick: 0, reviveSinceTick: 0, meals: 0 });
    expectOpen('You are in a Spire party; leave it first');
    h.db.spireMember.identity.delete(A); h.db.spireRun.id.delete(1n);
    fresh(A);
    open(h.as(A), RULES);
    const runId = member(A).runId;
    expect(lanternRow(runId)).toMatchObject({ leader: A, stage: SpireStage.Lobby, rules: LANTERN_RULES_VERSION, partySize: 1, endTick: h.T() + 150 });
    expect(member(A)).toMatchObject({ slot: 0, state: SpireMemberState.Lobby });
    expectOpen('You are already in a Lanternmaw party');
    // ... and a Lanternmaw party blocks a Spire party.
    h.config();
    h.give(A, SPIRE_KEY_ITEM_ID, 1);
    h.place(A, SPIRE_EXIT);
    fresh(A);
    expect(() => R(spire.spireOpen)(h.as(A), { clientRules: SPIRE_RULES_VERSION })).toThrow('You are in a Lanternmaw party; leave it first');
  });

  it('join by id or quick join (newest lobby), full at 4; leave hands off leadership and deletes an empty lobby', () => {
    config();
    const runId = lobby([A, B]);
    expect(member(B)).toMatchObject({ runId, slot: 1 });
    ready(C);
    join(h.as(C), { runId: 0n, ...RULES });
    expect(member(C)).toMatchObject({ runId, slot: 2 });
    ready(D); join(h.as(D), { runId, ...RULES });
    ready(E);
    expect(() => join(h.as(E), { runId, ...RULES })).toThrow('This party is full');
    expect(() => join(h.as(E), { runId: 0n, ...RULES })).toThrow('No open Lanternmaw party is waiting; open one instead');
    leave(h.as(A));
    expect(member(A)).toBeUndefined();
    expect(lanternRow(runId)).toMatchObject({ leader: B, partySize: 3 });
    for (const who of [B, C, D]) leave(h.as(who));
    expect(lanternRow(runId)).toBeUndefined();
    expect(() => leave(h.as(A))).toThrow('You are not in a Lanternmaw party');
  });

  it('a lobby expires at its TTL and drops offline members', () => {
    const runId = lobby([A, B]);
    h.set(B, { online: false });
    h.run(1);
    expect(member(B)).toBeUndefined();
    expect(lanternRow(runId).partySize).toBe(1);
    h.run(150);
    expect(lanternRow(runId)).toBeUndefined();
    expect(member(A)).toBeUndefined();
  });
});

describe('lantern_start', () => {
  it('refuses while a member is not ready, naming them; a full Hollow refuses', () => {
    const runId = lobby([A, B]);
    readyAll([A, B]);
    expect(() => start(h.as(B), RULES)).toThrow('You are not leading a Lanternmaw party');
    h.place(B, { x: 40, z: 25 });
    expect(() => start(h.as(A), RULES)).toThrow('This party is waiting for Bo: walk to the gate');
    h.place(B, LANTERN_EXIT);
    h.db.inventorySlot.id.delete([...h.db.inventorySlot.owner.filter(B)].find((r: any) => r.itemId === LANTERN_BAIT.itemId).id);
    expect(() => start(h.as(A), RULES)).toThrow('This party is waiting for Bo: You need a Fen Bait');
    h.give(B, LANTERN_BAIT.itemId, 1);
    setCoins(B, 4);
    expect(() => start(h.as(A), RULES)).toThrow(`This party is waiting for Bo: You need ${LANTERN_ENTRY_FEE} coins`);
    setCoins(B, LANTERN_ENTRY_FEE);
    config({ lanternMaxRuns: 1 });
    begin([C]);
    expect(() => start(h.as(A), RULES)).toThrow('The Drowned Hollow is full right now. Try again in a minute');
    expect(lanternRow(runId).stage).toBe(SpireStage.Lobby);
    expect(h.count(A, LANTERN_BAIT.itemId)).toBe(1);
  });

  it('spends one bait and the fee each, teleports to the spawns, inserts the fight with the first pattern', () => {
    const runId = lobby([A, B]);
    readyAll([A, B]);
    setCoins(A, 12);
    h.set(B, { respawnTick: 98 });
    start(h.as(A), RULES);
    const T = h.T(), startTick = T + LANTERN_INTRO_TICKS;
    expect(h.count(A, LANTERN_BAIT.itemId)).toBe(0);
    expect(coins(A)).toBe(12 - LANTERN_ENTRY_FEE);
    expect(coins(B)).toBe(0);
    const ledger = frontierRepository(h.ctx).all('ledger').filter((l: any) => l.reason === 'fee:lanternmaw');
    expect(ledger.map((l: any) => l.amount)).toEqual([-LANTERN_ENTRY_FEE, -LANTERN_ENTRY_FEE]);
    expect(h.p(A)).toMatchObject({ ...lanternTile(LANTERN_SPAWNS[0]), pending: Pending.None });
    expect(h.p(B)).toMatchObject({ ...lanternTile(LANTERN_SPAWNS[1]), respawnTick: T - 10 });
    expect(member(A).state).toBe(SpireMemberState.In);
    expect(lanternRow(runId)).toMatchObject({ stage: SpireStage.Active, startTick, endTick: startTick + 600, partySize: 2, phase: 1 });
    const expected = lanternFreshFight(lanternSeed(runId, startTick), 2, startTick, [LANTERN_SPAWNS[0], LANTERN_SPAWNS[1]], 1780);
    expect(fightLike(fight(runId))).toEqual(expected);
    expect(h.events(BossEventKind.LanternRunStart)[0]).toMatchObject({ boss: BossId.Lanternmaw, runId, quantity: 2 });
  });

  it('a qualifying weapon in the bag is drawn at the start (moved to the quick bar if needed) with a Wielded notice', () => {
    config();
    ready(A);
    h.set(A, { weapon: 'stick' });
    // The club sits past the quick bar; the stick fills slot 0 and is wielded.
    for (const r of [...h.db.inventorySlot.owner.filter(A)]) h.db.inventorySlot.id.delete(r.id);
    h.db.inventorySlot.insert({ id: 0n, owner: A, slot: 0, itemId: 'stick', quantity: 1 });
    h.db.inventorySlot.insert({ id: 0n, owner: A, slot: 7, itemId: 'stone_club', quantity: 1 });
    h.give(A, LANTERN_BAIT.itemId, 1);
    open(h.as(A), RULES);
    start(h.as(A), RULES);
    expect(h.p(A).weapon).toBe('stone_club');
    const club = [...h.db.inventorySlot.owner.filter(A)].find((r: any) => r.itemId === 'stone_club');
    expect(club.slot).toBeLessThan(3);
    expect(h.notices(BossNoticeKind.Wielded, A)[0]).toMatchObject({ boss: BossId.Lanternmaw, itemId: 'stone_club', amount: 8 });
    // A member already wielding a qualifying weapon keeps it and gets no notice.
    h.run(30);
  });

  it('a weapon in the bag (not wielded) is enough', () => {
    config();
    ready(A);
    h.set(A, { weapon: '' });
    open(h.as(A), RULES);
    start(h.as(A), RULES);
    expect(member(A).state).toBe(SpireMemberState.In);
  });
});

/** A move for the scripted player: avoid every hazard at T, prefer the court on a swing tick, else stay. */
function pickMove(f: LanternFightLike, startTick: number, T: number, from: number): number {
  const mask = lanternHazardMask(f, T, startTick);
  const moves = lanternMoves(from);
  const safe = moves.filter((i) => !mask[i]);
  const pool = safe.length ? safe : moves;
  const swing = (T - startTick) % 4 === 0;
  const want = f.stage === LanternStage.Tide ? (i: number) => i === LANTERN_SPRINGS[f.spring] : (i: number) => lanternInCourt(i);
  return (swing || f.stage === LanternStage.Tide) ? pool.find(want) ?? pool[0] : pool[0];
}

describe('the ready check', () => {
  it('a party start waits for every other member to send ready once; it stays valid until they leave or the run starts', () => {
    const runId = lobby([A, B, C]);
    expect(() => start(h.as(A), RULES)).toThrow('This party is waiting for Bo: send ready once your dodge loop is running');
    fresh(B); readyUp(h.as(B));
    expect(h.db.lanternReadiness.identity.find(B)).toMatchObject({ runId, tick: h.T() });
    fresh(A);
    expect(() => start(h.as(A), RULES)).toThrow('This party is waiting for Cy: send ready');
    fresh(C); readyUp(h.as(C));
    // AI turns can be far apart: a ready sent long ago still counts.
    h.run(120);
    fresh(A);
    start(h.as(A), RULES);
    expect(lanternRow(runId).stage).toBe(SpireStage.Active);
    expect([...h.db.lanternReadiness.iter()]).toHaveLength(0);
  });

  it('a ready from an earlier lobby does not carry over', () => {
    const first = lobby([A, B]);
    fresh(B); readyUp(h.as(B));
    fresh(A); leave(h.as(A));
    fresh(B); leave(h.as(B));
    expect(h.db.lanternRun.id.find(first)).toBeUndefined();
    const runId = lobby([A, B]);
    fresh(A);
    expect(() => start(h.as(A), RULES)).toThrow('This party is waiting for Bo: send ready');
    expect(lanternRow(runId).stage).toBe(SpireStage.Lobby);
  });

  it('ready is refused outside a lobby; leaving drops your ready; a solo leader starts without it', () => {
    ready(A);
    expect(() => { fresh(A); readyUp(h.as(A)); }).toThrow('You are not in a Lanternmaw lobby');
    const runId = lobby([A, B]);
    fresh(B); readyUp(h.as(B));
    fresh(B); leave(h.as(B));
    expect(h.db.lanternReadiness.identity.find(B)).toBeUndefined();
    fresh(A);
    start(h.as(A), RULES);
    expect(lanternRow(runId).stage).toBe(SpireStage.Active);
  });
});

describe('the start grace (the water stills)', () => {
  it('nothing can hit anyone for the first 15 + 3 ticks after the start, even standing idle on the spawn tile', () => {
    const runId = begin([A, B]);
    const T0 = h.T();
    expect(lanternRow(runId).startTick).toBe(T0 + 15);
    h.run(17);
    expect(h.p(A).hp).toBe(30);
    expect(h.p(B).hp).toBe(30);
    expect(fight(runId).hits0 + fight(runId).hits1 + fight(runId).drowned0).toBe(0);
  });
});

describe('the tick runs the shared reference (server and clients agree)', () => {
  it('every tick of a scripted solo run matches lanternResolveTick field for field', () => {
    const runId = fighting([A]);
    const run = lanternRow(runId);
    let sim: LanternRunSim = lanternNewRun(fight(runId).seed, [{ tile: LANTERN_SPAWNS[0], weapon: 8, hp: 30 }], run.startTick);
    expect(fightLike(fight(runId))).toEqual(sim.fight);
    let tile = LANTERN_SPAWNS[0], checked = 0, sawTide = false, sawHit = false;
    for (let k = 0; k < 400 && !sim.outcome; k++) {
      const T = h.T() + 1;
      tile = pickMove(sim.fight, run.startTick, T, tile);
      sim = { ...sim, members: sim.members.map((m) => ({ ...m, tile })) };
      h.place(A, lanternTile(tile));
      sim = lanternResolveTick(sim, T);
      h.run(1);
      if (sim.outcome) break;
      expect(fightLike(fight(runId))).toEqual(sim.fight);
      expect(h.p(A).hp).toBe(sim.members[0].hp);
      expect(fight(runId).dmg0).toBe(sim.members[0].dealt);
      expect(fight(runId).hits0).toBe(sim.members[0].hits);
      expect(fight(runId).caps0).toBe(sim.members[0].caps);
      if (sim.fight.stage === LanternStage.Tide) sawTide = true;
      if (sim.members[0].hits > 0 || sim.members[0].drowned > 0) sawHit = true;
      // Keep the scripted player alive so the comparison runs long: top up both sides alike.
      if (sim.members[0].hp < 15) { sim = { ...sim, members: sim.members.map((m) => ({ ...m, hp: 30 })) }; h.set(A, { hp: 30 }); }
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    expect(sawTide).toBe(true);
    expect(sawHit || sim.members[0].caps > 0).toBe(true);
  });

  it('a blow on the end tile hurts once for the phase damage with a Blow notice', () => {
    const runId = fighting([A]);
    const run = lanternRow(runId);
    const T = h.T() + 1;
    // A Maw Bellow published 4 ticks ago (rules 3): rings 2-6 are hit at T.
    setFight(runId, { stage: LanternStage.Den, curKind: 7, curStart: T - 4, curSeed: 0, denCount: 1 });
    const b = lanternBlowAt(fightLike(fight(runId)), T, run.startTick)!;
    const on = LANTERN_TILES.find((i) => b.tiles[i] && lanternInCourt(i))!;
    h.place(A, lanternTile(on), { hp: 30, nextSwingTick: 1_000_000 });
    h.run(1);
    expect(b.damage).toBe(10);
    expect(h.p(A).hp).toBe(20);
    expect(fight(runId)).toMatchObject({ hits0: 1, hitTick0: T });
    expect(h.notices(BossNoticeKind.Hurt, A)[0]).toMatchObject({ boss: BossId.Lanternmaw, amount: 10, quantity: HurtSource.Blow, runId });
  });

  it('capping the spring at the surfacing tick bites for 6 and chokes it', () => {
    const runId = fighting([A]);
    const run = lanternRow(runId);
    setFight(runId, { stage: LanternStage.Dive, curKind: LANTERN_NONE, surfaceTick: h.T() + 2, spring: 1, pulseSeed: 0, capped: false });
    h.place(A, lanternTile(LANTERN_SPRINGS[1]), { hp: 30, nextSwingTick: 1_000_000 });
    h.run(2);
    expect(fight(runId)).toMatchObject({ stage: LanternStage.Tide, capped: true, caps0: 1 });
    expect(h.p(A).hp).toBe(30 - LANTERN_BITE_DAMAGE);
    expect(h.notices(BossNoticeKind.Hurt, A).find((n: any) => n.quantity === HurtSource.Bite)).toMatchObject({ amount: LANTERN_BITE_DAMAGE });
    expect(run.startTick).toBeGreaterThan(0);
  });

  it('a flooded tile costs 3 HP per tick with a Drown notice', () => {
    const runId = fighting([A]);
    setFight(runId, { stage: LanternStage.Tide, curKind: LANTERN_NONE, surfaceTick: h.T() - 1, spring: 0, pulseSeed: 0, capped: true });
    const shallow = LANTERN_TILES.find((i) => !LANTERN_PLANK[i] && LANTERN_STANDABLE[i])!;
    h.place(A, lanternTile(shallow), { hp: 30 });
    h.run(1);
    expect(h.p(A).hp).toBe(27);
    expect(fight(runId).drowned0).toBe(1);
    expect(h.notices(BossNoticeKind.Hurt, A).at(-1)).toMatchObject({ amount: 3, quantity: HurtSource.Drown });
  });
});

describe('knockout, wipe, away, timeout', () => {
  it('a knockout ejects to the Fen Gate with 10 HP and grace, bag untouched, no death; a solo run is wiped', () => {
    const runId = fighting([A]);
    h.give(A, 'berry_blueberry', 2);
    const bag = h.bag(A);
    setFight(runId, { stage: LanternStage.Tide, curKind: LANTERN_NONE, surfaceTick: h.T() - 1, spring: 0, pulseSeed: 0, capped: true });
    const shallow = LANTERN_TILES.find((i) => !LANTERN_PLANK[i])!;
    h.place(A, lanternTile(shallow), { hp: 3 });
    const T = h.T() + 1;
    h.run(1);
    expect(member(A).state).toBe(SpireMemberState.Out);
    expect(h.p(A)).toMatchObject({ state: PlayerState.Alive, x: LANTERN_EXIT.x, z: LANTERN_EXIT.z, hp: 10, respawnTick: T });
    expect(h.bag(A)).toEqual(bag);
    expect([...h.db.combatEvent.iter()].filter((e: any) => e.kind === EventKind.Death)).toHaveLength(0);
    expect(h.notices(BossNoticeKind.KnockedOut, A)).toHaveLength(1);
    expect(lanternRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.Wiped, endTick: T + 20 });
    expect(h.count(A, LANTERN_BAIT.itemId)).toBe(0);
    h.run(20);
    expect(lanternRow(runId)).toBeUndefined();
    expect(fight(runId)).toBeUndefined();
    expect(member(A)).toBeUndefined();
  });

  it('the whole party away 50 ticks after the fight started: Abandoned as a loss, no refund', () => {
    const runId = fighting([A]);
    h.run(1); // the first fight tick, present
    h.set(A, { online: false });
    h.run(50);
    expect(lanternRow(runId).stage).toBe(SpireStage.Active);
    h.run(1);
    expect(lanternRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.Abandoned });
    expect(h.count(A, LANTERN_BAIT.itemId)).toBe(0);
    expect(coins(A)).toBe(0);
  });

  it('the whole party away since before the fight started: Abandoned with bait and fee refunded', () => {
    const runId = begin([A]);
    h.set(A, { online: false });
    h.run(51);
    expect(lanternRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.Abandoned });
    expect(h.count(A, LANTERN_BAIT.itemId)).toBe(1);
    expect(coins(A)).toBe(LANTERN_ENTRY_FEE);
  });

  it('times out at startTick + 600 with no refund', () => {
    const runId = fighting([A]);
    h.db.lanternRun.id.update({ ...lanternRow(runId), endTick: h.T() + 1 });
    h.place(A, lanternTile(LANTERN_SPAWNS[0]), { nextSwingTick: 1_000_000 });
    h.run(1);
    expect(lanternRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.TimedOut });
    expect(h.p(A)).toMatchObject({ x: LANTERN_EXIT.x, z: LANTERN_EXIT.z });
    expect(h.count(A, LANTERN_BAIT.itemId)).toBe(0);
  });

  it('lantern_leave during a run forfeits (Left, ejected, no reward)', () => {
    const runId = fighting([A, B]);
    leave(h.as(B));
    expect(member(B).state).toBe(SpireMemberState.Left);
    expect(h.p(B)).toMatchObject({ x: LANTERN_EXIT.x, z: LANTERN_EXIT.z });
    expect(lanternRow(runId).stage).toBe(SpireStage.Active);
  });
});

describe('clear, rewards and the daily cap', () => {
  /** Puts the boss at 1 HP with A in the court on its swing tick. */
  function killNext(runId: bigint, dealt = 50) {
    const run = lanternRow(runId);
    while ((h.T() + 1 - run.startTick) % 4 !== 0) { h.place(A, lanternTile(LANTERN_SPAWNS[0])); h.run(1); }
    setFight(runId, { hp: 1, stage: LanternStage.Den, dmg0: dealt });
    const court = LANTERN_TILES.find((i) => lanternInCourt(i))!;
    h.place(A, lanternTile(court), { nextSwingTick: 0 });
    h.run(1);
  }

  it('pays 2 fenlight and 120 Fighting XP to a qualifier, ejects, announces, cleans up', () => {
    const runId = fighting([A, B]);
    setFight(runId, { dmg1: 10 });
    killNext(runId);
    expect(lanternRow(runId)).toMatchObject({ stage: SpireStage.Cleared, outcome: SpireOutcome.Cleared });
    expect(h.count(A, 'fenlight')).toBe(2);
    expect(h.count(B, 'fenlight')).toBe(0); // under 40 damage
    expect(h.db.adventureProfile.identity.find(A).fightingXp).toBe(120);
    for (const who of [A, B]) {
      expect(member(who).state).toBe(SpireMemberState.Done);
      expect(h.p(who)).toMatchObject({ x: LANTERN_EXIT.x, z: LANTERN_EXIT.z });
    }
    expect(h.notices(BossNoticeKind.Reward, A)[0]).toMatchObject({ boss: BossId.Lanternmaw, itemId: 'fenlight', quantity: 2 });
    expect(h.events(BossEventKind.LanternClear)[0]).toMatchObject({ runId, quantity: 2, text: 'Ann, Bo' });
    expect(h.db.lanternPaid.identity.find(A)).toMatchObject({ day: lanternUtcDay(1_000_000_000), paid: 1 });
    expect(h.db.lanternPaid.identity.find(B)).toBeUndefined();
  });

  it('fenlight stops after 4 paid clears in a UTC day (XP continues) and resets the next day', () => {
    const today = lanternUtcDay(1_000_000_000);
    h.db.lanternPaid.insert({ identity: A, day: today, paid: LANTERN_DAILY_PAID_CLEARS });
    let runId = fighting([A]);
    killNext(runId);
    expect(h.count(A, 'fenlight')).toBe(0);
    expect(h.db.adventureProfile.identity.find(A).fightingXp).toBe(120);
    expect(h.db.lanternPaid.identity.find(A).paid).toBe(LANTERN_DAILY_PAID_CLEARS);
    h.db.lanternPaid.identity.update({ identity: A, day: today - 1, paid: LANTERN_DAILY_PAID_CLEARS });
    h.run(25);
    runId = fighting([A]);
    killNext(runId);
    expect(h.count(A, 'fenlight')).toBe(2);
    expect(h.db.lanternPaid.identity.find(A)).toMatchObject({ day: today, paid: 1 });
  });
});

describe('guards on the Drowned Hollow floor', () => {
  it('the meal after the 4th of a run is refused (rules 3: 4 meals)', () => {
    fighting([A]);
    h.give(A, 'berry_blueberry', 10);
    const slot = [...h.db.inventorySlot.owner.filter(A)].find((r: any) => r.itemId === 'berry_blueberry').slot;
    for (let i = 0; i < 4; i++) {
      h.set(A, { eatCooldownUntilTick: 0, hp: 5, inputsThisTick: 0 });
      eat(h.as(A), { slot });
    }
    expect(member(A).meals).toBe(4);
    h.set(A, { eatCooldownUntilTick: 0, hp: 5, inputsThisTick: 0 });
    expect(() => eat(h.as(A), { slot })).toThrow('You have eaten your fill in the Drowned Hollow (4/4)');
  });

  it('drop, harvest and trade are refused on the floor', () => {
    fighting([A, B]);
    h.give(A, 'berry_blueberry', 1);
    expect(() => R(inventory.dropItem)(h.as(A), { slot: [...h.db.inventorySlot.owner.filter(A)].find((r: any) => r.itemId === 'berry_blueberry').slot })).toThrow('You cannot drop items inside the Drowned Hollow');
    h.db.tree.insert({ id: 1, x: 10, z: 10, kind: 0, berries: 3, regrowTick: 0 });
    expect(() => R(harvest.startHarvest)(h.as(A), { treeId: 1 })).toThrow('inside the Drowned Hollow');
    const row = h.db.trade.insert({ id: 0n, a: B, b: A, accepted: false, aOffer: '', bOffer: '', aCoins: 0, bCoins: 0, aConfirmed: false, bConfirmed: false, createdTick: h.T() });
    expect(() => R(trade.respondTrade)(h.as(A), { tradeId: row.id, accept: true })).toThrow('You cannot trade inside the Drowned Hollow');
  });

  it('the stranded sweep ejects anyone on the floor without a present In membership', () => {
    h.place(C, FLOOR[0], { hp: 3 });
    h.run(1);
    expect(h.p(C)).toMatchObject({ x: LANTERN_EXIT.x, z: LANTERN_EXIT.z, hp: 10 });
  });

  it('two runs share the floor without touching each other', () => {
    const r1 = fighting([A]);
    config();
    const r2 = begin([B]);
    h.run(LANTERN_INTRO_TICKS);
    expect(fight(r1).seed).not.toBe(fight(r2).seed);
    setFight(r1, { hp: 1, dmg0: 50 });
    expect(fight(r2).hp).toBe(810);
  });

  it('a rules version change resets live runs with refunds', () => {
    const runId = fighting([A]);
    h.db.lanternRun.id.update({ ...lanternRow(runId), rules: LANTERN_RULES_VERSION - 1 });
    h.run(1);
    expect(lanternRow(runId)).toMatchObject({ stage: SpireStage.Failed, outcome: SpireOutcome.Reset });
    expect(h.count(A, LANTERN_BAIT.itemId)).toBe(1);
  });
});

describe('write cost', () => {
  it('one active run: at most one lantern_fight update per tick, run rows only on transitions', () => {
    const runId = fighting([A]);
    const startTick = lanternRow(runId).startTick;
    const before = h.log.update.lanternFight ?? 0, runsBefore = h.log.update.lanternRun ?? 0;
    let tile = LANTERN_SPAWNS[0];
    for (let k = 0; k < 40; k++) {
      tile = pickMove(fightLike(fight(runId)), startTick, h.T() + 1, tile);
      h.place(A, lanternTile(tile), { hp: 30 });
      h.run(1);
    }
    expect((h.log.update.lanternFight ?? 0) - before).toBeLessThanOrEqual(40);
    expect((h.log.update.lanternRun ?? 0) - runsBefore).toBeLessThanOrEqual(3);
    expect(lanternRow(runId).stage).toBe(SpireStage.Active);
  });
});

// Silence unused-import lint in this file's helpers.
void lanternAdvance; void lanternLocal; void hexOf;

describe('the Fen Gate and the floor on the map', () => {
  it('the gate tile is a blocker beside a walkable exit and lobby, reachable from spawn with the Coast keys', async () => {
    const { NODE_SEEDS, TREE_SEEDS, reachableTiles, enterRule, SPAWN_TILE, worldBlockedSet, tileKey, isLandTile, areaOf, bossNoPvpZone, chebyshev } = await import('../index');
    const blocked = worldBlockedSet([...TREE_SEEDS, ...NODE_SEEDS]);
    expect(blocked.has(tileKey(LANTERN_GATE))).toBe(true);
    const seen = reachableTiles(SPAWN_TILE, blocked, enterRule(true, true));
    expect(seen.has(tileKey(LANTERN_EXIT))).toBe(true);
    let lobby = 0;
    for (let z = LANTERN_GATE.z - 3; z <= LANTERN_GATE.z + 3; z++) for (let x = LANTERN_GATE.x - 3; x <= LANTERN_GATE.x + 3; x++) {
      if (seen.has(tileKey({ x, z }))) lobby++;
    }
    expect(lobby).toBeGreaterThanOrEqual(30);
    expect(areaOf(LANTERN_EXIT)).toBe('coast');
    expect(bossNoPvpZone(LANTERN_EXIT)).toBe('fengate');
    expect(chebyshev(LANTERN_EXIT, LANTERN_GATE)).toBe(1);
    // No tier or base node sits in the gate zone, and nothing on the floor.
    for (const n of NODE_SEEDS) {
      expect(chebyshev(n, LANTERN_GATE) > 3, `node ${n.id}`).toBe(true);
      expect(n.x >= LANTERN_FLOOR.x0 && n.x <= LANTERN_FLOOR.x1 && n.z >= LANTERN_FLOOR.z0 && n.z <= LANTERN_FLOOR.z1).toBe(false);
    }
    // The floor is sealed: land, area 'lantern', no walkable tile within 1 of it outside, unreachable from spawn.
    for (const t of FLOOR) { expect(isLandTile(t)).toBe(true); expect(areaOf(t)).toBe('lantern'); expect(seen.has(tileKey(t))).toBe(false); }
    for (let z = LANTERN_FLOOR.z0 - 1; z <= LANTERN_FLOOR.z1 + 1; z++) for (let x = LANTERN_FLOOR.x0 - 1; x <= LANTERN_FLOOR.x1 + 1; x++) {
      const inside = x >= LANTERN_FLOOR.x0 && x <= LANTERN_FLOOR.x1 && z >= LANTERN_FLOOR.z0 && z <= LANTERN_FLOOR.z1;
      if (!inside) expect(isLandTile({ x, z }), `${x},${z}`).toBe(false);
    }
    // The maw is blocked like the Spire's dais.
    expect(blocked.has(tileKey(lanternTile(112)))).toBe(true);
  });

  it('floor visibility: only your own run on the floor, nobody from outside, and the floors never see each other', async () => {
    const { spireSeesPlayer, SPIRE_SPAWNS } = await import('../index');
    const fl = lanternTile(LANTERN_SPAWNS[0]), out = LANTERN_EXIT;
    expect(spireSeesPlayer(out, fl, false)).toBe(false);
    expect(spireSeesPlayer(fl, out, false)).toBe(false);
    expect(spireSeesPlayer(fl, lanternTile(LANTERN_SPAWNS[1]), true)).toBe(true);
    expect(spireSeesPlayer(fl, lanternTile(LANTERN_SPAWNS[1]), false)).toBe(false);
    expect(spireSeesPlayer(fl, SPIRE_SPAWNS[0], true)).toBe(false);
    expect(spireSeesPlayer(out, { x: 40, z: 25 }, false)).toBe(true);
  });
});

describe('closed means closed for crafting', () => {
  const craft = R(craftReducers.craft);
  const kit = () => { h.give(A, 'obsidian', 1); h.give(A, 'driftwood', 2); h.give(A, 'honeycomb', 3); };
  it('fen_bait and the Lanternmaw Lure are refused while sealed (no row, or open = false) and made once open', () => {
    kit();
    expect(() => craft(h.as(A), { recipe: 'fen_bait' })).toThrow('Fen Bait can only be made while the Drowned Hollow is open');
    fresh(A);
    expect(() => craft(h.as(A), { recipe: 'lanternmaw_lure' })).toThrow('Lanternmaw Lure can only be made while the Drowned Hollow is open');
    config({ lanternOpen: false });
    fresh(A);
    expect(() => craft(h.as(A), { recipe: 'fen_bait' })).toThrow('only be made while the Drowned Hollow is open');
    config({ lanternOpen: true });
    fresh(A);
    craft(h.as(A), { recipe: 'fen_bait' });
    expect(h.count(A, 'fen_bait')).toBe(1);
    expect(['obsidian', 'driftwood', 'honeycomb'].map((id) => h.count(A, id))).toEqual([0, 0, 0]);
  });

  it('recipe lists hide them while sealed', () => {
    const ids = (open?: boolean) => recipeStatus([], 1, open).map((r) => r.id);
    expect(ids()).not.toContain('fen_bait');
    expect(ids(false)).not.toContain('lanternmaw_lure');
    expect(ids(true)).toEqual(expect.arrayContaining(['fen_bait', 'lanternmaw_lure']));
    expect(ids(false)).toContain('spire_key');
  });
});
