import { describe, expect, it } from 'vitest';
import { BOSS_CONFIG_DEFAULTS, type BossConfigLike } from '../bossConfig';
import { CLATTER_GLADE, CLATTER_HOME, CLATTER_STONES } from '../bossZones';
import { BULLET_STRIDE, mix32 } from '../bullets';
import {
  CLATTER_CHAIN, CLATTER_CHARGE_WINDUP, CLATTER_DAMAGE, CLATTER_DIR8, CLATTER_DRUM_EVERY, CLATTER_FLIP_TICKS,
  CLATTER_FRENZY_FLIP_TICKS, CLATTER_LONELY_TICKS, CLATTER_MAX_LANE, CLATTER_RESPAWN_TICKS, CLATTER_SWARM_TICKS,
  ClatterAttack, ClatterEndKind, ClatterState, clatterAttackable, clatterChooseLane, clatterFrenzy, clatterHitsMove, clatterSlam, clatterSlamTiles,
  clatterLane, clatterMaxHp, clatterOctant, clatterPhase, clatterQualifies, clatterReturnHome, clatterRewardees,
  clatterSpinTiles, clatterSwarmBullets, clatterSwarmFreeLines, clatterSwarmHit, clatterTelegraph, clatterValidCentre,
  freshClatterhorn, identityKey32, stepClatterhorn, type ClatterCandidate, type ClatterRowLike,
} from '../clatterhorn';
import { GRID_SIZE } from '../constants';
import { tileKey } from '../grid';
import type { Tile } from '../types';

const cfg: BossConfigLike = { ...BOSS_CONFIG_DEFAULTS, clatterhornOpen: true };
const G = CLATTER_GLADE;
const T = (x: number, z: number): Tile => ({ x, z });
const key = (x: number, z: number) => z * GRID_SIZE + x;
const unkey = (k: number) => T(k % GRID_SIZE, Math.floor(k / GRID_SIZE));
const inG = (x: number, z: number) => x >= G.x0 && x <= G.x1 && z >= G.z0 && z <= G.z1;
const stone = (x: number, z: number) => CLATTER_STONES.some((s) => s.x === x && s.z === z);
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const row = (over: Partial<ClatterRowLike> = {}): ClatterRowLike => ({ ...freshClatterhorn(cfg), ...over });
const cand = (x: number, z: number, order: number, k = order + 100): ClatterCandidate => ({ x, z, order, key: k });
/** A fight in progress: woke at tick 1000, full HP. */
const fight = (over: Partial<ClatterRowLike> = {}) =>
  row({ state: ClatterState.Idle, engagedTick: 1000, lastHitTick: 1000, fightCount: 4, defeats: 2, owedLeft: 3, ...over });

const gladeTiles: Tile[] = [];
for (let z = G.z0; z <= G.z1; z++) for (let x = G.x0; x <= G.x1; x++) gladeTiles.push(T(x, z));

describe('constants and small helpers', () => {
  it('derives the identity key from the last 8 hex digits, never 0', () => {
    expect(identityKey32('0'.repeat(56) + 'deadbeef')).toBe(0xdeadbeef);
    expect(identityKey32('f'.repeat(56) + '00000001')).toBe(1);
    expect(identityKey32('ab'.repeat(32))).toBe(0xabababab);
    expect(identityKey32('0'.repeat(64))).toBe(1);
  });

  it('inserts Closed by default and Dormant at home when open, with base HP', () => {
    expect(freshClatterhorn(BOSS_CONFIG_DEFAULTS).state).toBe(ClatterState.Closed);
    const r = freshClatterhorn(cfg);
    expect(r).toMatchObject({ state: ClatterState.Dormant, x: CLATTER_HOME.x, z: CLATTER_HOME.z, hp: 300, maxHp: 300, phase: 1, fightCount: 0, challengers: 0 });
  });

  it('grows HP per challenger up to the cap', () => {
    expect(clatterMaxHp(cfg, 0)).toBe(300);
    expect(clatterMaxHp(cfg, 1)).toBe(500);
    expect(clatterMaxHp(cfg, 10)).toBe(2300);
    expect(clatterMaxHp(cfg, 120)).toBe(24300);
    expect(clatterMaxHp(cfg, 250)).toBe(24300);
    expect(clatterMaxHp({ ...cfg, clatterHpBase: 500, clatterHpPerChallenger: 50 }, 3)).toBe(650);
  });

  it('phases by HP band and frenzy, never going down', () => {
    const r = fight({ hp: 1000, maxHp: 1000 });
    expect(clatterPhase(r, 1100)).toBe(1);
    expect(clatterPhase({ ...r, hp: 667 }, 1100)).toBe(1);
    expect(clatterPhase({ ...r, hp: 666 }, 1100)).toBe(2);
    expect(clatterPhase({ ...r, hp: 334 }, 1100)).toBe(2);
    expect(clatterPhase({ ...r, hp: 333 }, 1100)).toBe(3);
    expect(clatterPhase(r, 1449)).toBe(1);
    expect(clatterFrenzy(r, 1449)).toBe(false);
    expect(clatterPhase(r, 1450)).toBe(3);
    expect(clatterFrenzy(r, 1450)).toBe(true);
    // HP growth raises the ratio, the stored phase holds.
    expect(clatterPhase({ ...r, phase: 2, hp: 1000 }, 1100)).toBe(2);
    expect(clatterPhase({ ...r, phase: 3, hp: 1000 }, 1100)).toBe(3);
  });

  it('is attackable in every state but Dormant, Burrowed and Closed', () => {
    for (let s = 0; s <= 9; s++) {
      const expected = s !== ClatterState.Dormant && s !== ClatterState.Burrowed && s !== ClatterState.Closed;
      expect(clatterAttackable(row({ state: s }))).toBe(expected);
    }
  });

  it('maps deltas to Facing octants', () => {
    const cases: [number, number, number][] = [
      [0, 5, 0], [-5, 5, 1], [-5, 0, 2], [-5, -5, 3], [0, -5, 4], [5, -5, 5], [5, 0, 6], [5, 5, 7],
      [3, 1, 6], [2, 1, 7], [1, 2, 7], [1, 3, 0], [-3, 1, 2], [-2, -1, 3], [-1, -3, 4], [1, -2, 5],
    ];
    for (const [dx, dz, o] of cases) expect(clatterOctant(dx, dz, 4), `${dx},${dz}`).toBe(o);
    expect(clatterOctant(0, 0, 3)).toBe(3);
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
      if (!dx && !dz) continue;
      const o = clatterOctant(dx, dz, 0);
      const [ox, oz] = CLATTER_DIR8[o];
      // The octant direction never points away from the delta.
      expect(ox * dx + oz * dz).toBeGreaterThan(0);
    }
  });
});

