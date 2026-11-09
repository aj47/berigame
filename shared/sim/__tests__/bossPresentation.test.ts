import { describe, expect, it } from 'vitest';
import { BOSS_CONFIG_DEFAULTS, type BossConfigLike } from '../bossConfig';
import { SPIRE_LOBBY_LIST_MAX, describeClatterhorn, describeSpire } from '../bossPresentation';
import { CLATTER_STONES } from '../bossZones';
import {
  ClatterAttack, ClatterState, clatterLane, clatterSwarmFreeLines, clatterTelegraph, clatterValidCentre, freshClatterhorn,
  identityKey32, type ClatterRowLike,
} from '../clatterhorn';
import { GRID_SIZE } from '../constants';
import {
  SPIRE_NONE, SPIRE_RULES_VERSION, SPIRE_SPAWNS, SpireMemberState, SpireOutcome, SpireStage, spireStars,
  type SpireFightLike, type SpireMemberLike, type SpireRunLike,
} from '../spire';

const cfg: BossConfigLike = { ...BOSS_CONFIG_DEFAULTS, clatterhornOpen: true, spireOpen: true };
/** No trees: these tests are about the block's shape; the escape tests below pass the real world. */
const W = { blocked: new Set<number>() };
const ME = 'c'.repeat(56) + '0000abcd';
const hex = (i: number) => i.toString(16).padStart(64, '0');
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const crow = (over: Partial<ClatterRowLike> = {}): ClatterRowLike => ({
  ...freshClatterhorn(cfg), state: ClatterState.Idle, engagedTick: 900, lastHitTick: 900, fightCount: 2, ...over,
});

