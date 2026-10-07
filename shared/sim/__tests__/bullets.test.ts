// @ts-ignore: the shared tsconfig has no Node types; vitest runs these tests in Node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLATTER_STONES, SPIRE_FLOOR, spireStandable } from '../bossZones';
import {
  BULLET_LIFE_HALF_STEPS, BULLET_STRIDE, BulletGrid, D16, bulletDangerKeys, bulletStepsAt, bulletTileAt, bulletsHitMove,
  canonicalMiddle, lineOffset, mix32, movesWithin, quarterTurn, sweptHit, turnBy, turnCCW, turnCW,
} from '../bullets';
import { GRID_SIZE } from '../constants';
import { chebyshev, tileKey } from '../grid';
import { TREE_SEEDS } from '../items';
import { NODE_SEEDS } from '../nodes';
import { bfsPath, goalIsTile } from '../pathfinding';
import { worldBlockedSet } from '../social';
import { terrainLand } from '../terrain';
import type { Tile } from '../types';

const blocked = worldBlockedSet([...TREE_SEEDS, ...NODE_SEEDS]);
const T = (x: number, z: number): Tile => ({ x, z });
/** engineering-first's axis formula, the reference the old 3,425-instance validation used. */
const axis = (d: number, h: number) => (d < 0 ? -1 : 1) * Math.floor((Math.abs(d) * h + 1) / 2);
const pack = (rows: number[][]) => Int32Array.from(rows.flat());

