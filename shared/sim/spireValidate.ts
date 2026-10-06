/**
 * The exhaustive Spire pattern validator (FINAL_SPEC 3.9, 6.5): backward
 * induction over (tile, tick) for one pattern instance, ported from
 * proto-final/validate.mjs with flat typed-array grids. Imported by tests and
 * dev tools only (not exported from index.ts).
 *
 * Ticks are relative to the pattern start (P = 0). A tile is safe at the last
 * danger tick; one tick back it is safe iff some move (stay, or any tile within
 * 2 BFS steps with its canonical middle) is hit-free under the Manhattan swept
 * rule and ends on a safe tile. Every move test is four array reads.
 */
import { SPIRE_CENTRE, SPIRE_FLOOR, spireStandable } from './bossZones';
import { BULLET_LIFE_HALF_STEPS, BULLET_STRIDE, bulletDangerKeys, bulletTileAt, mix32, movesWithin } from './bullets';
import {
  SPIRE_DAMAGE, SPIRE_MIN_STARS, SPIRE_PATTERNS, SPIRE_POOLS, SPIRE_STAR_DAMAGE, SPIRE_STAR_PERIOD, SPIRE_STAR_PREVIEW,
  SPIRE_STAR_TILES, spireBuildPattern, spireStars,
} from './spire';
import type { Tile } from './types';

export interface SpireValidation {
  /** firstContact >= 3 and every standable tile is winning at P + 2 (the other obligations are asserted by tests). */
  ok: boolean;
  /** First tick (relative to P) at which a stationary player on some standable tile is hit. */
  firstContact: number;
  /** Exact last danger: the last tick at which a stationary player on some standable tile is hit. */
  lastDanger: number;
  /** Most floor tiles occupied by bullets at the end of one tick. */
  maxLive: number;
  /** Standable tiles that are not winning at P + 2. */
  unsafe: number;
  /** Minimum share of the 216 tiles still winning over mid-pattern ticks. */
  pinch: number;
  /** The same over the 72 court tiles. */
  courtPinch: number;
  /** Share of tiles where standing still for the whole pattern gets you hit. */
  still: number;
}

// ---- Fixed geometry (the evaluation box x 69..85, z 54..70, the 216 standable tiles and their moves) --------------

const BX0 = SPIRE_FLOOR.x0 - 1, BZ0 = SPIRE_FLOOR.z0 - 1;
const BW = SPIRE_FLOOR.x1 - SPIRE_FLOOR.x0 + 3;             // 17
const DW = 2 * BW - 1;                                       // 33: doubled sums of two box tiles
const GT = BW * BW, GD = DW * DW;
const boxIdx = (x: number, z: number) => (z - BZ0) * BW + (x - BX0);
/** Doubled-sum index, -1 outside. */
const sumIdx = (sx: number, sz: number) => {
  const u = sx - 2 * BX0, v = sz - 2 * BZ0;
  return u < 0 || v < 0 || u >= DW || v >= DW ? -1 : v * DW + u;
};
const inFloor = (x: number, z: number) => x >= SPIRE_FLOOR.x0 && x <= SPIRE_FLOOR.x1 && z >= SPIRE_FLOOR.z0 && z <= SPIRE_FLOOR.z1;

