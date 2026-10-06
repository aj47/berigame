import { describe, expect, it } from 'vitest';
import { BOSS_CONFIG_DEFAULTS } from '../bossConfig';
import { SPIRE_CENTRE, SPIRE_DAIS, SPIRE_FLOOR, spireStandable } from '../bossZones';
import { BULLET_STRIDE, bulletTileAt, bulletsHitMove, canonicalMiddle, lineOffset, mix32, quarterTurn } from '../bullets';
import { chebyshev, tileKey } from '../grid';
import {
  SPIRE_DEFAULT_AIM, SPIRE_NONE, SPIRE_ORIGINS, SPIRE_PATTERNS, SPIRE_POOLS, SPIRE_STAR_TILES, SpireMemberState, SpireMode,
  inSpireCourt, spireBuildPattern, spireBulletDamage, spireDangerTiles, spireEnraged, spireFightBullets, spireFlawless,
  spireGapStart, spireHitsMove, spireImmune, spireKnownUntil, spireMaxHp, spireMemberBump, spireMiddle, spireNextPattern,
  spirePatternBullets, spirePatternDue, spirePhaseFor, spireQualifies, spireSafety, spireSeed, spireSlot, spireSpin,
  spireStarWave, spireStars, spireSwingDue, withSpireSlot,
} from '../spire';
import type { SpireFightLike, SpireMemberLike } from '../spire';
import type { Tile } from '../types';

const TILES: Tile[] = [];
for (let z = SPIRE_FLOOR.z0; z <= SPIRE_FLOOR.z1; z++) for (let x = SPIRE_FLOOR.x0; x <= SPIRE_FLOOR.x1; x++) {
  if (spireStandable({ x, z })) TILES.push({ x, z });
}
const DAIS = new Set(SPIRE_DAIS.map(tileKey));
const AIM = { x: 72, z: 66 };

function freshFight(over: Partial<SpireFightLike> = {}): SpireFightLike {
  return {
    hp: 1000, maxHp: 1000, phase: 1, seed: 12345, patternCount: 0,
    curKind: SPIRE_NONE, curStart: 0, curSeed: 0, curAimX: 0, curAimZ: 0,
    prevKind: SPIRE_NONE, prevStart: 0, prevSeed: 0, prevAimX: 0, prevAimZ: 0,
    starWave: 0, starMask: 0,
    hitTick0: 0, hitTick1: 0, hitTick2: 0, hitTick3: 0, hits0: 0, hits1: 0, hits2: 0, hits3: 0,
    stars0: 0, stars1: 0, stars2: 0, stars3: 0, dmg0: 0, dmg1: 0, dmg2: 0, dmg3: 0,
    downs0: 0, downs1: 0, downs2: 0, downs3: 0,
    ...over,
  };
}
const member = (over: Partial<SpireMemberLike> = {}): SpireMemberLike => ({
  runId: 1n, slot: 0, state: SpireMemberState.Done, joinedTick: 0, awaySinceTick: 0, awayCount: 0,
  downUntilTick: 0, reviveSinceTick: 0, meals: 0, ...over,
});
const rows = (b: Int32Array) => Array.from({ length: b.length / BULLET_STRIDE }, (_, i) => Array.from(b.subarray(i * BULLET_STRIDE, (i + 1) * BULLET_STRIDE)));