describe('lanes', () => {
  it('has 153 valid centres, home among them', () => {
    expect(gladeTiles.filter(clatterValidCentre)).toHaveLength(153);
    expect(clatterValidCentre(CLATTER_HOME)).toBe(true);
    expect(clatterValidCentre(T(76, 106))).toBe(false); // body leaves the glade
    expect(clatterValidCentre(T(79, 103))).toBe(false); // stone (78,103) in the body
  });

  // An independent statement of the lane rule.
  const bruteValid = (x: number, z: number) => {
    if (x - 1 < G.x0 || x + 1 > G.x1 || z - 1 < G.z0 || z + 1 > G.z1) return false;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (stone(x + a, z + b)) return false;
    return true;
  };
  const bruteLane = (c: Tile, dir: number) => {
    const [dx, dz] = CLATTER_DIR8[dir];
    let L = 0;
    for (let k = 1; k <= CLATTER_MAX_LANE; k++) { if (!bruteValid(c.x + k * dx, c.z + k * dz)) break; L = k; }
    const ex = c.x + L * dx, ez = c.z + L * dz;
    let glance = false;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (stone(ex + dx + a, ez + dz + b)) glance = true;
    const kind = stone(ex + 2 * dx, ez + 2 * dz) ? ClatterEndKind.Flip : glance ? ClatterEndKind.Glance : ClatterEndKind.Skid;
    const tiles: number[] = [];
    for (const t of gladeTiles) {
      if (stone(t.x, t.z)) continue;
      for (let k = 0; k <= L; k++) if (cheb(t, T(c.x + k * dx, c.z + k * dz)) <= 1) { tiles.push(tileKey(t)); break; }
    }
    return { L, end: T(ex, ez), kind, tiles: tiles.sort((p, q) => p - q) };
  };

  it('equals the brute-force lane for every centre and direction', () => {
    for (const c of gladeTiles.filter(clatterValidCentre)) for (let d = 0; d < 8; d++) {
      const l = clatterLane(c, d), b = bruteLane(c, d);
      expect({ len: l.len, end: l.end, kind: l.endKind, tiles: [...l.tiles] }).toEqual({ len: b.L, end: b.end, kind: b.kind, tiles: b.tiles });
      expect(l.dir).toBe(d);
    }
  });

  it('runs 7 tiles to a skid in all 8 directions from home', () => {
    for (let d = 0; d < 8; d++) {
      const l = clatterLane(CLATTER_HOME, d);
      expect(l.len).toBe(7);
      expect(l.endKind).toBe(ClatterEndKind.Skid);
      expect(l.tiles).toHaveLength(d % 2 ? 44 : 30);
    }
  });

  it('pins flip, glance and skid fixtures, and every kind occurs in every direction', () => {
    expect(clatterLane(T(78, 99), 0)).toMatchObject({ len: 2, end: T(78, 101), endKind: ClatterEndKind.Flip }); // stone (78,103)
    expect(clatterLane(T(85, 100), 2)).toMatchObject({ len: 2, end: T(83, 100), endKind: ClatterEndKind.Flip }); // stone (81,100)
    expect(clatterLane(T(83, 102), 7)).toMatchObject({ len: 5, end: T(88, 107), endKind: ClatterEndKind.Flip }); // stone (90,109)
    expect(clatterLane(T(77, 99), 0)).toMatchObject({ len: 2, end: T(77, 101), endKind: ClatterEndKind.Glance });
    expect(clatterLane(T(83, 100), 7)).toMatchObject({ len: 7, end: T(90, 107), endKind: ClatterEndKind.Glance });
    expect(clatterLane(T(77, 99), 7)).toMatchObject({ len: 14, end: T(91, 113), endKind: ClatterEndKind.Skid });
    for (let d = 0; d < 8; d++) {
      const seen = new Set<number>();
      for (const c of gladeTiles.filter(clatterValidCentre)) { const l = clatterLane(c, d); if (l.len >= 2) seen.add(l.endKind); }
      expect([...seen].sort(), `dir ${d}`).toEqual([ClatterEndKind.Skid, ClatterEndKind.Glance, ClatterEndKind.Flip]);
    }
  });

  it('chooses the octant lane, else the longer neighbour (tie clockwise), else null', () => {
    // From home toward the south: the octant lane.
    expect(clatterChooseLane(CLATTER_HOME, T(84, 113), 4)?.dir).toBe(0);
    for (const c of gladeTiles.filter(clatterValidCentre)) for (const t of gladeTiles) {
      const o = clatterOctant(t.x - c.x, t.z - c.z, 2);
      const got = clatterChooseLane(c, t, 2);
      const main = clatterLane(c, o), cw = clatterLane(c, (o + 1) % 8), ccw = clatterLane(c, (o + 7) % 8);
      if (main.len >= 2) expect(got?.dir).toBe(o);
      else if (Math.max(cw.len, ccw.len) < 2) expect(got).toBeNull();
      else expect(got?.dir).toBe(cw.len >= ccw.len ? cw.dir : ccw.dir);
    }
    // The fallback direction is used when the target is on the centre.
    expect(clatterChooseLane(CLATTER_HOME, CLATTER_HOME, 6)?.dir).toBe(6);
  }, 30_000);
});

