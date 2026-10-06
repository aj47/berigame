/**
 * Shared bullet kinematics and the swept collision rule (FINAL_SPEC 3.5, 3.6):
 * integer only, identical on the server, the browser and the agent gateway.
 * Used by the Sunken Spire's patterns and Clatterhorn's beetling swarm.
 *
 * Only + - * Math.floor Math.abs Math.sign Math.max Math.min Math.imul and >>>
 * appear here (a source test bans trigonometry and roots).
 *
 * A bullet is packed as 6 Int32 values [F, ox, oz, dx, dz, q]: fire tick F,
 * origin (ox, oz) in absolute tiles, direction (dx, dz) and rate q (1 or 2
 * tiles per tick). Half-step h = 0 is the end of tick F; in tick T the samples
 * are B_k = tile(2(T - F) - 2 + k) for k = 0, 1, 2 (start, middle, end).
 */
import { GRID_SIZE } from './constants';
import { chebyshev } from './grid';
import { bfsPath, goalIsTile } from './pathfinding';
import type { Tile } from './types';

export type Vec = readonly [number, number];

/** 16 directions, index 0 = east, increasing clockwise as seen from above (+z is south). */
export const D16: readonly Vec[] = [
  [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [-1, 2], [-2, 2], [-2, 1],
  [-2, 0], [-2, -1], [-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2], [2, -1],
];
/** A bullet exists for 0 <= h <= 36 half-steps (18 ticks). */
export const BULLET_LIFE_HALF_STEPS = 36;
/** Packed bullets: Int32Array of [F, ox, oz, dx, dz, q] per bullet (absolute tiles). */
export const BULLET_STRIDE = 6;

/** 32-bit integer hash (shared seed mixing: run seeds, pattern seeds, spin, stars, swarms). */
export function mix32(a: number, b: number): number {
  let t = (a + Math.imul(b, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/**
 * Rounded integer point after `n` Chebyshev steps along (dx, dz). Depends only
 * on the ratio dx:dz, and each coordinate changes by 0 or 1 per step.
 */
export function lineOffset(dx: number, dz: number, n: number): [number, number] {
  const ax = Math.abs(dx), az = Math.abs(dz), M = Math.max(ax, az);
  if (M === 0) return [0, 0];
  const ox = ax === M ? n : Math.floor((2 * n * ax + M) / (2 * M));
  const oz = az === M ? n : Math.floor((2 * n * az + M) / (2 * M));
  // + 0 turns -0 into 0, so offsets compare equal however they were reached.
  return [Math.sign(dx) * ox + 0, Math.sign(dz) * oz + 0];
}

/** Chebyshev steps taken after h half-steps at q tiles per tick. */
export function bulletStepsAt(q: number, h: number): number {
  return q === 2 ? h : (h + 1) >> 1;
}

/** Tile of bullet i after h half-steps (h = 0 is the end of tick F); false when absent. Allocation-free. */
export function bulletTileAt(b: Int32Array, i: number, h: number, out: { x: number; z: number }): boolean {
  if (h < 0 || h > BULLET_LIFE_HALF_STEPS) return false;
  const o = i * BULLET_STRIDE;
  const dx = b[o + 3], dz = b[o + 4];
  const n = bulletStepsAt(b[o + 5], h);
  const ax = Math.abs(dx), az = Math.abs(dz), M = Math.max(ax, az);
  if (M === 0) { out.x = b[o + 1]; out.z = b[o + 2]; return true; }
  const ox = ax === M ? n : Math.floor((2 * n * ax + M) / (2 * M));
  const oz = az === M ? n : Math.floor((2 * n * az + M) / (2 * M));
  out.x = b[o + 1] + Math.sign(dx) * ox;
  out.z = b[o + 2] + Math.sign(dz) * oz;
  return true;
}

/** Rotate by atan(1/2) (about 26.57 degrees) clockwise on screen. */
export function turnCW(v: Vec): [number, number] {
  return [2 * v[0] - v[1], 2 * v[1] + v[0]];
}

/** Rotate by atan(1/2) counter-clockwise on screen. */
export function turnCCW(v: Vec): [number, number] {
  return [2 * v[0] + v[1], 2 * v[1] - v[0]];
}

/** `turnCW` s times for s > 0, `turnCCW` -s times for s < 0. */
export function turnBy(v: Vec, s: number): [number, number] {
  let w: [number, number] = [v[0], v[1]];
  for (let i = 0; i < s; i++) w = turnCW(w);
  for (let i = 0; i < -s; i++) w = turnCCW(w);
  return w;
}

/** k quarter turns clockwise on screen of a relative point: (u, v) -> (-v, u). */
export function quarterTurn(u: number, v: number, k: number): [number, number] {
  let a = u, b = v;
  for (let i = 0; i < (k & 3); i++) { const t = a; a = 0 - b; b = t; }
  return [a, b];
}

const same = (a: Tile, b: Tile) => a.x === b.x && a.z === b.z;
const touches = (pa: Tile, pb: Tile, ba: Tile, bb: Tile) =>
  Math.abs(pa.x + pb.x - ba.x - bb.x) + Math.abs(pa.z + pb.z - ba.z - bb.z) <= 1;

/**
 * The Manhattan swept rule for one bullet in one tick: 0 = miss, else the
 * half-step (1 or 2) of the hit. HIT in half-step k iff P_k == B_k, or both
 * B_{k-1} and B_k exist and the doubled midpoints differ by |dx| + |dz| <= 1.
 */
export function sweptHit(p0: Tile, p1: Tile, p2: Tile, b0: Tile | null, b1: Tile | null, b2: Tile | null): 0 | 1 | 2 {
  if (b1 && (same(p1, b1) || (b0 && touches(p0, p1, b0, b1)))) return 1;
  if (b2 && (same(p2, b2) || (b1 && touches(p1, p2, b1, b2)))) return 2;
  return 0;
}

const S0 = { x: 0, z: 0 }, S1 = { x: 0, z: 0 }, S2 = { x: 0, z: 0 };

/**
 * Earliest half-step at which any bullet hits the move (p0, p1, p2) in tick T.
 * `only` clips bullets to a zone (Clatterhorn's glade): a half-step counts when
 * its end sample or its start sample lies in the zone, and the end-tile test
 * additionally needs the end sample in the zone.
 */
export function bulletsHitMove(bullets: Int32Array, T: number, p0: Tile, p1: Tile, p2: Tile, only?: (x: number, z: number) => boolean): 0 | 1 | 2 {
  let late = false;
  const n = Math.floor(bullets.length / BULLET_STRIDE);
  const halfHits = (hasA: boolean, A: Tile, B: Tile, pa: Tile, pb: Tile) => {
    const inB = !only || only(B.x, B.z);
    if (only && !inB && !(hasA && only(A.x, A.z))) return false;
    return (inB && same(pb, B)) || (hasA && touches(pa, pb, A, B));
  };
  for (let i = 0; i < n; i++) {
    const h0 = 2 * (T - bullets[i * BULLET_STRIDE]) - 2;
    if (h0 + 2 < 0 || h0 > BULLET_LIFE_HALF_STEPS) continue;
    const e0 = bulletTileAt(bullets, i, h0, S0), e1 = bulletTileAt(bullets, i, h0 + 1, S1), e2 = bulletTileAt(bullets, i, h0 + 2, S2);
    if (e1 && halfHits(e0, S0, S1, p0, p1)) return 1;
    if (!late && e2 && halfHits(e1, S1, S2, p1, p2)) late = true;
  }
  return late ? 2 : 0;
}

/**
 * Exact stationary danger of tick T: {B1, B2} plus B0 when B0 -> B1 is a
 * cardinal step, over every live bullet; keys = tileKey; filtered by `keep`.
 */
export function bulletDangerKeys(bullets: Int32Array, T: number, keep: (x: number, z: number) => boolean, out: Set<number> = new Set()): Set<number> {
  const n = Math.floor(bullets.length / BULLET_STRIDE);
  const add = (t: Tile) => { if (keep(t.x, t.z)) out.add(t.z * GRID_SIZE + t.x); };
  for (let i = 0; i < n; i++) {
    const h0 = 2 * (T - bullets[i * BULLET_STRIDE]) - 2;
    if (h0 + 2 < 0 || h0 > BULLET_LIFE_HALF_STEPS) continue;
    const e0 = bulletTileAt(bullets, i, h0, S0), e1 = bulletTileAt(bullets, i, h0 + 1, S1), e2 = bulletTileAt(bullets, i, h0 + 2, S2);
    if (e1) add(S1);
    if (e2) add(S2);
    if (e0 && e1 && Math.abs(S1.x - S0.x) + Math.abs(S1.z - S0.z) === 1) add(S0);
  }
  return out;
}

/**
 * The canonical middle tile of a tick's move p0 -> p2: the first step of the
 * BFS route (the step the server took and every client animates), or p2 for a
 * one-step move. `bfsPath(p0, goalIsTile(p2), blocked)[0]` when p2 is two
 * steps away, which also covers a diagonal neighbour whose corner is blocked
 * (reached in two orthogonal steps). Teleports (> 2) return p2.
 */
export function canonicalMiddle(p0: Tile, p2: Tile, blocked: Set<number>): Tile {
  const d = chebyshev(p0, p2);
  if (d === 0) return { x: p0.x, z: p0.z };
  if (d > 2 || (d === 1 && (p0.x === p2.x || p0.z === p2.z))) return { x: p2.x, z: p2.z };
  const path = bfsPath(p0, goalIsTile(p2), blocked);
  return path && path.length === 2 ? { x: path[0].x, z: path[0].z } : { x: p2.x, z: p2.z };
}

export interface BulletMove { mid: Tile; end: Tile; steps: 0 | 1 | 2 }

/** Neighbour order of `pathfinding.ts` (BFS discovery order). */
const NB: ReadonlyArray<readonly [number, number]> = [[0, 1], [-1, 0], [0, -1], [1, 0], [-1, 1], [-1, -1], [1, -1], [1, 1]];

/** Stay, every 1-step and every 2-step destination with its canonical middle, in BFS discovery order (max 25). */
export function movesWithin(from: Tile, standable: (t: Tile) => boolean): BulletMove[] {
  const step = (a: Tile, dx: number, dz: number): Tile | null => {
    const to = { x: a.x + dx, z: a.z + dz };
    if (!standable(to)) return null;
    if (dx !== 0 && dz !== 0 && (!standable({ x: a.x + dx, z: a.z }) || !standable({ x: a.x, z: a.z + dz }))) return null;
    return to;
  };
  const start = { x: from.x, z: from.z };
  const out: BulletMove[] = [{ mid: start, end: start, steps: 0 }];
  const seen = new Set<number>([from.z * GRID_SIZE + from.x]);
  const first: Tile[] = [];
  for (const [dx, dz] of NB) {
    const t = step(from, dx, dz);
    if (!t || seen.has(t.z * GRID_SIZE + t.x)) continue;
    seen.add(t.z * GRID_SIZE + t.x);
    first.push(t);
    out.push({ mid: t, end: t, steps: 1 });
  }
  for (const m of first) for (const [dx, dz] of NB) {
    const t = step(m, dx, dz);
    if (!t || seen.has(t.z * GRID_SIZE + t.x)) continue;
    seen.add(t.z * GRID_SIZE + t.x);
    out.push({ mid: m, end: t, steps: 2 });
  }
  return out;
}

/**
 * Reusable per-tick grid over a box of tiles: occupancy at half-steps 1 and 2,
 * Manhattan-dilated doubled midpoints of both half-steps and the exact
 * stationary danger, so every move test is O(1). Players outside the box are
 * never hit through it.
 */
export class BulletGrid {
  private readonly e1: Uint8Array;
  private readonly e2: Uint8Array;
  private readonly m1: Uint8Array;
  private readonly m2: Uint8Array;
  private readonly danger: Uint8Array;
  private readonly dw: number;
  private readonly dh: number;

  constructor(readonly x0: number, readonly z0: number, readonly w: number, readonly h: number) {
    this.e1 = new Uint8Array(w * h); this.e2 = new Uint8Array(w * h); this.danger = new Uint8Array(w * h);
    this.dw = 2 * w - 1; this.dh = 2 * h - 1;
    this.m1 = new Uint8Array(this.dw * this.dh); this.m2 = new Uint8Array(this.dw * this.dh);
  }

  private tile(x: number, z: number): number {
    const u = x - this.x0, v = z - this.z0;
    return u < 0 || v < 0 || u >= this.w || v >= this.h ? -1 : v * this.w + u;
  }

  private sum(sx: number, sz: number): number {
    const u = sx - 2 * this.x0, v = sz - 2 * this.z0;
    return u < 0 || v < 0 || u >= this.dw || v >= this.dh ? -1 : v * this.dw + u;
  }

  private dilate(m: Uint8Array, sx: number, sz: number): void {
    for (const [ex, ez] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = this.sum(sx + ex, sz + ez);
      if (k >= 0) m[k] = 1;
    }
  }

  build(bullets: Int32Array, T: number): this {
    this.e1.fill(0); this.e2.fill(0); this.m1.fill(0); this.m2.fill(0); this.danger.fill(0);
    const n = Math.floor(bullets.length / BULLET_STRIDE);
    for (let i = 0; i < n; i++) {
      const h0 = 2 * (T - bullets[i * BULLET_STRIDE]) - 2;
      if (h0 + 2 < 0 || h0 > BULLET_LIFE_HALF_STEPS) continue;
      const e0 = bulletTileAt(bullets, i, h0, S0), e1 = bulletTileAt(bullets, i, h0 + 1, S1), e2 = bulletTileAt(bullets, i, h0 + 2, S2);
      if (e1) { const k = this.tile(S1.x, S1.z); if (k >= 0) { this.e1[k] = 1; this.danger[k] = 1; } }
      if (e2) { const k = this.tile(S2.x, S2.z); if (k >= 0) { this.e2[k] = 1; this.danger[k] = 1; } }
      if (e0 && e1) {
        this.dilate(this.m1, S0.x + S1.x, S0.z + S1.z);
        if (Math.abs(S1.x - S0.x) + Math.abs(S1.z - S0.z) === 1) { const k = this.tile(S0.x, S0.z); if (k >= 0) this.danger[k] = 1; }
      }
      if (e1 && e2) this.dilate(this.m2, S1.x + S2.x, S1.z + S2.z);
    }
    return this;
  }

  hits(p0: Tile, p1: Tile, p2: Tile): 0 | 1 | 2 {
    const a = this.tile(p1.x, p1.z), b = this.sum(p0.x + p1.x, p0.z + p1.z);
    if ((a >= 0 && this.e1[a]) || (b >= 0 && this.m1[b])) return 1;
    const c = this.tile(p2.x, p2.z), d = this.sum(p1.x + p2.x, p1.z + p2.z);
    if ((c >= 0 && this.e2[c]) || (d >= 0 && this.m2[d])) return 2;
    return 0;
  }

  /** Exact stationary danger of the built tick. */
  dangerAt(x: number, z: number): boolean {
    const k = this.tile(x, z);
    return k >= 0 && this.danger[k] === 1;
  }
}