describe('pattern geometry', () => {
  it('has the documented bullet count for every kind', () => {
    // petal 5x16; glint 5x5; tidewall 12+12+16; crosswind 12+12+3; lattice 2x16 + 2x4x7 inward corner rays + 3;
    // drizzle 8x11 + 6; glass 10x12; cage 4x12; maelstrom 12x4 + 5x11; eclipse 12x12 + 12; shardstorm 16x12.
    const want = [80, 25, 40, 27, 91, 94, 120, 48, 103, 156, 192];
    for (const p of SPIRE_PATTERNS) for (const s of [0, 17, 63]) {
      expect(spireBuildPattern(p.kind, 0, s, AIM.x, AIM.z).length / BULLET_STRIDE, p.key).toBe(want[p.kind]);
    }
  });

  it('fires every volley at offset >= 2 and only from the nine origins or the ring just outside the floor', () => {
    for (const p of SPIRE_PATTERNS) for (let s = 0; s < 64; s++) {
      for (const [F, ox, oz] of rows(spireBuildPattern(p.kind, 100, s, AIM.x, AIM.z))) {
        expect(F).toBeGreaterThanOrEqual(102);
        const origin = SPIRE_ORIGINS.some((o) => o.x === ox && o.z === oz);
        const ring = Math.max(Math.abs(ox - SPIRE_CENTRE.x), Math.abs(oz - SPIRE_CENTRE.z)) === 8;
        expect(origin || ring, `${p.key} ${ox},${oz}`).toBe(true);
      }
    }
  });

  it('is absolute: start shifts F only, and the memoized copy equals a fresh build', () => {
    const a = spireBuildPattern(9, 0, 5, AIM.x, AIM.z), b = spirePatternBullets(9, 700, 5, AIM.x, AIM.z);
    expect(b).toBe(spirePatternBullets(9, 700, 5, AIM.x, AIM.z));
    expect(rows(b)).toEqual(rows(a).map(([F, ...r]) => [F + 700, ...r]));
  });

  it('spin turns walls, sheets and maelstrom masks and nothing else', () => {
    // A wall keeps its lane index c and moves to the next side N -> E -> S -> W; a centre ring's directions turn.
    const SIDES = [[0, 1], [-1, 0], [0, -1], [1, 0]];
    const wallOf = ([, ox, oz, dx, dz]: number[]) => {
      const side = SIDES.findIndex(([a, b]) => a === dx && b === dz);
      return { side, lane: side === 0 || side === 2 ? ox - SPIRE_CENTRE.x : oz - SPIRE_CENTRE.z };
    };
    const rotated = [0, 0, 24, 24, 0, 88, 120, 48, 103, 144, 192];
    for (const p of SPIRE_PATTERNS) for (const s of [0, 9, 42]) for (const k of [1, 2, 3]) {
      const base = rows(spireBuildPattern(p.kind, 0, s, AIM.x, AIM.z, 0));
      const spun = rows(spireBuildPattern(p.kind, 0, s, AIM.x, AIM.z, k));
      expect(spun.length).toBe(base.length);
      let turned = 0;
      base.forEach((b, i) => {
        if (spun[i].every((v, j) => v === b[j])) return;
        const [F, ox, oz, dx, dz, q] = b;
        expect(q).toBe(1);
        expect(spun[i][0]).toBe(F);
        if (ox === SPIRE_CENTRE.x && oz === SPIRE_CENTRE.z) {
          expect(spun[i]).toEqual([F, ox, oz, ...quarterTurn(dx, dz, k), 1]);
        } else {
          const w0 = wallOf(b), w1 = wallOf(spun[i]);
          expect(w0.side).toBeGreaterThanOrEqual(0);
          expect(w1).toEqual({ side: (w0.side + k) & 3, lane: w0.lane });
        }
        turned++;
      });
      expect(turned, `${p.key} spin ${k}`).toBe(rotated[p.kind]);
    }
  });

  it('uses spireSpin(seed6) = mix32(seed6, 81) & 3 by default and every spin occurs', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 64; s++) {
      expect(spireSpin(s)).toBe(mix32(s, 81) & 3);
      seen.add(spireSpin(s));
      expect(spireBuildPattern(10, 0, s, AIM.x, AIM.z)).toEqual(spireBuildPattern(10, 0, s, AIM.x, AIM.z, spireSpin(s)));
    }
    expect(seen.size).toBe(4);
  });

  it('aims the centre ray of every fan through the aim tile, for all 216 aims', () => {
    for (const aim of TILES) {
      const glint = rows(spireBuildPattern(1, 0, 0, aim.x, aim.z));
      for (let v = 0; v < 5; v++) {
        const [, ox, oz, dx, dz, q] = glint[v * 5 + 2];
        expect([ox, oz, q]).toEqual([SPIRE_CENTRE.x, SPIRE_CENTRE.z, 2]);
        const n = Math.max(Math.abs(aim.x - ox), Math.abs(aim.z - oz));
        expect(lineOffset(dx, dz, n), `${aim.x},${aim.z}`).toEqual([aim.x - ox, aim.z - oz]);
      }
    }
  });

  it('falls back to the default aim when the aim is the centre', () => {
    expect(spireBuildPattern(1, 0, 0, SPIRE_CENTRE.x, SPIRE_CENTRE.z)).toEqual(spireBuildPattern(1, 0, 0, SPIRE_DEFAULT_AIM.x, SPIRE_DEFAULT_AIM.z));
  });

  it('gives no bullets for an unknown kind', () => {
    expect(spireBuildPattern(SPIRE_NONE, 0, 0, AIM.x, AIM.z).length).toBe(0);
  });

  it('keeps spireGapStart in -7 .. 8 - w and covers every lane', () => {
    for (const w of [3, 4]) {
      const seen = new Set<number>();
      for (let x = 0; x < 2000; x++) {
        const g = spireGapStart(mix32(x, 7), w);
        expect(g).toBeGreaterThanOrEqual(-7);
        expect(g).toBeLessThanOrEqual(8 - w);
        seen.add(g);
      }
      expect(seen.size).toBe(16 - w);
    }
    expect(spireGapStart(0, 3)).toBe(-7);
    expect(spireGapStart(12, 3)).toBe(5);
    expect(spireGapStart(13, 3)).toBe(-7);
  });

  it('leaves a w-wide gap in every wall row of a sheet that drifts at most one lane per row', () => {
    for (let s = 0; s < 64; s++) {
      const b = rows(spireBuildPattern(6, 0, s, AIM.x, AIM.z, 0));
      let prevGap: number | null = null;
      for (let r = 0; r < 10; r++) {
        const lanes = b.filter(([F]) => F === 2 + r).map(([, ox]) => ox - SPIRE_CENTRE.x);
        expect(lanes.length).toBe(12);
        const gap = [...Array(15).keys()].map((i) => i - 7).filter((c) => !lanes.includes(c));
        expect(gap.length).toBe(3);
        expect(gap[2] - gap[0]).toBe(2);
        if (prevGap !== null) expect(Math.abs(gap[0] - prevGap)).toBeLessThanOrEqual(1);
        prevGap = gap[0];
      }
    }
  });
});

