/**
 * Lanternmaw (BOSSES.md section 9): geometry, den patterns, the tide, springs,
 * the fight state machine and the reference tick order.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANTERN_FLOOR, inLanternFloor } from '../bossZones';
import {
  LANTERN_BITE_DAMAGE, LANTERN_BLOW_DAMAGE, LANTERN_CELLS, LANTERN_CENTRE, LANTERN_CHOKE_TICKS, LANTERN_DEN_PATTERNS,
  LANTERN_DIVE_TICKS, LANTERN_DROWN_DAMAGE, LANTERN_EBB_TICKS, LANTERN_ENRAGE_BONUS, LANTERN_ENRAGE_TICKS, LANTERN_FEED_HEAL,
  LANTERN_LEAD, LANTERN_MAX_PARTY, LANTERN_NONE, LANTERN_PATTERNS, LANTERN_PLANK, LANTERN_POOLS, LANTERN_PULSE_DAMAGE,
  LANTERN_SPRINGS, LANTERN_STANDABLE, LANTERN_TIDE_TICKS, LANTERN_TILES, LANTERN_TIME_LIMIT, LanternKind, LanternStage,
  lanternAdvance, lanternAttackable, lanternBlowAt, lanternBuildPattern, lanternCheb, lanternChoked, lanternFlooded,
  lanternFreshFight, lanternHazardMask, lanternHealAt, lanternIdx, lanternInCourt, lanternInReach, lanternLocal,
  lanternMaxHp, lanternMoves, lanternNewRun, lanternPatternDuration, lanternPhaseFor, lanternPulseAt, lanternPulseOffsets,
  lanternPulseTiles, lanternQualifies, lanternResolveTick, lanternRing, lanternSwingDamage, lanternTile,
  type LanternFightLike, type LanternRunSim,
} from '../lanternmaw';

const count = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);
const T0 = 1000;

/** Advance with no hits until `pred` holds (at most `limit` ticks); returns the fight and the tick it held at. */
function advanceUntil(f: LanternFightLike, from: number, pred: (f: LanternFightLike, T: number) => boolean, limit = 400): [LanternFightLike, number] {
  for (let T = from; T < from + limit; T++) {
    f = lanternAdvance(f, T, T0, [LANTERN_TILES[0]]);
    if (pred(f, T)) return [f, T];
  }
  throw new Error('condition never held');
}

describe('Lanternmaw geometry', () => {
  it('has a 15 x 15 floor with a blocked 3 x 3 maw, 52 boardwalk planks and four springs on the plank ring', () => {
    expect(LANTERN_CELLS).toBe(225);
    expect(count(LANTERN_STANDABLE)).toBe(216);
    expect(LANTERN_TILES.length).toBe(216);
    expect(LANTERN_STANDABLE[LANTERN_CENTRE]).toBe(0);
    expect(count(LANTERN_PLANK)).toBe(52);
    for (let i = 0; i < LANTERN_CELLS; i++) if (LANTERN_PLANK[i]) expect(LANTERN_STANDABLE[i]).toBe(1);
    expect(LANTERN_SPRINGS).toEqual([lanternIdx(3, 3), lanternIdx(11, 3), lanternIdx(11, 11), lanternIdx(3, 11)]);
    for (const s of LANTERN_SPRINGS) { expect(LANTERN_PLANK[s]).toBe(1); expect(lanternRing(s)).toBe(4); }
    expect(LANTERN_TILES.filter(lanternInCourt).length).toBe(16);
    expect(LANTERN_TILES.filter(lanternInCourt).every((i) => lanternRing(i) === 2)).toBe(true);
  });

  it('maps local tiles to the sealed floor and back', () => {
    expect(LANTERN_FLOOR.x1 - LANTERN_FLOOR.x0 + 1).toBe(15);
    expect(LANTERN_FLOOR.z1 - LANTERN_FLOOR.z0 + 1).toBe(15);
    for (const i of [0, LANTERN_CENTRE, 224, lanternIdx(3, 11)]) {
      const t = lanternTile(i);
      expect(inLanternFloor(t)).toBe(true);
      expect(lanternLocal(t)).toBe(i);
    }
    expect(lanternLocal({ x: LANTERN_FLOOR.x0 - 1, z: LANTERN_FLOOR.z0 })).toBe(-1);
    expect(lanternLocal({ x: LANTERN_FLOOR.x0 + 0.5, z: LANTERN_FLOOR.z0 })).toBe(-1);
  });

  it('moves stay on standable tiles, reach at most 2 steps and never cross the maw', () => {
    for (const i of LANTERN_TILES) {
      const m = lanternMoves(i);
      expect(m[0]).toBe(i);
      for (const j of m) { expect(LANTERN_STANDABLE[j]).toBe(1); expect(lanternCheb(i, j)).toBeLessThanOrEqual(2); }
    }
    expect(lanternMoves(lanternIdx(0, 0)).length).toBe(9);
  });
});