describe('spin', () => {
  it('hits ring 2 only, clipped to the glade, never a stone', () => {
    const ring = clatterSpinTiles(CLATTER_HOME);
    expect(ring).toHaveLength(16);
    for (const k of ring) expect(cheb(unkey(k), CLATTER_HOME)).toBe(2);
    for (const c of gladeTiles.filter(clatterValidCentre)) {
      const r = clatterSpinTiles(c);
      const brute = gladeTiles.filter((t) => cheb(t, c) === 2 && !stone(t.x, t.z)).map(tileKey).sort((a, b) => a - b);
      expect([...r]).toEqual(brute);
    }
    expect(clatterSpinTiles(T(77, 99)).length).toBeLessThan(16);
  });
});

// ---- the state machine ------------------------------------------------------------

describe('stepClatterhorn: states', () => {
  const far = [cand(84, 113, 0)];

  it('is inert while Closed', () => {
    const r = row({ state: ClatterState.Closed });
    for (const t of [0, 5, 1000, 99999]) expect(stepClatterhorn(r, t, far, cfg)).toEqual({ next: null });
  });

  it('sleeps until a candidate arrives, then wakes with base HP and a new fight number', () => {
    const r = row({ fightCount: 7, defeats: 3, owedLeft: 2, hp: 1, maxHp: 1 });
    expect(stepClatterhorn(r, 500, [], cfg)).toEqual({ next: null });
    const s = stepClatterhorn(r, 500, far, cfg);
    expect(s.woke).toBe(true);
    expect(s.next).toMatchObject({
      state: ClatterState.Idle, hp: 300, maxHp: 300, challengers: 0, phase: 1, engagedTick: 500, lastHitTick: 500,
      fightCount: 8, defeats: 3, owedLeft: 2, stateUntilTick: 0, attackCount: 0,
    });
  });

  it('becomes lonely once, waits 100 ticks, then resets home keeping fight, defeats and owed', () => {
    const r = fight({ x: 80, z: 108, hp: 900, maxHp: 1700, challengers: 10, phase: 2, attackCount: 7, bait: 55, swarmTick: 1200, attack: ClatterAttack.Drum });
    const lonely = stepClatterhorn(r, 2000, [], cfg);
    expect(lonely.next).toMatchObject({ state: ClatterState.Idle, stateUntilTick: 2000 + CLATTER_LONELY_TICKS });
    const l = lonely.next!;
    expect(stepClatterhorn(l, 2001, [], cfg)).toEqual({ next: null });
    expect(stepClatterhorn(l, 2099, [], cfg)).toEqual({ next: null });
    const reset = stepClatterhorn(l, 2100, [], cfg);
    expect(reset.reset).toBe(true);
    expect(reset.next).toMatchObject({
      state: ClatterState.Dormant, x: CLATTER_HOME.x, z: CLATTER_HOME.z, hp: 300, maxHp: 300, challengers: 0, phase: 1,
      attack: ClatterAttack.None, attackCount: 0, chain: 0, bait: 0, swarmTick: 0, stateUntilTick: 0,
      fightCount: 4, defeats: 2, owedLeft: 3,
    });
    // A candidate returning before the reset resumes the fight (frenzy by now: phase 3, action 8 is a drum).
    const back = stepClatterhorn(l, 2050, far, cfg);
    expect(back.next).toMatchObject({ state: ClatterState.DrumWindup, phase: 3, attackCount: 8 });
  });

  it('returns from the burrow after 300 ticks, keeping fight, defeats and owed', () => {
    const r = fight({ state: ClatterState.Burrowed, stateUntilTick: 3000 + CLATTER_RESPAWN_TICKS, hp: 0, maxHp: 1700, challengers: 10, attackCount: 31, chain: 1, bait: 9, swarmTick: 2900 });
    expect(stepClatterhorn(r, 3299, far, cfg)).toEqual({ next: null });
    const s = stepClatterhorn(r, 3300, far, cfg);
    expect(s.returned).toBe(true);
    expect(s.next).toMatchObject({
      state: ClatterState.Dormant, x: 84, z: 106, hp: 300, maxHp: 300, challengers: 0, phase: 1, attackCount: 0, chain: 0,
      bait: 0, swarmTick: 0, fightCount: 4, defeats: 2, owedLeft: 3,
    });
  });

  it('reopens (clatterReturnHome) with base HP and the counters kept', () => {
    const r = fight({ state: ClatterState.Closed, hp: 30, maxHp: 1700, challengers: 10, x: 80, z: 101 });
    expect(clatterReturnHome(r, { ...cfg, clatterHpBase: 400 })).toMatchObject({
      state: ClatterState.Dormant, x: 84, z: 106, hp: 400, maxHp: 400, challengers: 0, fightCount: 4, defeats: 2, owedLeft: 3,
    });
  });

  it('lands a charge on its lane, moves, then recovers 2 ticks (phase 1)', () => {
    const lane = clatterLane(CLATTER_HOME, 0);
    const r = fight({ state: ClatterState.ChargeWindup, attack: ClatterAttack.Charge, dir: 0, endX: lane.end.x, endZ: lane.end.z, endKind: lane.endKind, stateUntilTick: 1104, chain: 0 });
    expect(stepClatterhorn(r, 1103, far, cfg)).toEqual({ next: null });
    const s = stepClatterhorn(r, 1104, far, cfg);
    expect(s.moved).toBe(true);
    expect(s.blow).toEqual({ attack: ClatterAttack.Charge, tiles: new Set(lane.tiles), damage: CLATTER_DAMAGE.charge });
    expect(s.next).toMatchObject({ x: 84, z: 113, state: ClatterState.Recover, stateUntilTick: 1106 });
    expect(stepClatterhorn(s.next!, 1105, far, cfg)).toEqual({ next: null });
  });

  it('flips on a stone for 7, 6, 5 ticks by phase and 4 in frenzy', () => {
    const lane = clatterLane(T(78, 99), 0);
    expect(lane.endKind).toBe(ClatterEndKind.Flip);
    const base = fight({ x: 78, z: 99, state: ClatterState.ChargeWindup, attack: ClatterAttack.Charge, dir: 0, endX: lane.end.x, endZ: lane.end.z, endKind: lane.endKind, stateUntilTick: 1100, chain: 2, hp: 1000, maxHp: 1000 });
    const cases: [Partial<ClatterRowLike>, number, number][] = [
      [{ hp: 1000 }, 1100, CLATTER_FLIP_TICKS[1]], [{ hp: 600 }, 1100, CLATTER_FLIP_TICKS[2]], [{ hp: 300 }, 1100, CLATTER_FLIP_TICKS[3]],
      [{ hp: 1000, stateUntilTick: 1450 }, 1450, CLATTER_FRENZY_FLIP_TICKS],
    ];
    for (const [over, t, ticks] of cases) {
      const s = stepClatterhorn({ ...base, ...over }, t, far, cfg);
      expect(s.flipped).toBe(true);
      expect(s.next).toMatchObject({ state: ClatterState.Flipped, stateUntilTick: t + ticks, chain: 0, x: 78, z: 101 });
    }
    expect([CLATTER_FLIP_TICKS[1], CLATTER_FLIP_TICKS[2], CLATTER_FLIP_TICKS[3], CLATTER_FRENZY_FLIP_TICKS]).toEqual([7, 6, 5, 4]);
  });

  it('spins ring 2 and recovers', () => {
    const r = fight({ state: ClatterState.SpinWindup, attack: ClatterAttack.Spin, stateUntilTick: 1103 });
    expect(stepClatterhorn(r, 1102, far, cfg)).toEqual({ next: null });
    const s = stepClatterhorn(r, 1103, far, cfg);
    expect(s.blow).toEqual({ attack: ClatterAttack.Spin, tiles: new Set(clatterSpinTiles(CLATTER_HOME)), damage: 10 });
    expect(s.next).toMatchObject({ state: ClatterState.Recover, stateUntilTick: 1105, x: 84, z: 106 });
  });

  it('slams (body hit, ring 2 safe) on a seeded share of spins from phase 2, consistently for telegraph, blow and hazard', () => {
    let slams = 0;
    for (let n = 0; n < 200; n++) {
      const spin = { attack: ClatterAttack.Spin, fightCount: 3, attackCount: n };
      expect(clatterSlam({ ...spin, phase: 1 })).toBe(false);
      expect(clatterSlam({ ...spin, attack: ClatterAttack.Charge, phase: 3 })).toBe(false);
      if (!clatterSlam({ ...spin, phase: 2 })) continue;
      slams++;
      const r = fight({ state: ClatterState.SpinWindup, ...spin, phase: 2, stateUntilTick: 1103 });
      const body = clatterSlamTiles(CLATTER_HOME);
      expect(body).toHaveLength(9);
      expect(clatterTelegraph(r)).toMatchObject({ attack: 'slam', tiles: body, damage: CLATTER_DAMAGE.spin });
      expect(stepClatterhorn(r, 1103, far, cfg).blow).toEqual({ attack: ClatterAttack.Spin, tiles: new Set(body), damage: CLATTER_DAMAGE.spin });
      const eye = T(CLATTER_HOME.x + 1, CLATTER_HOME.z), ring = T(CLATTER_HOME.x + 2, CLATTER_HOME.z);
      expect(clatterHitsMove(r, 1103, eye, eye, eye)).toBe(2);
      expect(clatterHitsMove(r, 1103, ring, ring, ring)).toBe(0);
    }
    expect(slams).toBeGreaterThan(70);
    expect(slams).toBeLessThan(130);
  });

  it('drums: fires the swarm at the landing tick, drums 20 ticks, then recovers', () => {
    const r = fight({ state: ClatterState.DrumWindup, attack: ClatterAttack.Drum, stateUntilTick: 1103, swarmSide: 1, swarmFree: 2, swarmTick: 0 });
    expect(stepClatterhorn(r, 1102, far, cfg)).toEqual({ next: null });
    const s = stepClatterhorn(r, 1103, far, cfg);
    expect(s.swarmFired).toBe(true);
    expect(s.blow).toBeUndefined();
    expect(s.next).toMatchObject({ state: ClatterState.Drumming, swarmTick: 1103, stateUntilTick: 1103 + CLATTER_SWARM_TICKS });
    expect(stepClatterhorn(s.next!, 1122, far, cfg)).toEqual({ next: null });
    expect(stepClatterhorn(s.next!, 1123, far, cfg).next).toMatchObject({ state: ClatterState.Recover, stateUntilTick: 1125 });
  });
});