describe('collision wrappers', () => {
  it('spireHitsMove is bulletsHitMove and spireMiddle is canonicalMiddle', () => {
    const b = spireBuildPattern(0, 0, 0, AIM.x, AIM.z);
    for (let T = 1; T < 22; T++) for (const t of TILES.slice(0, 60)) {
      const e = { x: Math.min(84, t.x + 1), z: t.z };
      if (!spireStandable(e)) continue;
      expect(spireHitsMove(b, T, t, e, e)).toBe(bulletsHitMove(b, T, t, e, e));
    }
    expect(spireMiddle({ x: 75, z: 61 }, { x: 75, z: 63 }, DAIS)).toEqual(canonicalMiddle({ x: 75, z: 61 }, { x: 75, z: 63 }, DAIS));
  });

  it('spireDangerTiles is the exact stationary danger on standable tiles (brute force)', () => {
    for (const kind of [0, 4, 8, 10]) {
      const b = spireBuildPattern(kind, 0, 7, AIM.x, AIM.z);
      for (let T = 0; T < 40; T++) {
        const want = new Set(TILES.filter((t) => spireHitsMove(b, T, t, t, t) !== 0).map(tileKey));
        expect(spireDangerTiles(b, T)).toEqual(want);
      }
    }
  });

  it('spireFightBullets is prev then cur, memoized, and only cur when there is no prev', () => {
    const f = freshFight({ curKind: 2, curStart: 40, curSeed: 3, curAimX: 72, curAimZ: 66, prevKind: 1, prevStart: 28, prevSeed: 9, prevAimX: 80, prevAimZ: 60 });
    const b = spireFightBullets(f);
    expect(b).toBe(spireFightBullets({ ...f }));
    const prev = spirePatternBullets(1, 28, 9, 80, 60), cur = spirePatternBullets(2, 40, 3, 72, 66);
    expect(Array.from(b)).toEqual([...prev, ...cur]);
    expect(Array.from(spireFightBullets({ ...f, prevKind: SPIRE_NONE }))).toEqual([...cur]);
    expect(spireFightBullets(freshFight()).length).toBe(0);
  });
});