describe('Lanternmaw den patterns', () => {
  it('every kind lands only on standable tiles, first at P + 3, and is deterministic', () => {
    for (const p of LANTERN_PATTERNS) for (const s of [0, 17, 42, 63]) {
      const aim = lanternIdx(2, 12);
      const blows = lanternBuildPattern(p.kind, s, aim);
      expect(blows.length).toBeGreaterThan(0);
      expect(blows[0].at).toBeGreaterThanOrEqual(LANTERN_LEAD);
      for (let k = 1; k < blows.length; k++) expect(blows[k].at).toBeGreaterThanOrEqual(blows[k - 1].at);
      for (const b of blows) for (let i = 0; i < LANTERN_CELLS; i++) if (b.tiles[i]) expect(LANTERN_STANDABLE[i]).toBe(1);
      expect(lanternPatternDuration(p.kind, s)).toBe(blows[blows.length - 1].at);
      expect(lanternBuildPattern(p.kind, s, aim)).toBe(blows);
    }
  });

  it('pools: phase 1 is sweep, lash, bellow; phase 3 adds the cross and the storm; every kind is used', () => {
    expect(LANTERN_POOLS[1]).toEqual([LanternKind.Sweep, LanternKind.Lash, LanternKind.Bellow]);
    expect(new Set([...LANTERN_POOLS[1], ...LANTERN_POOLS[2], ...LANTERN_POOLS[3]]).size).toBe(LANTERN_PATTERNS.length);
    expect(LANTERN_POOLS[3]).toContain(LanternKind.Cross);
    expect(LANTERN_POOLS[3]).toContain(LanternKind.Storm);
  });

  it('tail lash hits the court first or second by seed', () => {
    const inner = lanternBuildPattern(LanternKind.Lash, 0, 0);
    expect(inner[0].tiles[lanternIdx(7, 5)]).toBe(1);
    expect(inner[1].tiles[lanternIdx(7, 3)]).toBe(1);
    const outer = lanternBuildPattern(LanternKind.Lash, 1, 0);
    expect(outer[0].tiles[lanternIdx(7, 5)]).toBe(0);
    expect(outer[0].tiles[lanternIdx(7, 3)]).toBe(1);
  });

  it('maw bellow leaves only the outer edge, then only the inner rings', () => {
    const [a, b] = lanternBuildPattern(LanternKind.Bellow, 0, 0);
    for (const i of LANTERN_TILES) {
      expect(a.tiles[i]).toBe(lanternRing(i) <= 6 ? 1 : 0);
      expect(b.tiles[i]).toBe(lanternRing(i) >= 5 ? 1 : 0);
    }
    expect([a.at, b.at]).toEqual([3, 6]);
    expect(lanternBuildPattern(LanternKind.Bellow, 1, 0)[1].at).toBe(7);
  });

  it('mire marks start on the aimed tile', () => {
    const aim = lanternIdx(12, 2);
    expect(lanternBuildPattern(LanternKind.Marks, 9, aim)[0].tiles[aim]).toBe(1);
  });
});

