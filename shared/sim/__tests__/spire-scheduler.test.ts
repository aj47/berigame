/**
 * Scheduler chains end to end (FINAL_SPEC 3.7, 3.9, 10.1): the separation contract over a long random-HP chain, the
 * delayed-reactor invariant, no permanent safe spot, and the AFK hit rates of appendix A (proto-final/safespots.mjs
 * and afk.mjs).
 */
import { describe, expect, it } from 'vitest';
import { SPIRE_DAIS, SPIRE_FLOOR, spireStandable } from '../bossZones';
import { mix32 } from '../bullets';
import { chebyshev, tileKey } from '../grid';
import {
  SPIRE_NONE, SPIRE_PATTERNS, SPIRE_SPAWNS, spireDangerTiles, spireFightBullets, spireHitsMove, spireMiddle,
  spireNextPattern, spirePatternBullets, spirePatternDue, spireSafety, spireStars,
} from '../spire';
import type { SpireFightLike, SpireSafety } from '../spire';
import type { Tile } from '../types';

const TILES: Tile[] = [];
for (let z = SPIRE_FLOOR.z0; z <= SPIRE_FLOOR.z1; z++) for (let x = SPIRE_FLOOR.x0; x <= SPIRE_FLOOR.x1; x++) {
  if (spireStandable({ x, z })) TILES.push({ x, z });
}
const DAIS = new Set(SPIRE_DAIS.map(tileKey));

function fight(seed: number, over: Partial<SpireFightLike> = {}): SpireFightLike {
  return {
    hp: 1000, maxHp: 1000, phase: 1, seed, patternCount: 0,
    curKind: SPIRE_NONE, curStart: 0, curSeed: 0, curAimX: 0, curAimZ: 0,
    prevKind: SPIRE_NONE, prevStart: 0, prevSeed: 0, prevAimX: 0, prevAimZ: 0,
    starWave: 0, starMask: 0,
    hitTick0: 0, hitTick1: 0, hitTick2: 0, hitTick3: 0, hits0: 0, hits1: 0, hits2: 0, hits3: 0,
    stars0: 0, stars1: 0, stars2: 0, stars3: 0, dmg0: 0, dmg1: 0, dmg2: 0, dmg3: 0,
    downs0: 0, downs1: 0, downs2: 0, downs3: 0,
    ...over,
  };
}

interface Published { P: number; kind: number; bullets: Int32Array }
const curOf = (f: SpireFightLike): Published => ({
  P: f.curStart, kind: f.curKind, bullets: spirePatternBullets(f.curKind, f.curStart, f.curSeed, f.curAimX, f.curAimZ),
});
const concat = (list: Int32Array[]) => {
  const out = new Int32Array(list.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of list) { out.set(b, o); o += b.length; }
  return out;
};

/** A fixed-phase chain like proto-final's safespots/afk scripts: patterns published while T < ticks. */
function chain(seed: number, phase: 1 | 2 | 3 | 4, ticks: number, aim: Tile): Published[] {
  let f = fight(seed, { phase });
  const out: Published[] = [];
  for (let T = 0; T < ticks; T++) {
    if (spirePatternDue(f, T)) { f = spireNextPattern(f, 0, T, [aim]); out.push(curOf(f)); }
  }
  return out;
}

describe('separation contract over scheduler chains', () => {
  it('never overlaps exact danger windows in a 2,000-tick random-HP chain', () => {
    for (const seed of [1, 2, 3, 4]) {
      const S = 5000, maxHp = 3100;
      let f = fight(seed, { hp: maxHp, maxHp });
      const pats: Published[] = [];
      let lastPhase = 1;
      for (let T = S; T < S + 2000; T++) {
        if (mix32(seed, T) % 3 === 0) f = { ...f, hp: Math.max(0, f.hp - (mix32(T, seed) % 9)) };
        if (!spirePatternDue(f, T)) continue;
        const targets = [0, 1, 2].map((j) => TILES[mix32(T, j) % TILES.length]);
        f = spireNextPattern(f, S, T, targets);
        expect(f.phase).toBeGreaterThanOrEqual(lastPhase);
        lastPhase = f.phase;
        pats.push(curOf(f));
      }
      expect(lastPhase).toBe(4);
      expect(pats.length).toBeGreaterThan(70);
      const windows = pats.map(({ P, kind, bullets }) => {
        let first = Infinity, last = -1;
        for (let T = P; T <= P + 60; T++) if (spireDangerTiles(bullets, T).size) { first = Math.min(first, T); last = T; }
        expect(first, SPIRE_PATTERNS[kind].key).toBeGreaterThanOrEqual(P + 3);
        expect(last, SPIRE_PATTERNS[kind].key).toBeLessThanOrEqual(P + SPIRE_PATTERNS[kind].duration + 2);
        return { first, last };
      });
      for (let i = 1; i < windows.length; i++) expect(windows[i].first).toBeGreaterThan(windows[i - 1].last);
    }
  });
});