const TILES: Tile[] = [];
for (let z = SPIRE_FLOOR.z0; z <= SPIRE_FLOOR.z1; z++) for (let x = SPIRE_FLOOR.x0; x <= SPIRE_FLOOR.x1; x++) {
  if (spireStandable({ x, z })) TILES.push({ x, z });
}
const NT = TILES.length;                                     // 216
const TILE_OF = new Int32Array(GT).fill(-1);
TILES.forEach((t, i) => { TILE_OF[boxIdx(t.x, t.z)] = i; });
const T_BOX = Int32Array.from(TILES, (t) => boxIdx(t.x, t.z));
const T_SUM = Int32Array.from(TILES, (t) => sumIdx(2 * t.x, 2 * t.z));
const T_COURT = Uint8Array.from(TILES, (t) => (Math.max(Math.abs(t.x - SPIRE_CENTRE.x), Math.abs(t.z - SPIRE_CENTRE.z)) <= 4 ? 1 : 0));
const N_COURT = T_COURT.reduce((a, b) => a + b, 0);
/** Flat moves: per move [midBox, sum(p0 + mid), endBox, sum(mid + end), endTile]; tile i's moves are MV_AT[i]..MV_AT[i+1]. */
const MV_AT = new Int32Array(NT + 1);
const MV: number[] = [];
TILES.forEach((t, i) => {
  MV_AT[i] = MV.length / 5;
  for (const m of movesWithin(t, spireStandable)) {
    MV.push(boxIdx(m.mid.x, m.mid.z), sumIdx(t.x + m.mid.x, t.z + m.mid.z), boxIdx(m.end.x, m.end.z),
      sumIdx(m.mid.x + m.end.x, m.mid.z + m.end.z), TILE_OF[boxIdx(m.end.x, m.end.z)]);
  }
});
MV_AT[NT] = MV.length / 5;
const MOVES = Int32Array.from(MV);

// ---- Per-tick grids, reused across instances ----------------------------------------------------------------------

let cap = 0;
let E1 = new Uint8Array(0), E2 = new Uint8Array(0), M1 = new Uint8Array(0), M2 = new Uint8Array(0);
function ensure(ticks: number): void {
  if (ticks <= cap) { E1.fill(0, 0, ticks * GT); E2.fill(0, 0, ticks * GT); M1.fill(0, 0, ticks * GD); M2.fill(0, 0, ticks * GD); return; }
  cap = Math.max(ticks, 64);
  E1 = new Uint8Array(cap * GT); E2 = new Uint8Array(cap * GT); M1 = new Uint8Array(cap * GD); M2 = new Uint8Array(cap * GD);
}

const DIL: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

/** Fills E1/E2 (box occupancy at half-steps 1 and 2) and M1/M2 (Manhattan-dilated doubled midpoints) for ticks 1..horizon. */
function fillGrids(b: Int32Array, horizon: number): void {
  ensure(horizon + 1);
  const n = b.length / BULLET_STRIDE;
  const px = new Int32Array(BULLET_LIFE_HALF_STEPS + 1), pz = new Int32Array(BULLET_LIFE_HALF_STEPS + 1);
  for (let i = 0; i < n; i++) {
    const o = i * BULLET_STRIDE, F = b[o], ox = b[o + 1], oz = b[o + 2], dx = b[o + 3], dz = b[o + 4], q = b[o + 5];
    const ax = Math.abs(dx), az = Math.abs(dz), M = Math.max(ax, az), sx = Math.sign(dx), sz = Math.sign(dz);
    for (let h = 0; h <= BULLET_LIFE_HALF_STEPS; h++) {
      const s = q === 2 ? h : (h + 1) >> 1;
      px[h] = ox + sx * (ax === M ? s : Math.floor((2 * s * ax + M) / (2 * M)));
      pz[h] = oz + sz * (az === M ? s : Math.floor((2 * s * az + M) / (2 * M)));
    }
    const tEnd = Math.min(horizon, F + BULLET_LIFE_HALF_STEPS / 2 + 1);
    for (let T = Math.max(1, F); T <= tEnd; T++) {
      for (let k = 1; k <= 2; k++) {
        const h = 2 * (T - F) - 2 + k;
        if (h < 0 || h > BULLET_LIFE_HALF_STEPS) continue;
        const x1 = px[h], z1 = pz[h];
        const E = k === 1 ? E1 : E2, Mg = k === 1 ? M1 : M2;
        if (x1 >= BX0 && x1 < BX0 + BW && z1 >= BZ0 && z1 < BZ0 + BW) E[T * GT + boxIdx(x1, z1)] = 1;
        if (h >= 1) {
          const mx = px[h - 1] + x1, mz = pz[h - 1] + z1;
          for (const [ex, ez] of DIL) { const d = sumIdx(mx + ex, mz + ez); if (d >= 0) Mg[T * GD + d] = 1; }
        }
      }
    }
  }
}