describe('kinematics', () => {
  it('lineOffset moves at most one tile per axis per step and lands on (dx, dz) at n = max', () => {
    for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {
      if (!dx && !dz) continue;
      const M = Math.max(Math.abs(dx), Math.abs(dz));
      let prev = lineOffset(dx, dz, 0);
      expect(prev).toEqual([0, 0]);
      for (let n = 1; n <= 20; n++) {
        const cur = lineOffset(dx, dz, n);
        expect(Math.abs(cur[0] - prev[0])).toBeLessThanOrEqual(1);
        expect(Math.abs(cur[1] - prev[1])).toBeLessThanOrEqual(1);
        expect(Math.max(Math.abs(cur[0]), Math.abs(cur[1]))).toBe(n);
        prev = cur;
      }
      expect(lineOffset(dx, dz, M)).toEqual([dx, dz]);
      // Proportional vectors draw identical lines.
      for (let n = 0; n <= 20; n++) expect(lineOffset(3 * dx, 3 * dz, n)).toEqual(lineOffset(dx, dz, n));
    }
    expect(lineOffset(0, 0, 5)).toEqual([0, 0]);
  });

  it('reproduces the axis formula for every D16 direction at both rates', () => {
    expect(D16).toHaveLength(16);
    for (const [dx, dz] of D16) for (const q of [1, 2]) for (let h = 0; h <= BULLET_LIFE_HALF_STEPS; h++) {
      const H = q === 1 ? Math.floor((h + 1) / 2) : h;
      const [ox, oz] = lineOffset(dx, dz, bulletStepsAt(q, h));
      expect([ox, oz]).toEqual([axis(dx, H) + 0, axis(dz, H) + 0]);
    }
  });

  it('counts steps per half-step: q2 one per half-step, q1 one per tick (rounded up)', () => {
    expect([0, 1, 2, 3, 4, 5].map((h) => bulletStepsAt(2, h))).toEqual([0, 1, 2, 3, 4, 5]);
    expect([0, 1, 2, 3, 4, 5].map((h) => bulletStepsAt(1, h))).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it('reads packed bullets without allocating and stays absent outside its life', () => {
    const b = pack([[10, 77, 62, 2, 1, 2], [10, 69, 54, 1, 1, 1]]);
    const out = { x: 0, z: 0 };
    for (let h = 0; h <= BULLET_LIFE_HALF_STEPS; h++) {
      expect(bulletTileAt(b, 0, h, out)).toBe(true);
      const [ox, oz] = lineOffset(2, 1, h);
      expect(out).toEqual({ x: 77 + ox, z: 62 + oz });
    }
    expect(bulletTileAt(b, 1, -1, out)).toBe(false);
    expect(bulletTileAt(b, 1, BULLET_LIFE_HALF_STEPS + 1, out)).toBe(false);
    expect(bulletTileAt(b, 1, 3, out)).toBe(true);
    expect(out).toEqual({ x: 71, z: 56 });
    expect(BULLET_STRIDE).toBe(6);
  });

  it('turns by atan(1/2) and by quarter turns exactly', () => {
    expect(turnCW([1, 0])).toEqual([2, 1]);
    expect(turnCCW([1, 0])).toEqual([2, -1]);
    expect(turnCW([0, 1])).toEqual([-1, 2]);
    expect(turnBy([3, -2], 0)).toEqual([3, -2]);
    expect(turnBy([1, 0], 2)).toEqual([3, 4]);
    expect(turnBy([1, 0], -2)).toEqual([3, -4]);
    // CW then CCW scales by 5 and returns to the same direction.
    expect(turnCCW(turnCW([3, -2]))).toEqual([15, -10]);
    expect(quarterTurn(1, 0, 1)).toEqual([0, 1]);
    expect(quarterTurn(3, -2, 4)).toEqual([3, -2]);
    expect(quarterTurn(3, -2, 2)).toEqual([-3, 2]);
    for (let i = 0; i < 16; i++) {
      const [x, z] = quarterTurn(D16[i][0], D16[i][1], 1);
      expect([x + 0, z + 0]).toEqual([...D16[(i + 4) & 15]]);
    }
  });

  it('pins the mix32 golden values', () => {
    expect(mix32(0, 0)).toBe(0);
    expect(mix32(1, 2)).toBe(2065299320);
    expect(mix32(12345, 67890)).toBe(3380661531);
    expect(mix32(0xffffffff, 7)).toBe(2177923641);
  });
});

describe('the Manhattan swept rule', () => {
  const still = (p: Tile) => [p, p, p] as const;
  const cases: [string, readonly [Tile, Tile, Tile], [Tile | null, Tile | null, Tile | null], boolean][] = [
    ["end on the bullet's tile", still(T(0, 0)), [T(2, 0), T(1, 0), T(0, 0)], true],
    ['head-on swap', [T(0, 0), T(1, 0), T(1, 0)], [T(1, 0), T(0, 0), T(-1, 0)], true],
    ['X-crossing diagonals', [T(0, 0), T(1, 1), T(1, 1)], [T(1, 0), T(0, 1), T(-1, 2)], true],
    ['diagonal slip between two adjacent wall bullets', [T(0, 0), T(1, -1), T(1, -1)], [T(0, -1), T(0, 0), T(0, 0)], true],
    ['sidestep perpendicular as the bullet enters your tile', [T(0, 0), T(0, 1), T(0, 1)], [T(-1, 0), T(0, 0), T(1, 0)], false],
    ["step away along the bullet's path", [T(0, 0), T(1, 0), T(2, 0)], [T(-1, 0), T(0, 0), T(1, 0)], false],
    ['stationary, a diagonal bullet passes your corner', still(T(0, 0)), [T(0, 1), T(1, 0), T(2, -1)], false],
    ['cut a corner past a stationary bullet', [T(0, 0), T(1, 1), T(1, 1)], [T(1, 0), T(1, 0), T(1, 0)], false],
    ['parallel adjacent lanes', [T(0, 0), T(1, 0), T(2, 0)], [T(0, 1), T(1, 1), T(2, 1)], false],
    ['stationary on the tile a bullet leaves cardinally', still(T(0, 0)), [T(0, 0), T(1, 0), T(2, 0)], true],
    ['stationary on the tile a bullet leaves diagonally', still(T(0, 0)), [T(0, 0), T(1, 1), T(2, 2)], false],
  ];
  it.each(cases)('%s', (_name, [p0, p1, p2], [b0, b1, b2], hit) => {
    expect(sweptHit(p0, p1, p2, b0, b1, b2) !== 0).toBe(hit);
  });

  it('also catches the second wall bullet of a diagonal slip (a gapless wall dooms every tile)', () => {
    expect(sweptHit(T(0, 0), T(1, -1), T(1, -1), T(1, -1), T(1, 0), T(1, 0))).toBe(1);
  });

  it('reports the half-step of the hit', () => {
    expect(sweptHit(T(0, 0), T(0, 0), T(0, 0), T(2, 0), T(1, 0), T(0, 0))).toBe(2);
    expect(sweptHit(T(0, 0), T(0, 0), T(0, 0), T(1, 0), T(0, 0), T(-1, 0))).toBe(1);
    expect(sweptHit(T(0, 0), T(0, 0), T(0, 0), null, null, T(0, 0))).toBe(2);
    expect(sweptHit(T(0, 0), T(0, 0), T(0, 0), null, null, null)).toBe(0);
  });

  it('proves the corrected stationary lemma exhaustively', () => {
    // A stationary X is hit by a half-step B -> B' iff X == B' or the doubled midpoints touch,
    // which happens iff X == B', or X == B and the step is cardinal (or no step).
    for (let ex = -1; ex <= 1; ex++) for (let ez = -1; ez <= 1; ez++) {
      const B = T(0, 0), B1 = T(ex, ez);
      for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
        const lhs = (x === B1.x && z === B1.z) || Math.abs(2 * x - B.x - B1.x) + Math.abs(2 * z - B.z - B1.z) <= 1;
        const rhs = (x === B1.x && z === B1.z) || (x === B.x && z === B.z && Math.abs(ex) + Math.abs(ez) <= 1);
        expect(lhs, `${ex},${ez} @ ${x},${z}`).toBe(rhs);
      }
    }
  });
});

/** Deterministic pseudo-random bullets around the Spire box. */
function randomBullets(seed: number, count: number, F0: number): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = mix32(seed, i);
    const [dx, dz] = D16[r & 15];
    out.push(F0 + ((r >>> 4) % 8), 69 + ((r >>> 8) % 17), 54 + ((r >>> 13) % 17), dx, dz, 1 + ((r >>> 18) & 1));
  }
  return Int32Array.from(out);
}