describe('stepClatterhorn: decisions', () => {
  const hpFor = (phase: number) => (phase === 1 ? 1000 : phase === 2 ? 600 : 300);
  const decideAt = (phase: number, n: number, cands: ClatterCandidate[], over: Partial<ClatterRowLike> = {}) =>
    stepClatterhorn(fight({ state: ClatterState.Recover, stateUntilTick: 1100, hp: hpFor(phase), maxHp: 1000, attackCount: n, attack: ClatterAttack.Charge, ...over }), 1100, cands, cfg).next!;
  const hugger = cand(85, 107, 0);
  const runner = cand(84, 113, 1);

  it('spins every third action with a hugger, never twice in a row, and at once with 3+ huggers', () => {
    for (const phase of [1, 2, 3]) for (let n = 0; n < 30; n++) {
      const every = CLATTER_DRUM_EVERY[phase];
      if (every > 0 && n % every === every - 1) continue;
      const s = decideAt(phase, n, [hugger, runner]);
      expect(s.state, `phase ${phase} n ${n}`).toBe(n % 3 === 2 ? ClatterState.SpinWindup : ClatterState.ChargeWindup);
      expect(s.attackCount).toBe(n + 1);
      expect(s.phase).toBe(phase);
      // Nobody near: always a charge.
      expect(decideAt(phase, n, [runner]).state).toBe(ClatterState.ChargeWindup);
      // 3 huggers: spin unless the last action was a spin.
      const crowd = [hugger, cand(83, 105, 2), cand(84, 108, 3), runner];
      expect(decideAt(phase, n, crowd).state).toBe(ClatterState.SpinWindup);
      expect(decideAt(phase, n, crowd, { attack: ClatterAttack.Spin }).state).toBe(ClatterState.ChargeWindup);
    }
  });

  it('drums every 7th action in phase 1, every 5th in phase 2 and every 4th in phase 3', () => {
    for (const phase of [1, 2, 3]) {
      const drums: number[] = [];
      for (let n = 0; n < 30; n++) {
        const s = decideAt(phase, n, [runner], { fightCount: 9 });
        if (s.state !== ClatterState.DrumWindup) continue;
        drums.push(n);
        expect(s).toMatchObject({ stateUntilTick: 1103, attack: ClatterAttack.Drum, swarmSide: mix32(9, n) & 3, swarmFree: mix32(9, n + 7919) % 3 });
      }
      expect(drums, `phase ${phase}`).toEqual(phase === 1 ? [6, 13, 20, 27] : phase === 2 ? [4, 9, 14, 19, 24, 29] : [3, 7, 11, 15, 19, 23, 27]);
    }
  });

  it('winds a charge 3 ticks in every phase, with 1, 2, 3 chained charges', () => {
    for (const phase of [1, 2, 3] as const) {
      const s = decideAt(phase, 0, [runner]);
      expect(s).toMatchObject({ state: ClatterState.ChargeWindup, stateUntilTick: 1100 + CLATTER_CHARGE_WINDUP[phase], chain: CLATTER_CHAIN[phase], dir: 0, bait: runner.key });
    }
    expect([...CLATTER_CHARGE_WINDUP.slice(1)]).toEqual([3, 3, 3]);
    expect([...CLATTER_CHAIN.slice(1)]).toEqual([1, 2, 3]);
  });

  it('chains charges from the landing centre without advancing the rotation', () => {
    // Phase 3, three chained charges: land and re-telegraph three times, then the last landing recovers.
    let r = decideAt(3, 0, [runner, cand(77, 99, 2)]);
    expect(r.chain).toBe(3);
    const count = r.attackCount;
    const landings: number[] = [];
    let t = r.stateUntilTick;
    for (let i = 0; i < 4; i++) {
      const s = stepClatterhorn(r, t, [runner, cand(77, 99, 2)], cfg);
      expect(s.blow?.attack).toBe(ClatterAttack.Charge);
      landings.push(t);
      r = s.next!;
      expect(r.attackCount).toBe(count);
      if (r.state !== ClatterState.ChargeWindup) break;
      expect(r.stateUntilTick - t).toBe(3);
      t = r.stateUntilTick;
    }
    expect(landings).toHaveLength(4);
    expect(r.state).toBe(ClatterState.Recover);
  });

  it('baits the farthest candidate (ties: lower order) and never the previous bait with 2+ candidates', () => {
    const a = cand(84, 113, 1, 11), b = cand(77, 106, 0, 22), c = cand(86, 107, 2, 33);
    // a and b are both 7 away; b has the lower order.
    expect(decideAt(1, 0, [a, b, c]).bait).toBe(22);
    expect(decideAt(1, 0, [a, b, c], { bait: 22 }).bait).toBe(11);
    expect(decideAt(1, 0, [a, b, c], { bait: 11 }).bait).toBe(22);
    // Alone: the same target again.
    expect(decideAt(1, 0, [b], { bait: 22 }).bait).toBe(22);
    // A key collision allows one repeat instead of no target.
    expect(decideAt(1, 0, [cand(84, 113, 0, 5), cand(77, 106, 1, 5)], { bait: 5 }).bait).toBe(5);
  });

  it('spins or shuffles when no lane is long enough', () => {
    // At (78,99) the target far east is behind the stone (81,100): E, SE and NE are all shorter than 2.
    const at = { x: 78, z: 99 };
    expect(clatterChooseLane(at, T(88, 99), 0)).toBeNull();
    const target = cand(88, 99, 0);
    const near = cand(79, 100, 1);
    const spin = decideAt(1, 0, [target], { ...at });
    expect(spin.state).toBe(ClatterState.Recover); // nobody near: a shuffle
    expect(spin.stateUntilTick).toBe(1102);
    expect(spin.attackCount).toBe(1);
    expect(spin.attack).toBe(ClatterAttack.None);
    // With a hugger it spins instead (the farthest candidate is still the bait).
    expect(decideAt(1, 0, [target, near], { ...at }).state).toBe(ClatterState.SpinWindup);
  });
});