describe('describeClatterhorn', () => {
  const me = { x: 84, z: 103, identity: ME };

  it('is null without a row', () => {
    expect(describeClatterhorn(null, cfg, me, 1000, null, W)).toBeNull();
  });

  it('dormant, closed and burrowed', () => {
    const dormant = describeClatterhorn(freshClatterhorn(cfg), cfg, me, 1000, null, W)!;
    expect(dormant).toMatchObject({
      open: true, state: 'dormant', tile: { x: 84, z: 106 }, home: { x: 84, z: 106 }, body: 1, reach: 2,
      glade: { x0: 76, z0: 98, x1: 92, z1: 114 }, health: 300, maxHealth: 300, challengers: 0, phase: 1, frenzy: false,
      flipped: null, bait: null, telegraph: null, swarm: null, returnsInTicks: 0, resetInTicks: null,
      you: { contribution: 0, qualified: false, inGlade: true, inReach: false },
      reward: { items: [{ itemId: 'gleamshell', quantity: 2 }, { itemId: 'berry_goldberry', quantity: 2 }], fightingXp: 40, minDamage: 16,
        recentTicks: 100, keepsake: 'clatterhorn_horn' },
    });
    expect(dormant.stones).toEqual(CLATTER_STONES.map((s) => [s.x, s.z]));
    expect(String(dormant.rule)).toContain('100 ticks');
    const closedCfg = { ...cfg, clatterhornOpen: false };
    expect(describeClatterhorn(freshClatterhorn(closedCfg), closedCfg, me, 1000, null, W)).toMatchObject({ open: false, state: 'closed' });
    const burrowed = describeClatterhorn(crow({ state: ClatterState.Burrowed, stateUntilTick: 1200, hp: 0 }), cfg, me, 1000, 30, W)!;
    expect(burrowed).toMatchObject({ state: 'burrowed', returnsInTicks: 200, health: 0, you: { contribution: 30, qualified: true, inReach: false } });
  });

  it('idle alone, flipped and frenzy', () => {
    expect(describeClatterhorn(crow({ stateUntilTick: 1060 }), cfg, me, 1000, 5, W)).toMatchObject({ state: 'idle', resetInTicks: 60, you: { qualified: false } });
    const flipped = describeClatterhorn(crow({ state: ClatterState.Flipped, stateUntilTick: 1005 }), cfg, { ...me, z: 104 }, 1000, null, W)!;
    expect(flipped).toMatchObject({ state: 'flipped', flipped: { endsInTicks: 5, damageMultiplier: 2 }, you: { inReach: true } });
    expect(describeClatterhorn(crow({}), cfg, me, 900 + 450, null, W)).toMatchObject({ frenzy: true, phase: 3 });
  });

  it('charge telegraph: exact tiles, direction, end, bait and escape', () => {
    const lane = clatterLane({ x: 84, z: 106 }, 4); // north
    const row = crow({ state: ClatterState.ChargeWindup, attack: ClatterAttack.Charge, dir: 4, endX: lane.end.x, endZ: lane.end.z,
      endKind: lane.endKind, stateUntilTick: 1003, bait: identityKey32(ME) });
    const d = describeClatterhorn(row, cfg, me, 1000, null, W)!;
    const tel = d.telegraph as Record<string, unknown>;
    expect(d.bait).toBe(ME);
    expect(tel).toMatchObject({ attack: 'charge', landsInTicks: 3, damage: 14, dir: 'N', from: { x: 84, z: 106 }, to: { x: lane.end.x, z: lane.end.z },
      end: ['skid', 'glance', 'flip'][lane.endKind - 1], youAreInside: true });
    expect(tel.tiles).toEqual(clatterTelegraph(row)!.tiles.map((k) => [k % GRID_SIZE, Math.floor(k / GRID_SIZE)]));
    const escape = tel.escape as [number, number][];
    expect(escape.length).toBeGreaterThan(0);
    for (const [x, z] of escape) expect(lane.tiles).not.toContain(z * GRID_SIZE + x);
    const other = describeClatterhorn({ ...row, bait: 0x1234abcd }, cfg, me, 1000, null, W)!;
    expect(other.bait).toBe('1234abcd');
  });

  it('swarm block', () => {
    const windup = crow({ state: ClatterState.DrumWindup, attack: ClatterAttack.Drum, swarmSide: 1, swarmFree: 2, stateUntilTick: 1003 });
    expect(describeClatterhorn(windup, cfg, me, 1000, null, W)!.swarm).toEqual({
      side: 'east', firesInTicks: 3, activeUntilTick: 1023, axis: 'z', freeLines: clatterSwarmFreeLines(windup), damage: 5, tilesPerTick: 1,
    });
    const drumming = { ...windup, state: ClatterState.Drumming, swarmTick: 1003, stateUntilTick: 1023 };
    const d = describeClatterhorn(drumming, cfg, me, 1010, null, W)!;
    expect(d.swarm).toMatchObject({ side: 'east', firesInTicks: 0, activeUntilTick: 1023 });
    expect(d.telegraph).toBeNull();
  });

  it('stays under 2 KB for every charge lane', () => {
    let worst = 0;
    for (let z = 99; z <= 113; z++) for (let x = 77; x <= 91; x++) {
      if (!clatterValidCentre({ x, z })) continue;
      for (let dir = 0; dir < 8; dir++) {
        const lane = clatterLane({ x, z }, dir);
        if (lane.len < 2) continue;
        const row = crow({ x, z, state: ClatterState.ChargeWindup, attack: ClatterAttack.Charge, dir, endX: lane.end.x, endZ: lane.end.z,
          endKind: lane.endKind, stateUntilTick: 1003, bait: identityKey32(hex(9)), challengers: 120, hp: 18200, maxHp: 18200 });
        const k = lane.tiles[Math.floor(lane.tiles.length / 2)];
        const at = { x: k % GRID_SIZE, z: Math.floor(k / GRID_SIZE), identity: ME };
        worst = Math.max(worst, bytes(describeClatterhorn(row, cfg, at, 1000, 99999, W)));
      }
    }
    expect(worst).toBeGreaterThan(1000);
    expect(worst).toBeLessThanOrEqual(2048);
  });
});

// ---- Spire -------------------------------------------------------------------------------------------------------