describe('phases, damage, HP and seeds', () => {
  it('enters phases at 70 / 40 / 15 percent and at the enrage', () => {
    expect(spirePhaseFor(1000, 1000, 0)).toBe(1);
    expect(spirePhaseFor(701, 1000, 0)).toBe(1);
    expect(spirePhaseFor(700, 1000, 0)).toBe(2);
    expect(spirePhaseFor(401, 1000, 0)).toBe(2);
    expect(spirePhaseFor(400, 1000, 0)).toBe(3);
    expect(spirePhaseFor(151, 1000, 0)).toBe(3);
    expect(spirePhaseFor(150, 1000, 0)).toBe(4);
    expect(spirePhaseFor(0, 1000, 0)).toBe(4);
    expect(spirePhaseFor(1000, 1000, 419)).toBe(1);
    expect(spirePhaseFor(1000, 1000, 420)).toBe(4);
    expect(spirePhaseFor(2170, 3100, 0)).toBe(2);
  });

  it('enrages at 420 ticks and adds one bullet damage', () => {
    expect(spireEnraged(100, 519)).toBe(false);
    expect(spireEnraged(100, 520)).toBe(true);
    expect([1, 2, 3, 4].map((p) => spireBulletDamage(p, false))).toEqual([3, 3, 4, 5]);
    expect([1, 2, 3, 4].map((p) => spireBulletDamage(p, true))).toEqual([4, 4, 5, 6]);
    expect(spireBulletDamage(0, false)).toBe(3);
    expect(spireBulletDamage(9, false)).toBe(5);
  });

  it('scales max HP per member', () => {
    expect([1, 2, 3, 4].map((n) => spireMaxHp(BOSS_CONFIG_DEFAULTS, n))).toEqual([1000, 1700, 2400, 3100]);
    expect(spireMaxHp({ ...BOSS_CONFIG_DEFAULTS, spireHpBase: 500, spireHpPerMember: 100 }, 3)).toBe(700);
  });

  it('derives the run seed from the low 32 bits of the run id and the start tick', () => {
    expect(spireSeed(5n, 1000)).toBe(mix32(5, 1000));
    expect(spireSeed(5n + (1n << 32n), 1000)).toBe(mix32(5, 1000));
    expect(spireSeed(5n, 1001)).not.toBe(spireSeed(5n, 1000));
  });
});