// ---- swarm -------------------------------------------------------------------------

/** Runner tiles from the spec table (independent of the packing). */
function specRunners(side: number, free: number, F: number) {
  const out: { F: number; x: number; z: number; dx: number; dz: number; i: number }[] = [];
  for (const [wave, mod] of [[0, (free + 1) % 3], [2, (free + 2) % 3]]) for (let i = 0; i <= 16; i++) {
    if (i % 3 !== mod) continue;
    if (side === 0) out.push({ F: F + wave, x: 76 + i, z: 97, dx: 0, dz: 1, i });
    if (side === 1) out.push({ F: F + wave, x: 93, z: 98 + i, dx: -1, dz: 0, i });
    if (side === 2) out.push({ F: F + wave, x: 92 - i, z: 115, dx: 0, dz: -1, i });
    if (side === 3) out.push({ F: F + wave, x: 75, z: 114 - i, dx: 1, dz: 0, i });
  }
  return out;
}
const runnerAt = (r: { F: number; x: number; z: number; dx: number; dz: number }, h: number): Tile | null =>
  h < 0 || h > 36 ? null : T(r.x + r.dx * ((h + 1) >> 1), r.z + r.dz * ((h + 1) >> 1));
/** The spec's swept rule, glade-clipped, written out from scratch. */
function bruteRunnerHit(rs: ReturnType<typeof specRunners>, t: number, P: Tile[]): 0 | 1 | 2 {
  if (!inG(P[0].x, P[0].z) && !inG(P[2].x, P[2].z)) return 0;
  let best: 0 | 1 | 2 = 0;
  for (const r of rs) for (const k of [1, 2] as const) {
    const h = 2 * (t - r.F) - 2 + k;
    const b1 = runnerAt(r, h), b0 = runnerAt(r, h - 1);
    if (!b1) continue;
    const in1 = inG(b1.x, b1.z), in0 = !!b0 && inG(b0.x, b0.z);
    if (!in1 && !in0) continue;
    const pa = P[k - 1], pb = P[k];
    const hit = (in1 && pb.x === b1.x && pb.z === b1.z) || (!!b0 && Math.abs(pa.x + pb.x - b0.x - b1.x) + Math.abs(pa.z + pb.z - b0.z - b1.z) <= 1);
    if (hit && (best === 0 || k < best)) best = k;
  }
  return best;
}