const T0 = 5000;
type Member = SpireMemberLike & { identity: string };
const run = (id: bigint, over: Partial<SpireRunLike> & { leader?: unknown } = {}): SpireRunLike => ({
  id, stage: SpireStage.Lobby, outcome: 0, mode: 0, isPublic: true, rules: SPIRE_RULES_VERSION, partySize: 1,
  createdTick: T0 - 10, queuedTick: 0, startTick: 0, endTick: T0 + 140, phase: 1, clearTicks: 0, ...over,
} as SpireRunLike);
const member = (identity: string, runId: bigint, slot: number, over: Partial<Member> = {}): Member => ({
  identity, runId, slot, state: SpireMemberState.Lobby, joinedTick: T0 - 10, awaySinceTick: 0, awayCount: 0,
  downUntilTick: 0, reviveSinceTick: 0, meals: 0, ...over,
});
function fight(over: Partial<SpireFightLike> = {}): SpireFightLike {
  return {
    hp: 2400, maxHp: 3100, phase: 2, seed: 4242, patternCount: 5,
    curKind: 3, curStart: T0 - 2, curSeed: 9, curAimX: 72, curAimZ: 66,
    prevKind: SPIRE_NONE, prevStart: 0, prevSeed: 0, prevAimX: 0, prevAimZ: 0,
    starWave: 4, starMask: 0b10,
    hitTick0: 0, hitTick1: 0, hitTick2: 0, hitTick3: 0, hits0: 1, hits1: 0, hits2: 2, hits3: 0,
    stars0: 5, stars1: 3, stars2: 0, stars3: 1, dmg0: 0, dmg1: 0, dmg2: 0, dmg3: 0,
    downs0: 0, downs1: 0, downs2: 0, downs3: 0, ...over,
  };
}
const names = (hexId: string) => `P${hexId.slice(-3)}`;