const stillHit = (T: number, i: number) =>
  E1[T * GT + T_BOX[i]] | E2[T * GT + T_BOX[i]] | M1[T * GD + T_SUM[i]] | M2[T * GD + T_SUM[i]];

/** Validates already-built packed bullets whose pattern starts at P = 0 (tests use it for hand-made volleys too). */
export function spireValidateBullets(bullets: Int32Array, start = 2): SpireValidation {
  let maxF = 0;
  for (let o = 0; o < bullets.length; o += BULLET_STRIDE) maxF = Math.max(maxF, bullets[o]);
  const horizon = maxF + BULLET_LIFE_HALF_STEPS / 2 + 2;
  fillGrids(bullets, horizon);
  let firstContact = Infinity, lastDanger = -1, maxLive = 0;
  for (let T = 1; T <= horizon; T++) {
    for (let i = 0; i < NT; i++) if (stillHit(T, i)) { if (T < firstContact) firstContact = T; lastDanger = T; break; }
    let live = 0;
    for (let z = SPIRE_FLOOR.z0; z <= SPIRE_FLOOR.z1; z++) for (let x = SPIRE_FLOOR.x0; x <= SPIRE_FLOOR.x1; x++) live += E2[T * GT + boxIdx(x, z)];
    if (live > maxLive) maxLive = live;
  }
  let safe = new Uint8Array(NT).fill(1);
  let prev = new Uint8Array(NT);
  let pinch = 1, courtPinch = 1;
  for (let T = lastDanger; T > start; T--) {
    prev.fill(0);
    let n = 0, nc = 0;
    const e1 = T * GT, e2 = T * GT, d1 = T * GD, d2 = T * GD;
    for (let i = 0; i < NT; i++) {
      for (let m = MV_AT[i]; m < MV_AT[i + 1]; m++) {
        const o = m * 5;
        if (!safe[MOVES[o + 4]]) continue;
        if (E1[e1 + MOVES[o]] || M1[d1 + MOVES[o + 1]] || E2[e2 + MOVES[o + 2]] || M2[d2 + MOVES[o + 3]]) continue;
        prev[i] = 1; n++; if (T_COURT[i]) nc++;
        break;
      }
    }
    const t = safe; safe = prev; prev = t;
    if (T - 1 > start) { pinch = Math.min(pinch, n / NT); courtPinch = Math.min(courtPinch, nc / N_COURT); }
  }
  let unsafe = 0;
  for (let i = 0; i < NT; i++) if (!safe[i]) unsafe++;
  let still = 0;
  for (let i = 0; i < NT; i++) for (let T = start + 1; T <= lastDanger; T++) if (stillHit(T, i)) { still++; break; }
  return { ok: firstContact >= 3 && unsafe === 0, firstContact, lastDanger, maxLive, unsafe, pinch, courtPinch, still: still / NT };
}