function brute(bullets: Int32Array, tick: number, p0: Tile, p1: Tile, p2: Tile): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0;
  const at = (i: number, h: number) => { const o = { x: 0, z: 0 }; return bulletTileAt(bullets, i, h, o) ? o : null; };
  for (let i = 0; i < bullets.length / BULLET_STRIDE; i++) {
    const h = 2 * (tick - bullets[i * BULLET_STRIDE]) - 2;
    const k = sweptHit(p0, p1, p2, at(i, h), at(i, h + 1), at(i, h + 2));
    if (k && (!best || k < best)) best = k;
  }
  return best;
}

describe('bullet sets', () => {
  const floorTiles: Tile[] = [];
  for (let z = SPIRE_FLOOR.z0; z <= SPIRE_FLOOR.z1; z++) for (let x = SPIRE_FLOOR.x0; x <= SPIRE_FLOOR.x1; x++) if (spireStandable({ x, z })) floorTiles.push({ x, z });

  it('bulletDangerKeys equals the brute-force stationary test', () => {
    for (const seed of [1, 2, 3]) {
      const bullets = randomBullets(seed, 40, 10);
      for (let tick = 9; tick <= 30; tick++) {
        const keys = bulletDangerKeys(bullets, tick, (x, z) => spireStandable({ x, z }));
        const expected = new Set(floorTiles.filter((t) => brute(bullets, tick, t, t, t)).map(tileKey));
        expect([...keys].sort()).toEqual([...expected].sort());
      }
    }
  });

  it('bulletsHitMove and BulletGrid agree with the per-bullet rule for every move', () => {
    const grid = new BulletGrid(69, 54, 17, 17);
    const moves = floorTiles.filter((_, i) => i % 7 === 0).map((t) => [t, movesWithin(t, spireStandable)] as const);
    for (const seed of [11, 12]) {
      const bullets = randomBullets(seed, 60, 20);
      for (let tick = 20; tick <= 34; tick += 2) {
        grid.build(bullets, tick);
        for (const [from, list] of moves) for (const m of list) {
          const want = brute(bullets, tick, from, m.mid, m.end);
          expect(bulletsHitMove(bullets, tick, from, m.mid, m.end)).toBe(want);
          expect(grid.hits(from, m.mid, m.end)).toBe(want);
        }
        for (const t of floorTiles) expect(grid.dangerAt(t.x, t.z)).toBe(brute(bullets, tick, t, t, t) !== 0);
      }
    }
  });

  it('clips bullets to a zone with `only`', () => {
    const b = pack([[5, 10, 10, 0, 2, 2]]);
    const zone = (_x: number, z: number) => z >= 13;
    // Tick 6: the bullet goes 10 -> 11 -> 12 (outside the zone).
    expect(bulletsHitMove(b, 6, T(10, 12), T(10, 12), T(10, 12))).toBe(2);
    expect(bulletsHitMove(b, 6, T(10, 12), T(10, 12), T(10, 12), zone)).toBe(0);
    // Tick 7: 12 -> 13 enters the zone, so leaving a tile at the border still counts.
    expect(bulletsHitMove(b, 7, T(10, 13), T(10, 13), T(10, 13), zone)).toBe(1);
  });
});