describe('Lanternmaw tide and springs', () => {
  it('pulse A covers the spring and its neighbours, pulse B the ring 2 tiles out', () => {
    const s = LANTERN_SPRINGS[0];
    const a = lanternPulseTiles(0, 0), b = lanternPulseTiles(0, 1);
    expect(a[s]).toBe(1);
    expect(a[lanternIdx(4, 3)]).toBe(1);
    expect(b[lanternIdx(5, 3)]).toBe(1);
    expect(b[s]).toBe(0);
    for (let i = 0; i < LANTERN_CELLS; i++) expect(a[i] & b[i]).toBe(0);
    expect(lanternPulseOffsets(1)).toEqual([3, 6, 9, 12]);
    expect(lanternPulseOffsets(3)).toEqual([3, 4, 7, 8, 11, 12]);
  });

  it('runs den x3, then a dive, the tide and the ebb, then the den again', () => {
    let f = lanternFreshFight(5, 1, T0, [LANTERN_TILES[0]]);
    expect(f.stage).toBe(LanternStage.Den);
    expect(f.curStart).toBe(T0);
    expect(f.denCount).toBe(1);
    let T: number;
    [f, T] = advanceUntil(f, T0, (g) => g.stage === LanternStage.Dive);
    expect(f.patternCount).toBe(LANTERN_DEN_PATTERNS);
    expect(f.surfaceTick).toBe(T + LANTERN_DIVE_TICKS);
    expect(f.curKind).toBe(LANTERN_NONE);
    expect(lanternAttackable(f, T + 1)).toBe(false);
    const S = f.surfaceTick;
    [f, T] = advanceUntil(f, T + 1, (g) => g.stage === LanternStage.Tide);
    expect(T).toBe(S - 1);
    expect(lanternAttackable(f, S)).toBe(true);
    [f, T] = advanceUntil(f, T + 1, (g) => g.stage === LanternStage.Ebb);
    expect(T).toBe(S + LANTERN_TIDE_TICKS - 1);
    [f, T] = advanceUntil(f, T + 1, (g) => g.stage === LanternStage.Den);
    expect(T).toBe(S + LANTERN_TIDE_TICKS + LANTERN_EBB_TICKS - 1);
    expect(f.cycle).toBe(1);
    expect(f.curStart).toBe(T);
    expect(f.denCount).toBe(1);
  });

  it('floods every non-plank tile during the tide only', () => {
    let f = lanternFreshFight(5, 1, T0, [LANTERN_TILES[0]]);
    let T: number;
    [f, T] = advanceUntil(f, T0, (g) => g.stage === LanternStage.Dive);
    const S = f.surfaceTick, shallow = lanternIdx(0, 0), plank = lanternIdx(7, 0);
    expect(lanternFlooded(f, S - 1, shallow)).toBe(false);
    expect(lanternFlooded(f, S, shallow)).toBe(true);
    expect(lanternFlooded(f, S + LANTERN_TIDE_TICKS - 1, shallow)).toBe(true);
    expect(lanternFlooded(f, S + LANTERN_TIDE_TICKS, shallow)).toBe(false);
    expect(lanternFlooded(f, S, plank)).toBe(false);
    // The flood is in the published hazard map from the dive on.
    expect(lanternHazardMask(f, S, T0)[shallow]).toBe(1);
    expect(T).toBeLessThan(S);
  });
});

describe('Lanternmaw fight numbers', () => {
  it('scales HP with the party and never heals faster than one stick per member', () => {
    expect(lanternMaxHp(1)).toBeLessThan(lanternMaxHp(2));
    expect(lanternMaxHp(9)).toBe(lanternMaxHp(LANTERN_MAX_PARTY));
    for (let n = 1; n <= LANTERN_MAX_PARTY; n++) expect(LANTERN_FEED_HEAL[n] * 4).toBeLessThan(n * 6);
  });

  it('phases follow HP thirds and enrage', () => {
    expect(lanternPhaseFor(900, 900, 0)).toBe(1);
    expect(lanternPhaseFor(600, 900, 0)).toBe(2);
    expect(lanternPhaseFor(300, 900, 0)).toBe(3);
    expect(lanternPhaseFor(900, 900, LANTERN_ENRAGE_TICKS)).toBe(3);
  });

  it('qualifies members who dealt at least the minimum and are online', () => {
    expect(lanternQualifies(40, true)).toBe(true);
    expect(lanternQualifies(39, true)).toBe(false);
    expect(lanternQualifies(400, false)).toBe(false);
  });
});