describe('scheduler', () => {
  const S = 1000;
  const targets = [{ x: 72, z: 68 }, { x: 75, z: 68 }, { x: 79, z: 68 }];

  it('publishes the first pattern from the phase 1 pool with prev = none', () => {
    const f = spireNextPattern(freshFight(), S, S, targets);
    expect(SPIRE_POOLS[1]).toContain(f.curKind);
    expect(f).toMatchObject({ patternCount: 1, curStart: S, prevKind: SPIRE_NONE, phase: 1, curSeed: mix32(12345, 3) & 63 });
    expect({ x: f.curAimX, z: f.curAimZ }).toEqual(targets[1]);
  });

  it('is not due before curStart + duration, and due at it', () => {
    const f = spireNextPattern(freshFight(), S, S, targets);
    const D = SPIRE_PATTERNS[f.curKind].duration;
    expect(spirePatternDue(freshFight(), 0)).toBe(true);
    expect(spirePatternDue(f, S + D - 1)).toBe(false);
    expect(spirePatternDue(f, S + D)).toBe(true);
    expect(spireKnownUntil(f)).toBe(S + D + 2);
    expect(spireKnownUntil(freshFight({ curStart: 7 }))).toBe(7);
  });

  it('shifts cur into prev, draws from the phase pool, never repeats, rotates targets by slot, never lowers the phase', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let f = freshFight({ seed, maxHp: 2400, hp: 2400 });
      let T = S;
      for (let n = 0; n < 60; n++) {
        const hp = Math.max(0, f.hp - (mix32(seed, n) % 120));
        const before = { ...f, hp };
        const next = spireNextPattern(before, S, T, targets);
        const want = Math.max(before.phase, spirePhaseFor(hp, 2400, T - S));
        expect(next.phase).toBe(want);
        expect(next.phase).toBeGreaterThanOrEqual(before.phase);
        expect(SPIRE_POOLS[want as 1 | 2 | 3 | 4]).toContain(next.curKind);
        expect(next.curKind).not.toBe(before.curKind);
        expect([next.prevKind, next.prevStart, next.prevSeed, next.prevAimX, next.prevAimZ])
          .toEqual([before.curKind, before.curStart, before.curSeed, before.curAimX, before.curAimZ]);
        const k = before.patternCount + 1;
        expect(next.patternCount).toBe(k);
        expect({ x: next.curAimX, z: next.curAimZ }).toEqual(targets[k % targets.length]);
        expect(next.curSeed).toBe(mix32(seed, 2 * k + 1) & 63);
        f = next;
        T += SPIRE_PATTERNS[f.curKind].duration;
      }
    }
  });

  it('moves to phase 4 at the enrage even at full HP and aims at the default tile without targets', () => {
    const f = spireNextPattern(freshFight({ curKind: 0 }), S, S + 420, []);
    expect(f.phase).toBe(4);
    expect(SPIRE_POOLS[4]).toContain(f.curKind);
    expect({ x: f.curAimX, z: f.curAimZ }).toEqual(SPIRE_DEFAULT_AIM);
    const g = spireNextPattern(freshFight({ curKind: 0 }), S, S + 419, []);
    expect(g.phase).toBe(1);
  });

  it('keeps every other field of the row', () => {
    const f = freshFight({ hits2: 7, dmg1: 99, starMask: 5 });
    const n = spireNextPattern(f, S, S, targets);
    expect([n.hits2, n.dmg1, n.starMask, n.hp, n.maxHp, n.seed]).toEqual([7, 99, 5, f.hp, f.maxHp, f.seed]);
  });
});