describe('describeSpire', () => {
  const base = {
    cfg, fight: null, tick: T0, keysHeld: 2,
    name: names,
    player: (_: string) => null as { x: number; z: number; hp: number } | null,
  };

  it('outside a run: gate, key, capacity and public lobbies, newest first', () => {
    const runs = [
      run(1n, { createdTick: T0 - 30, leader: hex(1) }),
      run(2n, { createdTick: T0 - 5, partySize: 2, leader: { toHexString: () => hex(2) } }),
      run(3n, { stage: SpireStage.Active, startTick: T0 - 50, endTick: T0 + 550, partySize: 2 }),
      run(4n, { createdTick: T0 - 1, isPublic: false }),
      run(5n, { createdTick: T0 - 3 }), // no leader column: lowest slot
    ];
    const members = [
      member(hex(1), 1n, 0), member(hex(2), 2n, 0), member(hex(3), 2n, 1),
      member(hex(4), 3n, 0, { state: SpireMemberState.In }), member(hex(5), 3n, 1, { state: SpireMemberState.Out }),
      member(hex(7), 5n, 1), member(hex(6), 5n, 2),
    ];
    const at: Record<string, { x: number; z: number; hp: number }> = { [hex(4)]: { x: 74, z: 60, hp: 20 }, [hex(5)]: { x: 61, z: 45, hp: 10 } };
    const d = describeSpire({ ...base, runs, members, me: { identity: ME, x: 62, z: 47 }, player: (h) => at[h] ?? null });
    expect(d).toMatchObject({
      open: true, rulesVersion: SPIRE_RULES_VERSION, gate: { x: 62, z: 45 }, exit: { x: 61, z: 45 }, joinRange: 3, atGate: true,
      key: { itemId: 'spire_key', held: 2, inputs: [{ itemId: 'obsidian', quantity: 3 }, { itemId: 'gleamshell', quantity: 1 }] },
      capacity: { active: 1, max: 12, lobbies: 4, inside: 1 },
      you: null, run: null,
      reward: { fightingXp: 100, minStars: 3, keepsake: 'prism_crown', flawlessKeepsake: 'shard_pendant' },
    });
    expect(d.lobbies).toEqual([
      { runId: '5', leader: hex(7), leaderName: names(hex(7)), members: 1, closesInTicks: 140 },
      { runId: '2', leader: hex(2), leaderName: names(hex(2)), members: 2, closesInTicks: 140 },
      { runId: '1', leader: hex(1), leaderName: names(hex(1)), members: 1, closesInTicks: 140 },
    ]);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/practice|queued|queuePosition|downs|downInTicks|reviveTicks/);
    expect(bytes(d)).toBeLessThan(2048);
  });

  it('in a lobby: you without a run block', () => {
    const d = describeSpire({ ...base, runs: [run(9n, { leader: ME })], members: [member(ME, 9n, 0)], me: { identity: ME, x: 62, z: 47 } });
    expect(d.you).toEqual({ runId: '9', stage: 'lobby', state: 'lobby', slot: 0, leader: true });
    expect(d.run).toBeNull();
  });

  it('in an active run: boss, clocks, stars and members', () => {
    const r = run(12n, { stage: SpireStage.Active, startTick: T0 - 40, endTick: T0 + 560, partySize: 4, leader: hex(2) });
    const ids = [ME, hex(2), hex(3), hex(4)];
    const members = ids.map((id, slot) => member(id, 12n, slot, { state: slot === 3 ? SpireMemberState.Out : SpireMemberState.In, meals: slot,
      awaySinceTick: slot === 2 ? T0 - 3 : 0 }));
    const at = (h: string) => {
      const slot = ids.indexOf(h);
      return slot === 3 ? { x: 61, z: 45, hp: 10 } : { ...SPIRE_SPAWNS[slot], hp: 30 - slot };
    };
    const d = describeSpire({ ...base, runs: [r], members, fight: fight(), me: { identity: ME, ...SPIRE_SPAWNS[0] }, player: at });
    expect(d.capacity).toMatchObject({ active: 1, inside: 3 });
    expect(d.you).toEqual({ runId: '12', stage: 'active', state: 'in', slot: 0, leader: false });
    const rb = d.run as Record<string, any>;
    expect(rb).toMatchObject({
      runId: '12', stage: 'active', outcome: null,
      boss: { name: 'The Shardmother', health: 2400, maxHealth: 3100, phase: 2, phaseName: 'gale', pattern: 'crosswind', enraged: false },
      startsInTicks: 0, timeLeftTicks: 560, enrageInTicks: 380, hitDamage: 3,
      court: { center: { x: 77, z: 62 }, range: 4 }, danger: '/api/agent/v1/danger',
    });
    // Tick T0 + 1 is in wave 3 (40 + 1 = 41 -> floor(41 / 12) = 3); starWave 4 is a later wave, so nothing is masked.
    const wave = Math.floor((T0 + 1 - (T0 - 40)) / 12);
    expect(rb.stars.wave).toBe(wave);
    expect(rb.stars.live.map(({ x, z }: { x: number; z: number }) => ({ x, z }))).toEqual(spireStars(4242, wave, 6));
    expect(rb.stars.nextInTicks).toBe(T0 - 40 + 12 * (wave + 1) - T0);
    expect(rb.members).toEqual(ids.map((id, slot) => ({
      playerId: id, name: names(id), slot, state: slot === 3 ? 'out' : 'in', health: at(id).hp, tile: { x: at(id).x, z: at(id).z },
      stars: [5, 3, 0, 1][slot], hits: [1, 0, 2, 0][slot], meals: slot, away: slot === 2,
    })));
    expect(bytes(d)).toBeLessThanOrEqual(4096);
  });

  it('enrage, the starMask of the current wave and a cleared run', () => {
    const r = run(13n, { stage: SpireStage.Active, startTick: T0 - 430, endTick: T0 + 170, partySize: 1 });
    const wave = Math.floor((T0 + 1 - r.startTick) / 12);
    const d = describeSpire({ ...base, runs: [r], members: [member(ME, 13n, 0, { state: SpireMemberState.In })],
      fight: fight({ phase: 4, starWave: wave, starMask: 0b101 }), me: { identity: ME, x: 72, z: 68 } });
    const rb = d.run as Record<string, any>;
    expect(rb.boss.enraged).toBe(true);
    expect(rb.enrageInTicks).toBe(0);
    expect(rb.hitDamage).toBe(6);
    expect(rb.stars.live).toHaveLength(1);
    const cleared = describeSpire({ ...base, runs: [{ ...r, stage: SpireStage.Cleared, outcome: SpireOutcome.Cleared, clearTicks: 333, endTick: T0 + 15 }],
      members: [member(ME, 13n, 0, { state: SpireMemberState.Done })], fight: fight({ hp: 0 }), me: { identity: ME, x: 61, z: 45 } });
    expect(cleared.run).toMatchObject({ stage: 'cleared', outcome: 'cleared', clearTicks: 333, timeLeftTicks: 0, stars: null });
    expect(cleared.atGate).toBe(true);
  });

  it('stays under 4 KB with many lobbies and a full party', () => {
    const runs: SpireRunLike[] = [run(100n, { stage: SpireStage.Active, startTick: T0 - 10, endTick: T0 + 590, partySize: 4, leader: ME })];
    const members: Member[] = [0, 1, 2, 3].map((slot) => member(slot ? hex(900 + slot) : ME, 100n, slot, { state: SpireMemberState.In }));
    for (let i = 0; i < 48; i++) {
      runs.push(run(BigInt(200 + i), { createdTick: T0 - i, partySize: 3, leader: hex(1000 + i) }));
      members.push(member(hex(1000 + i), BigInt(200 + i), 0));
    }
    const d = describeSpire({ ...base, runs, members, fight: fight(), me: { identity: ME, x: 72, z: 68 },
      name: () => 'W'.repeat(16), player: () => ({ x: 72, z: 68, hp: 30 }) });
    expect((d.lobbies as unknown[]).length).toBe(SPIRE_LOBBY_LIST_MAX);
    expect(bytes(d)).toBeLessThanOrEqual(4096);
  });
});