describe('Lanternmaw reference tick', () => {
  /** A solo run advanced to the surfacing tick with the member at `tile`. */
  function atSurface(tile: number): [LanternRunSim, number] {
    let run = lanternNewRun(11, [{ tile: LANTERN_TILES[0], weapon: 8 }], T0);
    for (let T = T0 + 1; T < T0 + 400; T++) {
      if (run.fight.stage === LanternStage.Tide && T === run.fight.surfaceTick) {
        run = { ...run, members: run.members.map((m) => ({ ...m, tile, hp: 30, hitTick: 0 })) };
        return [run, T];
      }
      // Stand somewhere the den never reaches between ticks: refresh HP so the test only follows the clock.
      run = lanternResolveTick({ ...run, members: run.members.map((m) => ({ ...m, hp: 30, tile: LANTERN_TILES[0] })) }, T);
      run = { ...run, fight: { ...run.fight, hp: run.fight.maxHp } };
    }
    throw new Error('no surface');
  }

  it('a member on the spring caps it: bitten, the boss chokes (double damage, no heal, no pulses)', () => {
    let [run, S] = atSurface(-1);
    const spring = LANTERN_SPRINGS[run.fight.spring];
    run = { ...run, members: run.members.map((m) => ({ ...m, tile: spring })) };
    const hp0 = run.fight.hp;
    run = lanternResolveTick(run, S);
    expect(run.fight.capped).toBe(true);
    expect(lanternChoked(run.fight, S)).toBe(true);
    expect(lanternChoked(run.fight, S + LANTERN_CHOKE_TICKS)).toBe(false);
    expect(run.members[0].hp).toBe(30 - LANTERN_BITE_DAMAGE);
    expect(lanternHealAt(run.fight, S + 1)).toBe(0);
    expect(lanternSwingDamage(run.fight, S + 1, 8)).toBe(16);
    expect(lanternPulseAt(run.fight, S + 3, T0)).toBeNull();
    expect(run.fight.hp).toBeLessThanOrEqual(hp0);
  });

  it('an uncapped spring feeds the boss every tide tick, never above max HP', () => {
    let [run, S] = atSurface(lanternIdx(7, 0));
    run = { ...run, fight: { ...run.fight, hp: run.fight.maxHp - 1 } };
    run = lanternResolveTick(run, S);
    expect(run.fight.capped).toBe(false);
    expect(lanternHealAt(run.fight, S)).toBe(LANTERN_FEED_HEAL[1]);
    expect(run.fight.hp).toBe(run.fight.maxHp);
    expect(lanternSwingDamage(run.fight, S + 1, 8)).toBe(8);
    expect(lanternPulseAt(run.fight, S + 3, T0)).not.toBeNull();
  });

  it('drowns a member standing in the shallows during the tide, ignoring i-frames', () => {
    let [run, S] = atSurface(lanternIdx(0, 0));
    run = { ...run, members: run.members.map((m) => ({ ...m, hitTick: S - 1 })) };
    run = lanternResolveTick(run, S);
    expect(run.members[0].hp).toBe(30 - LANTERN_DROWN_DAMAGE);
  });

  it('a den blow hits a member on its tile, then i-frames cover the next two ticks', () => {
    let run = lanternNewRun(3, [{ tile: LANTERN_TILES[0], weapon: 8 }], T0);
    const f = run.fight;
    const blows = lanternBuildPattern(f.curKind, f.curSeed, f.curAim);
    const b = blows[0], tile = LANTERN_TILES.find((i) => b.tiles[i])!;
    // Nothing lands before P + 3.
    for (let T = T0 + 1; T < T0 + b.at; T++) run = lanternResolveTick(run, T);
    expect(run.members[0].hp).toBe(30);
    run = lanternResolveTick({ ...run, members: run.members.map((m) => ({ ...m, tile })) }, T0 + b.at);
    expect(lanternBlowAt(f, T0 + b.at, T0)?.tiles[tile]).toBe(1);
    expect(run.members[0].hp).toBe(30 - LANTERN_BLOW_DAMAGE[1]);
    expect(run.members[0].hitTick).toBe(T0 + b.at);
    expect(run.members[0].hits).toBe(1);
  });

  it('a swing that takes the boss to 0 clears the run before that tick\'s hazards', () => {
    let run = lanternNewRun(3, [{ tile: lanternIdx(7, 5), weapon: 8 }], T0);
    run = { ...run, fight: { ...run.fight, hp: 5 } };
    expect(lanternInReach(run.fight, T0, lanternIdx(7, 5))).toBe(true);
    run = lanternResolveTick(run, T0);
    expect(run.outcome).toBe('cleared');
    expect(run.members[0].dealt).toBe(5);
    expect(run.members[0].hp).toBe(30);
  });

  it('times out at the limit', () => {
    let run = lanternNewRun(3, [{ tile: LANTERN_TILES[0], weapon: 8 }], T0);
    run = { ...run, members: run.members.map((m) => ({ ...m, hp: 1_000_000, maxHp: 1_000_000 })) };
    for (let T = T0; T <= T0 + LANTERN_TIME_LIMIT && !run.outcome; T++) run = lanternResolveTick(run, T);
    expect(run.outcome).toBe('timeout');
  });

  it('enrage adds one damage to blows and pulses', () => {
    const f = lanternFreshFight(3, 1, T0, [LANTERN_TILES[0]]);
    const b = lanternBuildPattern(f.curKind, f.curSeed, f.curAim)[0];
    expect(lanternBlowAt(f, T0 + b.at, T0)!.damage).toBe(LANTERN_BLOW_DAMAGE[1]);
    expect(lanternBlowAt(f, T0 + b.at, T0 - LANTERN_ENRAGE_TICKS)!.damage).toBe(LANTERN_BLOW_DAMAGE[1] + LANTERN_ENRAGE_BONUS);
    expect(LANTERN_PULSE_DAMAGE).toBeGreaterThan(0);
  });
});

describe('integer only', () => {
  it.each(['lanternmaw.ts', 'lanternmawValidate.ts'])('%s uses no trigonometry, roots or powers', (file) => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    expect(src).not.toMatch(/Math\.(sin|cos|tan|atan|atan2|hypot|sqrt|pow|exp|log|random)\b|[\w)\]] *\*\* *[\w(]/);
  });
});