describe('stars, swings, court, immunity', () => {
  it('has 200 star tiles in the band 3..7 in row order', () => {
    expect(SPIRE_STAR_TILES.length).toBe(200);
    for (const t of SPIRE_STAR_TILES) expect(chebyshev(t, SPIRE_CENTRE)).toBeGreaterThanOrEqual(3);
    const keys = SPIRE_STAR_TILES.map((t) => t.z * 1000 + t.x);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
  });

  it('places K stars on star tiles, deterministically, at least 3 apart unless all 8 tries failed', () => {
    for (let seed = 1; seed <= 60; seed++) for (let w = 0; w < 8; w++) for (let K = 3; K <= 6; K++) {
      const st = spireStars(seed, w, K);
      expect(st).toEqual(spireStars(seed, w, K));
      expect(st.length).toBe(K);
      st.forEach((t, j) => {
        expect(SPIRE_STAR_TILES.some((s) => s.x === t.x && s.z === t.z)).toBe(true);
        const before = st.slice(0, j);
        if (before.every((o) => chebyshev(o, t) >= 3)) return;
        for (let a = 0; a < 8; a++) {
          const c = SPIRE_STAR_TILES[mix32(mix32(seed, 0x57a7), w * 64 + j * 8 + a) % 200];
          expect(before.some((o) => chebyshev(o, c) < 3)).toBe(true);
        }
      });
    }
  });

  it('spaces stars at least 3 apart in nearly every wave', () => {
    let ok = 0, n = 0;
    for (let seed = 1; seed <= 200; seed++) for (let K = 3; K <= 6; K++) {
      const st = spireStars(seed, 0, K);
      n++;
      if (st.every((a, i) => st.every((b, j) => i === j || chebyshev(a, b) >= 3))) ok++;
    }
    expect(ok / n).toBeGreaterThan(0.99);
  });

  it('changes stars between waves and seeds', () => {
    expect(spireStars(1, 0, 4)).not.toEqual(spireStars(1, 1, 4));
    expect(spireStars(1, 0, 4)).not.toEqual(spireStars(2, 0, 4));
  });

  it('counts star waves from the start', () => {
    expect(spireStarWave(100, 99)).toBe(-1);
    expect(spireStarWave(100, 100)).toBe(0);
    expect(spireStarWave(100, 111)).toBe(0);
    expect(spireStarWave(100, 112)).toBe(1);
  });

  it('swings slot s on ticks (T - start) mod 4 == s', () => {
    expect(spireSwingDue(100, 99, 3)).toBe(false);
    for (let T = 100; T < 120; T++) for (let s = 0; s < 4; s++) expect(spireSwingDue(100, T, s)).toBe((T - 100) % 4 === s);
  });

  it('has a 72-tile court', () => {
    expect(TILES.filter(inSpireCourt).length).toBe(72);
    expect(inSpireCourt(SPIRE_CENTRE)).toBe(false);
    expect(inSpireCourt({ x: 81, z: 66 })).toBe(true);
    expect(inSpireCourt({ x: 82, z: 66 })).toBe(false);
  });

  it('grants 2 ticks of immunity after a hit', () => {
    expect(spireImmune(0, 1)).toBe(false);
    expect(spireImmune(50, 50)).toBe(true);
    expect(spireImmune(50, 52)).toBe(true);
    expect(spireImmune(50, 53)).toBe(false);
  });
});

describe('rewards', () => {
  it('qualifies Done or Out members with 3 stars, online, normal mode', () => {
    expect(spireQualifies(3, SpireMemberState.Done, true, SpireMode.Normal)).toBe(true);
    expect(spireQualifies(3, SpireMemberState.Out, true, SpireMode.Normal)).toBe(true);
    expect(spireQualifies(2, SpireMemberState.Done, true, SpireMode.Normal)).toBe(false);
    expect(spireQualifies(9, SpireMemberState.Done, false, SpireMode.Normal)).toBe(false);
    expect(spireQualifies(9, SpireMemberState.Done, true, SpireMode.Practice)).toBe(false);
    for (const s of [SpireMemberState.Lobby, SpireMemberState.In, SpireMemberState.Downed, SpireMemberState.Left]) {
      expect(spireQualifies(9, s, true, SpireMode.Normal)).toBe(false);
    }
  });

  it('is flawless only when Done, never hit, never downed and never away', () => {
    const f = freshFight({ hits1: 0, hits2: 1, downs3: 1 });
    expect(spireFlawless(f, 1, member())).toBe(true);
    expect(spireFlawless(f, 2, member())).toBe(false);
    expect(spireFlawless(f, 3, member())).toBe(false);
    expect(spireFlawless(f, 1, member({ awayCount: 1 }))).toBe(false);
    expect(spireFlawless(f, 1, member({ state: SpireMemberState.Out }))).toBe(false);
    expect(spireFlawless(f, 7, member())).toBe(false);
  });
});