describe('moves and canonical middles', () => {
  const floorOk = (t: Tile) => spireStandable(t);
  const landOk = (t: Tile) => terrainLand(t) && !blocked.has(tileKey(t));

  it('offers all 25 moves in the open', () => {
    const list = movesWithin(T(72, 58), floorOk);
    expect(list).toHaveLength(25);
    expect(list[0]).toEqual({ mid: T(72, 58), end: T(72, 58), steps: 0 });
    expect(list.filter((m) => m.steps === 1)).toHaveLength(8);
  });

  it.each([
    ['in the open', T(72, 58), floorOk],
    ['beside the dais', T(75, 62), floorOk],
    ['at the dais corner', T(75, 61), floorOk],
    ['beside a standing stone', T(80, 103), landOk],
    ['between stones', T(79, 102), landOk],
  ] as const)('matches the BFS first step %s', (_name, from, ok) => {
    const list = movesWithin(from, ok);
    for (const m of list) {
      expect(canonicalMiddle(from, m.end, blocked), `${m.end.x},${m.end.z}`).toEqual(m.mid);
      if (m.steps === 2) expect(bfsPath(from, goalIsTile(m.end), blocked)![0]).toEqual(m.mid);
      if (m.steps < 2) expect(m.mid).toEqual(m.end);
      expect(chebyshev(from, m.end)).toBeLessThanOrEqual(2);
    }
    let twoStepOffsets = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === 2) {
      const end = T(from.x + dx, from.z + dz);
      const m = list.find((x) => x.end.x === end.x && x.end.z === end.z);
      if (!m) continue;
      twoStepOffsets++;
      expect(canonicalMiddle(from, end, blocked)).toEqual(bfsPath(from, goalIsTile(end), blocked)![0]);
    }
    expect(twoStepOffsets).toBeGreaterThan(0);
  });

  it('takes the true middle of a diagonal step whose corner is blocked', () => {
    // (75,61) -> (76,60): the dais at (76,61) forbids the diagonal, so the route goes through (75,60).
    expect(canonicalMiddle(T(75, 61), T(76, 60), blocked)).toEqual(T(75, 60));
    expect(canonicalMiddle(T(72, 58), T(73, 59), blocked)).toEqual(T(73, 59));
    expect(canonicalMiddle(T(72, 58), T(72, 58), blocked)).toEqual(T(72, 58));
    expect(canonicalMiddle(T(72, 58), T(80, 58), blocked)).toEqual(T(80, 58));
    expect(CLATTER_STONES.length).toBe(8);
    expect(GRID_SIZE).toBe(128);
  });
});

describe('integer-only sources', () => {
  it.each(['bullets.ts', 'spire.ts', 'clatterhorn.ts'])('%s uses no trigonometry, roots or powers', (file) => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    expect(src).not.toMatch(/Math\.(sin|cos|tan|atan|atan2|hypot|sqrt|pow|exp|log)\b/);
  });
});