// ---- Lanternmaw --------------------------------------------------------------------------------------------------

import { LANTERN_CONFIG_DEFAULTS } from '../bossConfig';
import { LANTERN_LOBBY_LIST_MAX, describeLantern } from '../bossPresentation';
import type { LanternFightRowLike, LanternMemberLike, LanternRunLike } from '../bossDanger';
import {
  LANTERN_RULES_VERSION, LANTERN_SPAWNS, LANTERN_SPRINGS, LANTERN_STAGE_NAMES, LanternStage, lanternAdvance, lanternBuildPattern,
  lanternEmptySlots, lanternFreshFight, lanternTile,
} from '../lanternmaw';
import { emptySlots } from '../inventory';

describe('describeLantern', () => {
  const L = 8000;
  const lcfg = { ...LANTERN_CONFIG_DEFAULTS, lanternOpen: true };
  type LMember = LanternMemberLike & { identity: string };
  const lrun = (id: bigint, over: Partial<LanternRunLike> & { leader?: unknown } = {}): LanternRunLike => ({
    id, stage: SpireStage.Lobby, outcome: 0, rules: LANTERN_RULES_VERSION, partySize: 1,
    createdTick: L - 10, startTick: 0, endTick: L + 140, phase: 1, clearTicks: 0, ...over,
  } as LanternRunLike);
  const lmember = (identity: string, runId: bigint, slot: number, over: Partial<LMember> = {}): LMember => ({
    identity, runId, slot, state: SpireMemberState.Lobby, joinedTick: L - 10, awaySinceTick: 0, awayCount: 0, meals: 0, ...over,
  });
  /** The fight row after tick t of a run that started at L. */
  function rowAfter(t: number, party = 1, seed = 31337): LanternFightRowLike {
    const targets = LANTERN_SPAWNS.slice(0, party);
    let f = lanternFreshFight(seed, party, L, targets);
    for (let T = L; T <= t; T++) f = lanternAdvance(f, T, L, targets);
    return { ...f, ...lanternEmptySlots() };
  }
  const bag = (...items: [string, number][]) => {
    const slots = emptySlots();
    items.forEach(([itemId, quantity], i) => { slots[i] = { itemId, quantity }; });
    return slots;
  };
  const base = { cfg: lcfg, fight: null, tick: L, entry: null, name: names, player: (_: string) => null as { x: number; z: number; hp: number } | null };
  const gate = { identity: ME, x: 47, z: 150 };

  it('outside a run: gate, entry needs, capacity, lobbies newest first, reward and the daily cap', () => {
    const runs = [
      lrun(1n, { createdTick: L - 30, leader: hex(1) }),
      lrun(2n, { createdTick: L - 5, partySize: 2, leader: { toHexString: () => hex(2) } }),
      lrun(3n, { stage: SpireStage.Active, startTick: L - 50, endTick: L + 550, partySize: 2 }),
      lrun(4n, { createdTick: L - 1, rules: LANTERN_RULES_VERSION - 1, leader: hex(8) }),
    ];
    const members = [lmember(hex(1), 1n, 0), lmember(hex(2), 2n, 0), lmember(hex(3), 2n, 1),
      lmember(hex(4), 3n, 0, { state: SpireMemberState.In }), lmember(hex(5), 3n, 1, { state: SpireMemberState.Out }), lmember(hex(8), 4n, 0)];
    const at: Record<string, { x: number; z: number; hp: number }> = { [hex(4)]: { x: 60, z: 140, hp: 20 }, [hex(5)]: { x: 47, z: 153, hp: 10 } };
    const d = describeLantern({ ...base, runs, members, me: gate, player: (h) => at[h] ?? null,
      entry: { slots: bag(['stone_club', 1], ['fen_bait', 2]), coins: 12, wielded: '' } });
    expect(d).toMatchObject({
      open: true, rulesVersion: LANTERN_RULES_VERSION, gate: { x: 47, z: 152 }, exit: { x: 47, z: 153 }, joinRange: 3, atGate: true,
      floor: { x0: 56, z0: 129, x1: 70, z1: 143 },
      entry: {
        weapon: { minDamage: 8, best: 8, ok: true },
        bait: { itemId: 'fen_bait', held: 2, recipe: 'fen_bait', craftingLevel: 1,
          inputs: [{ itemId: 'obsidian', quantity: 1 }, { itemId: 'driftwood', quantity: 2 }, { itemId: 'honeycomb', quantity: 3 }] },
        fee: { coins: 5, held: 12 }, ready: true, problem: null,
      },
      capacity: { active: 1, max: 12, lobbies: 3, inside: 1 },
      you: null, run: null,
      reward: { items: [{ itemId: 'fenlight', quantity: 2, name: 'Fenlight' }], fightingXp: 120, minDamage: 40, keepsake: 'lanternmaw_lure', dailyPaidClears: 4 },
    });
    expect(String((d.reward as any).dailyCap)).toMatch(/first 4 qualifying clears each UTC day/);
    expect(d.lobbies).toEqual([
      { runId: '4', leader: hex(8), leaderName: names(hex(8)), members: 1, closesInTicks: 140, outdated: true },
      { runId: '2', leader: hex(2), leaderName: names(hex(2)), members: 2, closesInTicks: 140 },
      { runId: '1', leader: hex(1), leaderName: names(hex(1)), members: 1, closesInTicks: 140 },
    ]);
    expect(String(d.rule)).toMatch(/1 fen_bait \(craft: 1 obsidian \+ 2 driftwood \+ 3 honeycomb, Crafting 1\) and 5 coins/);
    expect(bytes(d)).toBeLessThan(3072);
  });

  it('entry problems: no weapon, no bait, no coins; unknown entry reads null', () => {
    const one = (slots: ReturnType<typeof bag>, coins: number, wielded = '') =>
      (describeLantern({ ...base, runs: [], members: [], me: gate, entry: { slots, coins, wielded } }).entry as any);
    expect(one(bag(['stick', 1], ['fen_bait', 1]), 9)).toMatchObject({ weapon: { best: 6, ok: false }, ready: false,
      problem: 'Bring a weapon to the Drowned Hollow: a stone club or better' });
    expect(one(bag(['fen_bait', 1]), 9, 'stone_club').weapon).toMatchObject({ best: 8, ok: true });
    expect(one(bag(['stone_club', 1]), 9).problem).toBe('You need a Fen Bait');
    expect(one(bag(['stone_club', 1], ['fen_bait', 1]), 4).problem).toBe('You need 5 coins');
    const unknown = describeLantern({ ...base, runs: [], members: [], me: { identity: ME, x: 10, z: 10 } });
    expect(unknown).toMatchObject({ atGate: false, entry: { weapon: { best: null, ok: null }, bait: { held: null }, fee: { held: null }, ready: null, problem: null } });
    expect(describeLantern({ ...base, cfg: LANTERN_CONFIG_DEFAULTS, runs: [], members: [], me: gate }).open).toBe(false);
  });

  it('closed: a compact {open, gate} away from the gate; the full entry block at the gate', () => {
    const away = describeLantern({ ...base, cfg: LANTERN_CONFIG_DEFAULTS, runs: [], members: [], me: { identity: ME, x: 10, z: 10 } });
    expect(away).toEqual({ open: false, gate: { x: 47, z: 152 } });
    expect(bytes(away)).toBeLessThan(64);
    const at = describeLantern({ ...base, cfg: LANTERN_CONFIG_DEFAULTS, runs: [], members: [], me: gate });
    expect(at).toMatchObject({ open: false, atGate: true, entry: { bait: { recipe: 'fen_bait' } } });
  });

  it('in a lobby: you without a run block', () => {
    const d = describeLantern({ ...base, runs: [lrun(9n, { leader: ME, partySize: 2 })], members: [lmember(ME, 9n, 0), lmember(hex(2), 9n, 1)], me: gate });
    expect(d.you).toMatchObject({ runId: '9', stage: 'lobby', state: 'lobby', slot: 0, leader: true, party: 2 });
    expect(d.run).toBeNull();
  });

  it('in a lobby: ready per member (valid until leave or start); the leader needs none; a solo party needs none', () => {
    const runs = [lrun(9n, { leader: ME, partySize: 3 })];
    const members = [lmember(ME, 9n, 0), lmember(hex(2), 9n, 1), lmember(hex(3), 9n, 2)];
    // hex(2) readied long ago (still valid); hex(3)'s row belongs to another lobby.
    const ready = [{ identity: hex(2), runId: 9n, tick: L - 500 }, { identity: hex(3), runId: 7n, tick: L - 1 }];
    const lead = describeLantern({ ...base, runs, members, ready, me: gate });
    expect((lead.you as any).readyWithinTicks).toBeUndefined();
    expect((lead.you as any).members).toEqual([
      { playerId: ME, name: names(ME), slot: 0, leader: true, ready: true },
      { playerId: hex(2), name: names(hex(2)), slot: 1, leader: false, ready: true },
      { playerId: hex(3), name: names(hex(3)), slot: 2, leader: false, ready: false },
    ]);
    expect((lead.you as any).startReady).toBe(false);
    const mate = describeLantern({ ...base, runs, members, ready, me: { identity: hex(3), x: gate.x, z: gate.z } });
    expect((mate.you as any)).toMatchObject({ ready: false, sendReady: true });
    const solo = describeLantern({ ...base, runs: [lrun(8n, { leader: ME, partySize: 1 })], members: [lmember(ME, 8n, 0)], me: gate });
    expect((solo.you as any)).toMatchObject({ startReady: true, sendReady: false });
  });

  it('in the den: boss, pattern and blow ticks, reach, swing cadence, meals and members', () => {
    const r = lrun(12n, { stage: SpireStage.Active, startTick: L, endTick: L + 600, partySize: 2, leader: ME });
    const fight = { ...rowAfter(L + 1, 2), dmg0: 44, hits0: 1, caps1: 2, dmg1: 7 };
    const ids = [ME, hex(2)];
    const members = ids.map((id, slot) => lmember(id, 12n, slot, { state: SpireMemberState.In, meals: slot + 1 }));
    const courtTile = { x: 63, z: 134 }; // ring 2, north of the maw
    const at = (h: string) => (h === ME ? { ...courtTile, hp: 24 } : { ...lanternTile(LANTERN_SPAWNS[1]), hp: 30 });
    const d = describeLantern({ ...base, tick: L + 2, runs: [r], members, fight, me: { identity: ME, ...courtTile }, player: at });
    expect(d.capacity).toMatchObject({ active: 1, inside: 2 });
    expect(d.you).toEqual({ runId: '12', stage: 'active', state: 'in', slot: 0, leader: true, party: 2 });
    const rb = d.run as Record<string, any>;
    expect(rb).toMatchObject({
      runId: '12', stage: 'active', outcome: null, fightStage: 'den', cycle: 0, spring: null,
      boss: { name: 'Lanternmaw', health: fight.hp, maxHealth: fight.maxHp, phase: 1, enraged: false },
      startsInTicks: 0, timeLeftTicks: 598, enrageInTicks: 418,
      damage: { blow: 10, pulse: 7, flood: 3, bite: 6 },
      reach: { x: 63, z: 136, range: 2 },
      you: { slot: 0, inReach: true, nextSwingTick: L + 4, nextSwingInTicks: 2, dealt: 44, qualified: true, mealsLeft: 3, hits: 1, drowned: 0, caps: 0 },
      danger: '/api/agent/v1/danger',
    });
    const blows = [...new Set(lanternBuildPattern(fight.curKind, fight.curSeed, fight.curAim).map((b) => fight.curStart + b.at))];
    expect(rb.den).toMatchObject({ blowTicks: blows, nextBlowInTicks: blows.find((t) => t > L + 2)! - (L + 2), patternsBeforeDive: 2 });
    expect(['lure_sweep', 'tail_lash', 'maw_bellow']).toContain(rb.den.pattern);
    expect(rb.members).toEqual([
      { playerId: ME, name: names(ME), slot: 0, state: 'in', health: 24, tile: courtTile, dealt: 44, caps: 0, meals: 1, away: false },
      { playerId: hex(2), name: names(hex(2)), slot: 1, state: 'in', health: 30, tile: lanternTile(LANTERN_SPAWNS[1]), dealt: 7, caps: 2, meals: 2, away: false },
    ]);
    expect(bytes(d)).toBeLessThanOrEqual(4096);
  });

  it('the dive publishes the spring and S; capped at S it chokes; the ebb hides it again', () => {
    const r = lrun(13n, { stage: SpireStage.Active, startTick: L, endTick: L + 600 });
    const members = [lmember(ME, 13n, 0, { state: SpireMemberState.In })];
    let dive = L;
    while (rowAfter(dive).stage !== LanternStage.Dive) dive++;
    const f = rowAfter(dive);
    const S = f.surfaceTick;
    const spring = lanternTile(LANTERN_SPRINGS[f.spring]);
    const at = (tick: number, fight: LanternFightRowLike, me = spring) =>
      describeLantern({ ...base, tick, runs: [r], members, fight, me: { identity: ME, ...me } }).run as Record<string, any>;
    const d = at(dive, f);
    expect(d.fightStage).toBe(LANTERN_STAGE_NAMES[LanternStage.Dive]);
    expect(d.den).toBeNull();
    expect(d.reach).toBeNull();
    expect(d.you.inReach).toBe(false);
    expect(d.spring).toEqual({ tile: spring, surfaceTick: S, surfacesInTicks: 8, floodUntilTick: S + 14, capped: false, choked: false, chokedUntilTick: null, feeding: false });
    const capped = at(S, { ...rowAfter(S), capped: true });
    expect(capped.fightStage).toBe('tide');
    expect(capped.spring).toMatchObject({ capped: true, choked: true, chokedUntilTick: S + 8, feeding: false });
    expect(capped.reach).toEqual({ ...spring, range: 2 });
    expect(capped.you.inReach).toBe(true);
    const fed = at(S + 2, rowAfter(S + 2));
    expect(fed.spring).toMatchObject({ capped: false, choked: false, feeding: true });
    expect(at(S + 15, rowAfter(S + 15)).spring).toBeNull();
  });

  it('a cleared run, and under 4 KB with 10 lobbies and a full party with long names', () => {
    const cleared = describeLantern({ ...base, runs: [lrun(14n, { stage: SpireStage.Cleared, outcome: SpireOutcome.Cleared, startTick: L - 400, endTick: L + 15, clearTicks: 380 })],
      members: [lmember(ME, 14n, 0, { state: SpireMemberState.Done })], fight: { ...rowAfter(L), hp: 0 }, me: { identity: ME, x: 47, z: 153 } });
    expect(cleared.run).toMatchObject({ stage: 'cleared', outcome: 'cleared', clearTicks: 380, timeLeftTicks: 0, you: { nextSwingTick: null, inReach: false } });
    const runs: LanternRunLike[] = [lrun(100n, { stage: SpireStage.Active, startTick: L - 10, endTick: L + 590, partySize: 4, leader: ME })];
    const members: LMember[] = [0, 1, 2, 3].map((slot) => lmember(slot ? hex(900 + slot) : ME, 100n, slot, { state: SpireMemberState.In }));
    for (let i = 0; i < 48; i++) {
      runs.push(lrun(BigInt(200 + i), { createdTick: L - i, partySize: 3, leader: hex(1000 + i) }));
      members.push(lmember(hex(1000 + i), BigInt(200 + i), 0));
    }
    let biggest = 0;
    for (let t = L - 10; t < L + 150; t += 3) {
      const d = describeLantern({ ...base, tick: t, runs, members, fight: { ...rowAfter(t, 4), dmg0: 4000000000 }, me: { identity: ME, x: 60, z: 140 },
        entry: { slots: bag(['stone_club', 1], ['fen_bait', 10]), coins: 1000000000, wielded: 'stone_club' },
        name: () => 'W'.repeat(16), player: () => ({ x: 60, z: 140, hp: 30 }) });
      expect(d.lobbies).toEqual([]); // omitted inside a started run
      biggest = Math.max(biggest, bytes(d));
    }
    expect(biggest).toBeLessThanOrEqual(4096);
    const outside = describeLantern({ ...base, runs, members: members.slice(4), me: { identity: ME, x: 47, z: 150 },
      entry: { slots: bag(['stone_club', 1]), coins: 3, wielded: '' }, name: () => 'W'.repeat(16) });
    expect((outside.lobbies as unknown[]).length).toBe(LANTERN_LOBBY_LIST_MAX);
    expect(bytes(outside)).toBeLessThanOrEqual(4096);
  });
});