describe('slot helpers', () => {
  it('reads and writes per-slot columns as copies', () => {
    const f = freshFight({ dmg2: 40 });
    expect(spireSlot(f, 'dmg', 2)).toBe(40);
    const g = withSpireSlot(f, 'dmg', 2, 55);
    expect(g.dmg2).toBe(55);
    expect(f.dmg2).toBe(40);
    expect(withSpireSlot(f, 'hitTick', 3, 1234).hitTick3).toBe(1234);
    expect(spireSlot(f, 'hits', 4)).toBe(0);
    expect(withSpireSlot(f, 'hits', 4, 9)).toEqual(f);
  });

  it('saturates u8 fields at 255 and clamps every value at 0', () => {
    const f = freshFight();
    expect(withSpireSlot(f, 'hits', 0, 300).hits0).toBe(255);
    expect(withSpireSlot(f, 'stars', 1, 256).stars1).toBe(255);
    expect(withSpireSlot(f, 'downs', 2, 999).downs2).toBe(255);
    expect(withSpireSlot(f, 'dmg', 3, 300).dmg3).toBe(300);
    expect(withSpireSlot(f, 'dmg', 3, -5).dmg3).toBe(0);
    expect(withSpireSlot(f, 'hits', 0, -1).hits0).toBe(0);
  });

  it('bumps member counters with saturation', () => {
    const m = member({ awayCount: 254, meals: 2 });
    expect(spireMemberBump(m, 'awayCount').awayCount).toBe(255);
    expect(spireMemberBump(spireMemberBump(m, 'awayCount'), 'awayCount').awayCount).toBe(255);
    expect(spireMemberBump(m, 'meals').meals).toBe(3);
    expect(m.meals).toBe(2);
  });
});

describe('spireSafety', () => {
  it('matches brute-force backward induction and its paths replay hit-free through spireHitsMove', () => {
    for (const [kind, seed] of [[6, 3], [7, 11], [10, 40], [3, 5], [8, 21]]) {
      const P = 500;
      const b = spireBuildPattern(kind, P, seed, AIM.x, AIM.z);
      const s = spireSafety(b, P + 2, DAIS);
      expect(s.from).toBe(P + 2);
      expect(s.lastDanger).toBeLessThanOrEqual(P + SPIRE_PATTERNS[kind].duration + 2);
      // brute force over every tile and move for the last few ticks
      const win = new Map<number, Set<number>>();
      win.set(s.lastDanger, new Set(TILES.map(tileKey)));
      for (let T = s.lastDanger - 1; T >= P + 2; T--) {
        const nxt = win.get(T + 1)!, cur = new Set<number>();
        for (const t of TILES) for (const m of s.movesFrom(T, t)) {
          const mid = canonicalMiddle(t, m.end, DAIS);
          expect(mid).toEqual(m.mid);
          if (nxt.has(tileKey(m.end)) && spireHitsMove(b, T + 1, t, mid, m.end) === 0) { cur.add(tileKey(t)); break; }
        }
        win.set(T, cur);
        for (const t of TILES) expect(s.winning(T, t)).toBe(cur.has(tileKey(t)));
      }
      // fair start: every tile is winning at P + 2
      for (const t of TILES) expect(s.winning(P + 2, t)).toBe(true);
      for (const start of [TILES[0], TILES[100], TILES[215], { x: 75, z: 64 }]) {
        const path = s.path(start, P + 2, 40);
        expect(path.length).toBe(40);
        let at = start;
        path.forEach((end, i) => {
          const T = P + 3 + i;
          expect(chebyshev(at, end)).toBeLessThanOrEqual(2);
          expect(spireHitsMove(b, T, at, spireMiddle(at, end, DAIS), end), `${kind}/${seed} tick ${T}`).toBe(0);
          at = end;
        });
      }
    }
  });

  it('follows a preference among winning moves', () => {
    const b = spireBuildPattern(0, 0, 0, AIM.x, AIM.z);
    const s = spireSafety(b, 0, DAIS);
    const goal = { x: 83, z: 66 };
    const path = s.path({ x: 71, z: 68 }, 0, 30, (t) => Math.abs(t.x - goal.x) + Math.abs(t.z - goal.z));
    expect(path[path.length - 1]).toEqual(goal);
  });

  it('reports no moves off the floor and is winning everywhere after the last danger', () => {
    const b = spireBuildPattern(2, 0, 0, AIM.x, AIM.z);
    const s = spireSafety(b, 0, DAIS);
    expect(s.movesFrom(5, SPIRE_CENTRE)).toEqual([]);
    expect(s.winning(5, { x: 60, z: 60 })).toBe(false);
    for (const t of TILES) expect(s.winning(s.lastDanger + 3, t)).toBe(true);
    expect(s.movesFrom(5, { x: 72, z: 66 }).length).toBe(25);
  });
});