describe('delayed reactor', () => {
  it('a reactor that learns each pattern 1 or 2 ticks late always has a survival plan (16 seeds x 4 phases x 240 ticks)', () => {
    let violations = 0, hits = 0, ticks = 0;
    for (const D of [1, 2]) for (const phase of [1, 2, 3, 4] as const) for (let seed = 1; seed <= 16; seed++) {
      const S = 1000;
      let f = fight(seed, { phase });
      let X: Tile = SPIRE_SPAWNS[seed % 4];
      const pats: Published[] = [];
      f = spireNextPattern(f, S, S, [X]);
      pats.push(curOf(f));
      let safety: SpireSafety | null = null, safetyKey = '#';
      for (let T = S; T < S + 240; T++) {
        // End of tick T: the reactor knows the patterns published at or before T - D and picks its move for T + 1.
        const known = pats.filter((p) => p.P <= T - D).slice(-2);
        const key = known.map((p) => p.P).join(',');
        if (key !== safetyKey) { safety = spireSafety(concat(known.map((p) => p.bullets)), T, DAIS); safetyKey = key; }
        if (!safety!.winning(T, X)) { violations++; break; }
        const wave = Math.floor((T - S) / 12);
        const goal = spireStars(seed, wave, 1)[0];
        const moves = safety!.movesFrom(T, X).filter((m) => !m.hit && m.winning);
        let best = moves[0];
        for (const m of moves) if (chebyshev(m.end, goal) < chebyshev(best.end, goal)) best = m;
        // Tick T + 1 against everything actually published.
        const truth = spireFightBullets(f);
        ticks++;
        if (spireHitsMove(truth, T + 1, X, spireMiddle(X, best.end, DAIS), best.end) !== 0) hits++;
        X = best.end;
        if (spirePatternDue(f, T + 1)) { f = spireNextPattern(f, S, T + 1, [X]); pats.push(curOf(f)); }
      }
    }
    expect({ violations, hits }).toEqual({ violations: 0, hits: 0 });
    expect(ticks).toBe(2 * 4 * 16 * 240);
  });
});

describe('no permanent safe spot and AFK pressure (appendix A)', () => {
  it('leaves 0 of 216 tiles never hit while standing still, per phase, 16 seeds x 240 ticks, fans at (-7,-7)', () => {
    const corner = { x: 70, z: 55 };
    for (const phase of [1, 2, 3, 4] as const) {
      const hit = new Set<number>();
      for (let seed = 1; seed <= 16; seed++) {
        const all = concat(chain(seed, phase, 240, corner).map((p) => p.bullets));
        for (let T = 1; T <= 280; T++) for (const k of spireDangerTiles(all, T)) hit.add(k);
      }
      expect(TILES.length - hit.size, `phase ${phase}`).toBe(0);
    }
  });

  it('hits an AFK player 12.3 / 12.6 / 13.3 / 18.6 times per 100 ticks in phases 1-4', () => {
    const rates: string[] = [];
    for (const phase of [1, 2, 3, 4] as const) {
      let hits = 0, ticks = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const X = TILES[(seed * 37) % TILES.length];
        const all = concat(chain(seed, phase, 200, X).map((p) => p.bullets));
        let imm = -1;
        for (let T = 20; T < 200; T++) {
          ticks++;
          if (T > imm && spireHitsMove(all, T, X, X, X) !== 0) { hits++; imm = T + 2; }
        }
      }
      rates.push(((100 * hits) / ticks).toFixed(1));
    }
    expect(rates).toEqual(['12.3', '12.6', '13.3', '18.6']);
  });
});