/** Validates one instance: kind x seed6 (which also fixes the spin) x aim (absolute tile; ignored by non-aimed kinds). */
export function spireValidate(kind: number, seed6: number, aimX: number, aimZ: number): SpireValidation {
  return spireValidateBullets(spireBuildPattern(kind, 0, seed6, aimX, aimZ));
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
/** 0 for angles in [0, pi) measured clockwise on screen from east (+z is south), 1 for [pi, 2 pi). */
const half = (u: number, v: number) => (v > 0 || (v === 0 && u > 0) ? 0 : 1);
let aimCache: Tile[] | null = null;

/**
 * 144 representatives (reduced directions from the centre; the first standable tile in row order per class),
 * absolute tiles, sorted clockwise from east with an integer cross-product comparator.
 */
export function spireAimClasses(): Tile[] {
  if (!aimCache) {
    const seen = new Map<string, Tile>();
    for (const t of TILES) {
      const u = t.x - SPIRE_CENTRE.x, v = t.z - SPIRE_CENTRE.z, g = gcd(Math.abs(u), Math.abs(v));
      const key = `${u / g},${v / g}`;
      if (!seen.has(key)) seen.set(key, t);
    }
    aimCache = [...seen.values()].sort((a, b) => {
      const au = a.x - SPIRE_CENTRE.x, av = a.z - SPIRE_CENTRE.z, bu = b.x - SPIRE_CENTRE.x, bv = b.z - SPIRE_CENTRE.z;
      const ha = half(au, av), hb = half(bu, bv);
      return ha !== hb ? ha - hb : bu * av - au * bv;
    });
  }
  return aimCache.map((t) => ({ x: t.x, z: t.z }));
}

/** The two fixed aims the hash expands every kind at. */
export const SPIRE_HASH_AIMS: readonly Tile[] = [{ x: 77, z: 69 }, { x: 72, z: 58 }];

/**
 * FNV-1a over the bullet-relevant behaviour, NOT over SPIRE_RULES_VERSION:
 * SPIRE_PATTERNS (kinds, durations, flags), SPIRE_POOLS, SPIRE_DAMAGE, the star
 * constants, the packed bullets of every kind for all 64 seeds at two fixed
 * aims (plus every half-step tile of the first aim's bullets, so a kinematics
 * change in bullets.ts changes it too, and the exact stationary danger of seeds 0..3), and spireStars for 8 seeds x 4 waves x K 3..6.
 */
export function spirePatternTableHash(): string {
  let h = 0x811c9dc5;
  const byte = (b: number) => { h = Math.imul(h ^ (b & 255), 0x01000193) >>> 0; };
  const int = (n: number) => { byte(n); byte(n >>> 8); byte(n >>> 16); byte(n >>> 24); };
  const str = (s: string) => { int(s.length); for (let i = 0; i < s.length; i++) int(s.charCodeAt(i)); };
  for (const p of SPIRE_PATTERNS) { int(p.kind); str(p.key); int(p.phase); int(p.duration); int(p.aimed ? 1 : 0); int(p.seeded ? 1 : 0); }
  for (const phase of [1, 2, 3, 4] as const) { int(phase); for (const k of SPIRE_POOLS[phase]) int(k); }
  for (const d of SPIRE_DAMAGE) int(d);
  for (const c of [SPIRE_STAR_PERIOD, SPIRE_STAR_DAMAGE, SPIRE_STAR_PREVIEW, SPIRE_MIN_STARS, SPIRE_STAR_TILES.length]) int(c);
  for (const t of SPIRE_STAR_TILES) { int(t.x); int(t.z); }
  const at = { x: 0, z: 0 };
  for (const p of SPIRE_PATTERNS) for (let s = 0; s < 64; s++) {
    SPIRE_HASH_AIMS.forEach((aim, a) => {
      const b = spireBuildPattern(p.kind, 0, s, aim.x, aim.z);
      int(b.length);
      for (let i = 0; i < b.length; i++) int(b[i]);
      if (a !== 0) return;
      for (let i = 0; i < b.length / BULLET_STRIDE; i++) for (let k = 0; k <= BULLET_LIFE_HALF_STEPS; k++) {
        if (bulletTileAt(b, i, k, at)) { byte(at.x); byte(at.z); }
      }
      if (s > 3) return;
      for (let T = 0; T <= 40; T++) for (const key of [...bulletDangerKeys(b, T, inFloor)].sort((x, y) => x - y)) int(key);
    });
  }
  for (let seed = 1; seed <= 8; seed++) for (let w = 0; w < 4; w++) for (let K = 3; K <= 6; K++) {
    for (const t of spireStars(mix32(seed, 0x5eed), w, K)) { int(t.x); int(t.z); }
  }
  return h.toString(16).padStart(8, '0');
}