describe('the swarm', () => {
  const drumming = (side: number, free: number, F = 2000) => fight({ state: ClatterState.Drumming, swarmTick: F, stateUntilTick: F + 20, swarmSide: side, swarmFree: free, hp: 500, maxHp: 1000 });

  it('packs two waves 2 ticks apart from one row outside the glade, as the spec table says', () => {
    for (let side = 0; side < 4; side++) for (let free = 0; free < 3; free++) {
      const b = clatterSwarmBullets(drumming(side, free));
      const spec = specRunners(side, free, 2000);
      expect(b.length / BULLET_STRIDE).toBe(spec.length);
      spec.forEach((r, n) => expect([...b.slice(n * BULLET_STRIDE, n * BULLET_STRIDE + 6)]).toEqual([r.F, r.x, r.z, r.dx, r.dz, 1]));
      expect(new Set(spec.map((r) => r.F))).toEqual(new Set([2000, 2002]));
      for (const r of spec) expect(inG(r.x, r.z)).toBe(false);
      for (const r of spec) expect(inG(r.x + r.dx, r.z + r.dz)).toBe(true);
    }
    expect(clatterSwarmBullets(row())).toHaveLength(0);
  });

  it('never puts a runner on a free line, and the free lines are the never-used columns', () => {
    for (let side = 0; side < 4; side++) for (let free = 0; free < 3; free++) {
      const r = drumming(side, free);
      const lines = clatterSwarmFreeLines(r);
      const axisX = side === 0 || side === 2;
      expect(lines.length).toBe([...Array(17).keys()].filter((i) => i % 3 === free).length);
      for (const s of specRunners(side, free, 2000)) for (let h = 0; h <= 36; h++) {
        const p = runnerAt(s, h)!;
        expect(lines.includes(axisX ? p.x : p.z)).toBe(false);
      }
      for (const v of lines) expect(axisX ? v >= G.x0 && v <= G.x1 : v >= G.z0 && v <= G.z1).toBe(true);
    }
    expect(clatterSwarmFreeLines(drumming(0, 2))).toEqual([78, 81, 84, 87, 90]);
    expect(clatterSwarmFreeLines(row())).toEqual([]);
  });

  it('predicts the runners already while winding up (fire tick = landing tick)', () => {
    const w = fight({ state: ClatterState.DrumWindup, stateUntilTick: 2000, swarmSide: 3, swarmFree: 1, swarmTick: 1500, hp: 500, maxHp: 1000 });
    expect([...clatterSwarmBullets(w)]).toEqual([...clatterSwarmBullets(drumming(3, 1))]);
    expect([...clatterSwarmFreeLines(w)]).toEqual(clatterSwarmFreeLines(drumming(3, 1)));
  });

  it('first touches the glade one tick after firing, and hits a stationary player only in used columns', () => {
    for (let side = 0; side < 4; side++) for (let free = 0; free < 3; free++) {
      const r = drumming(side, free);
      const lines = clatterSwarmFreeLines(r);
      let first = Infinity;
      for (const p of gladeTiles) {
        if (stone(p.x, p.z)) continue;
        let hit = false;
        for (let t = 1995; t <= 2025; t++) if (clatterSwarmHit(r, t, p, p, p)) { hit = true; first = Math.min(first, t); }
        const freeCol = lines.includes(side === 0 || side === 2 ? p.x : p.z);
        expect(hit, `${side}/${free} ${p.x},${p.z}`).toBe(!freeCol);
      }
      expect(first).toBe(2001);
    }
  });

  it('ignores players outside the glade', () => {
    const r = drumming(0, 0);
    // (77,97) is a runner origin just north of the glade: never hit.
    for (let t = 1995; t <= 2025; t++) expect(clatterSwarmHit(r, t, T(77, 97), T(77, 97), T(77, 97))).toBe(0);
  });

  it('equals the brute-force swept rule for every sampled move', () => {
    for (const [side, free] of [[0, 0], [1, 2], [2, 1], [3, 0]]) {
      const r = drumming(side, free);
      const rs = specRunners(side, free, 2000);
      for (let t = 2000; t <= 2022; t += 1) for (const p0 of gladeTiles) {
        if ((p0.x + p0.z + t) % 5) continue; // a deterministic sample keeps this fast
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          const p2 = T(p0.x + dx, p0.z + dz);
          const p1 = Math.max(Math.abs(dx), Math.abs(dz)) === 2 ? T(p0.x + Math.sign(dx), p0.z + Math.sign(dz)) : p2;
          expect(clatterSwarmHit(r, t, p0, p1, p2)).toBe(bruteRunnerHit(rs, t, [p0, p1, p2]));
        }
      }
    }
  }, 30_000);
});

// ---- telegraph and clatterHitsMove ---------------------------------------------------

describe('telegraph', () => {
  it('is null outside windups', () => {
    for (const s of [ClatterState.Dormant, ClatterState.Idle, ClatterState.Drumming, ClatterState.Recover, ClatterState.Flipped, ClatterState.Burrowed, ClatterState.Closed]) {
      expect(clatterTelegraph(fight({ state: s }))).toBeNull();
    }
  });

  it('describes a charge, a spin and a drum', () => {
    const lane = clatterLane(T(83, 102), 7);
    const c = clatterTelegraph(fight({ x: 83, z: 102, state: ClatterState.ChargeWindup, dir: 7, endX: lane.end.x, endZ: lane.end.z, endKind: lane.endKind, stateUntilTick: 1200, bait: 77 }))!;
    expect(c).toEqual({ attack: 'charge', tiles: lane.tiles, landsAtTick: 1200, damage: 14, endKind: ClatterEndKind.Flip, from: T(83, 102), to: T(88, 107), dir: 7, bait: 77 });
    const s = clatterTelegraph(fight({ state: ClatterState.SpinWindup, stateUntilTick: 1200 }))!;
    expect(s).toMatchObject({ attack: 'spin', tiles: clatterSpinTiles(CLATTER_HOME), landsAtTick: 1200, damage: 10 });
    const d = clatterTelegraph(fight({ state: ClatterState.DrumWindup, stateUntilTick: 1200, swarmSide: 0, swarmFree: 2 }))!;
    expect(d.attack).toBe('drum');
    expect(d.landsAtTick).toBe(1201);
    expect(d.damage).toBe(5);
    // Wave A's entry row: columns i % 3 == 0 on the north edge.
    expect(d.tiles).toEqual([0, 3, 6, 9, 12, 15].map((i) => key(76 + i, 98)));
  });
});

/** A deterministic fight simulation: candidates wander, HP drops, every tick stepped. */
function simulate(seed: number, ticks: number) {
  let r = fight({ hp: 2000, maxHp: 2000, engagedTick: 0, lastHitTick: 0, fightCount: seed });
  const players = [0, 1, 2, 3, 4].map((i) => ({ x: 78 + 3 * i, z: 100 + 2 * i, order: i, key: 1000 + i }));
  const log: { t: number; before: ClatterRowLike; after: ClatterRowLike | null; step: ReturnType<typeof stepClatterhorn> }[] = [];
  for (let t = 1; t <= ticks; t++) {
    for (const p of players) {
      const h = mix32(seed * 7919 + p.order, t);
      const nx = p.x + ((h & 3) % 3) - 1, nz = p.z + (((h >>> 2) & 3) % 3) - 1;
      if (inG(nx, nz) && !stone(nx, nz)) { p.x = nx; p.z = nz; }
    }
    if (t % 3 === 0) r = { ...r, hp: Math.max(1, r.hp - (mix32(seed, t) % 9)) };
    const present = players.filter((p) => (mix32(seed + 1, p.order * 1000 + (t >> 6)) & 7) !== 0);
    const before = r;
    const step = stepClatterhorn(r, t, present, cfg);
    if (step.next) r = step.next;
    log.push({ t, before, after: step.next, step });
  }
  return log;
}

describe('fight simulations', () => {
  const runs = [1, 2, 3, 4, 5, 6].map((s) => simulate(s, 900));

  it('reach every phase and attack kind', () => {
    const states = new Set<number>(), phases = new Set<number>();
    for (const log of runs) for (const e of log) if (e.after) { states.add(e.after.state); phases.add(e.after.phase); }
    for (const s of [ClatterState.ChargeWindup, ClatterState.SpinWindup, ClatterState.DrumWindup, ClatterState.Drumming, ClatterState.Recover]) expect(states.has(s), `state ${s}`).toBe(true);
    expect([...phases].sort()).toEqual([1, 2, 3]);
  });

  it('give every attack at least 3 ticks of notice (a drum 4 before first contact)', () => {
    let windups = 0;
    for (const log of runs) for (const e of log) {
      if (!e.after) continue;
      const tg = clatterTelegraph(e.after);
      if (!tg || (clatterTelegraph(e.before) && e.before.stateUntilTick === e.after.stateUntilTick)) continue;
      windups++;
      expect(tg.landsAtTick - e.t).toBeGreaterThanOrEqual(tg.attack === 'drum' ? 4 : 3);
    }
    expect(windups).toBeGreaterThan(100);
  });

  it('land exactly the telegraphed tiles at the telegraphed tick', () => {
    let blows = 0;
    for (const log of runs) for (const e of log) {
      if (!e.step.blow) continue;
      blows++;
      const tg = clatterTelegraph(e.before)!;
      expect(tg.landsAtTick).toBe(e.t);
      expect(new Set(tg.tiles)).toEqual(e.step.blow.tiles);
      expect(e.step.blow.damage).toBe(tg.damage);
    }
    expect(blows).toBeGreaterThan(100);
  });

  it('land no blow while a swarm is live', () => {
    let swarms = 0;
    for (const log of runs) {
      const fires = log.filter((e) => e.step.swarmFired).map((e) => e.t);
      swarms += fires.length;
      for (const e of log) if (e.step.blow) for (const F of fires) expect(e.t > F && e.t <= F + 21, `blow at ${e.t}, swarm ${F}`).toBe(false);
      // Nothing is even decided until the swarm is over.
      for (const F of fires) {
        const during = log.filter((e) => e.t > F && e.t < F + CLATTER_SWARM_TICKS);
        for (const e of during) expect(e.after).toBeNull();
      }
    }
    expect(swarms).toBeGreaterThan(5);
  });

  it('match clatterHitsMove to brute force over ticks +1..+3', () => {
    let checked = 0, hits = 0;
    for (const log of runs.slice(0, 2)) for (const e of log) {
      if (e.t % 5) continue;
      const r = e.after ?? e.before;
      const tg = clatterTelegraph(r);
      const live = r.swarmTick > 0 || r.state === ClatterState.DrumWindup;
      if (!tg && !live) continue;
      const F = r.state === ClatterState.DrumWindup ? r.stateUntilTick : r.swarmTick;
      const rs = specRunners(r.swarmSide, r.swarmFree, F);
      const blowTiles = tg && tg.attack !== 'drum' ? new Set(tg.tiles) : null;
      for (let t = e.t + 1; t <= e.t + 3; t++) for (const p0 of gladeTiles) {
        if ((p0.x * 3 + p0.z + t) % 11) continue;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          const p2 = T(p0.x + dx, p0.z + dz);
          const p1 = Math.max(Math.abs(dx), Math.abs(dz)) === 2 ? T(p0.x + Math.sign(dx), p0.z + Math.sign(dz)) : p2;
          const runner = F > 0 ? bruteRunnerHit(rs, t, [p0, p1, p2]) : 0;
          const blow = blowTiles && r.stateUntilTick === t && blowTiles.has(tileKey(p2)) ? 2 : 0;
          const want = runner === 1 ? 1 : blow || runner;
          const got = clatterHitsMove(r, t, p0, p1, p2);
          expect(got).toBe(want);
          checked++;
          if (got) hits++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
    expect(hits).toBeGreaterThan(500);
  }, 30_000);
});

describe('rewards', () => {
  it('qualifies with 16+ damage in this fight and a swing within 100 ticks', () => {
    expect(clatterQualifies({ damage: 16, fight: 3, lastHitTick: 900 }, 3, 1000)).toBe(true);
    expect(clatterQualifies({ damage: 16, fight: 3, lastHitTick: 899 }, 3, 1000)).toBe(false);
    expect(clatterQualifies({ damage: 15, fight: 3, lastHitTick: 1000 }, 3, 1000)).toBe(false);
    expect(clatterQualifies({ damage: 500, fight: 2, lastHitTick: 1000 }, 3, 1000)).toBe(false);
    const rows = [
      { id: 'a', damage: 16, fight: 3, lastHitTick: 900 }, { id: 'b', damage: 16, fight: 3, lastHitTick: 899 },
      { id: 'c', damage: 40, fight: 3, lastHitTick: 999 }, { id: 'd', damage: 10, fight: 3, lastHitTick: 999 },
    ];
    expect(clatterRewardees(rows, 3, 1000).map((r) => r.id)).toEqual(['a', 'c']);
  });
});
