import { BufferGeometry, Float32BufferAttribute } from 'three';
import { ISLE_SIZE, TILE_ORIGIN, TRAILS, inGiantHeadland, terrainField } from '@sim';
import { BIOMES, EXPANSE_LAKES, biomeOf, type BiomeId } from '@sim/expanse';
import { linear } from '../nodes/lowPoly';
import { CHUNK } from './chunks';

/**
 * Terrain chunk geometry: the same shore-clipped, vertex-coloured ground the
 * island always had (islandTerrainArt.createTerrainGeometry), built per chunk
 * with every field, trail and colour sample cached on the chunk's grid.
 *
 * Ground colours blend between biomes over ~6 tiles (a blurred biome lattice),
 * each biome bringing its own ground pair (expanse.ts BIOMES), shore, trail and
 * a small surface effect: snow drifts, farm plots, wet fen, dune ripples and
 * the crater's scorch.
 */
const BIOME_IDS: readonly BiomeId[] = ['isle', 'frostpine', 'hearthvale', 'glimmerfen', 'dunes', 'starfall'];
const rgb = (hex: number) => { const c = linear(hex); return [c.r, c.g, c.b] as const; };
/** Per biome: ground A, ground B, shore, trail (linear rgb). The island's are the original colours. */
const SHORE: Record<BiomeId, number> = { isle: 0xecd099, frostpine: 0xb9b5a8, hearthvale: 0xe8cf95, glimmerfen: 0x7d7150, dunes: 0xf1dca6, starfall: 0x4c4752 };
const TRAIL: Record<BiomeId, number> = { isle: 0xceba91, frostpine: 0xa39d92, hearthvale: 0xc9ad7c, glimmerfen: 0x8a7451, dunes: 0xb98c55, starfall: 0x8c8079 };
const PALETTE = BIOME_IDS.map((id) => [...rgb(BIOMES[id].ground[0]), ...rgb(BIOMES[id].ground[1]), ...rgb(SHORE[id]), ...rgb(TRAIL[id])]);
const ASH = rgb(0x8b897c), SNOW = rgb(0xf6f9fb), WHEAT = rgb(0xc9b65c), PLOUGH = rgb(0x8d6c47), WET = rgb(0x3b5136), SCORCH = rgb(0x2e2933), EMBER = rgb(0x6b3b3a);
const CRATER = EXPANSE_LAKES.find((l) => l.id === 'crater')!;

/** Lattice spacing (tiles) and blur radius (lattice steps) of the biome blend. */
const LAT = 2, BLUR = 3;
/** Floats per lattice point: 12 palette + 5 effect weights (frost, hearth, fen, dunes, star). */
const LF = 17;

interface Lattice { x0: number; z0: number; w: number; h: number; data: Float32Array }

/** Blurred biome palette over a rectangle (tile coordinates), on a LAT-tile lattice. */
function biomeLattice(x0: number, z0: number, x1: number, z1: number): Lattice {
  const lx0 = Math.floor(x0 / LAT) * LAT, lz0 = Math.floor(z0 / LAT) * LAT;
  const w = Math.ceil((x1 - lx0) / LAT) + 1, h = Math.ceil((z1 - lz0) / LAT) + 1;
  // One-hot biome samples with a BLUR margin.
  const sw = w + BLUR * 2, sh = h + BLUR * 2, samples = new Uint8Array(sw * sh);
  for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
    const x = lx0 + (i - BLUR) * LAT, z = lz0 + (j - BLUR) * LAT;
    samples[j * sw + i] = BIOME_IDS.indexOf(biomeOf({ x, z }));
  }
  const data = new Float32Array(w * h * LF), weights = new Float32Array(BIOME_IDS.length);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = lx0 + i * LAT, z = lz0 + j * LAT;
    weights.fill(0);
    // The island corner keeps its own colours exactly; the blend starts at its edge.
    if (x < ISLE_SIZE && z < ISLE_SIZE) weights[0] = 1;
    else {
      let total = 0;
      for (let dj = -BLUR; dj <= BLUR; dj++) for (let di = -BLUR; di <= BLUR; di++) {
        if (di * di + dj * dj > BLUR * BLUR + 1) continue;
        const k = 1 / (1 + di * di + dj * dj);
        weights[samples[(j + BLUR + dj) * sw + i + BLUR + di]] += k; total += k;
      }
      for (let b = 0; b < weights.length; b++) weights[b] /= total;
    }
    const o = (j * w + i) * LF;
    for (let b = 0; b < weights.length; b++) {
      const wb = weights[b];
      if (!wb) continue;
      const p = PALETTE[b];
      for (let k = 0; k < 12; k++) data[o + k] += p[k] * wb;
      if (b > 0) data[o + 11 + b] = wb;
    }
  }
  return { x0: lx0, z0: lz0, w, h, data };
}

/** Bilinear lattice lookup into `out` (LF floats). */
function sampleLattice(l: Lattice, x: number, z: number, out: Float32Array) {
  const fx = Math.max(0, Math.min(l.w - 1.0001, (x - l.x0) / LAT)), fz = Math.max(0, Math.min(l.h - 1.0001, (z - l.z0) / LAT));
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const a = (j * l.w + i) * LF, b = a + LF, c = a + l.w * LF, d = c + LF;
  const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
  for (let k = 0; k < LF; k++) out[k] = l.data[a + k] * w00 + l.data[b + k] * w10 + l.data[c + k] * w01 + l.data[d + k] * w11;
}

const lerp3 = (c: number[], t: readonly number[], f: number) => { c[0] += (t[0] - c[0]) * f; c[1] += (t[1] - c[1]) * f; c[2] += (t[2] - c[2]) * f; };
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Trail segments that can tint a rectangle (a trail colours up to ~1.25 tiles out). */
function trailSegments(x0: number, z0: number, x1: number, z1: number): Float64Array {
  const segs: number[] = [];
  const m = 2;
  for (const trail of TRAILS) for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i];
    if (Math.max(a.x, b.x) < x0 - m || Math.min(a.x, b.x) > x1 + m || Math.max(a.z, b.z) < z0 - m || Math.min(a.z, b.z) > z1 + m) continue;
    segs.push(a.x, a.z, b.x, b.z);
  }
  return Float64Array.from(segs);
}
function roadDistance(segs: Float64Array, x: number, z: number): number {
  let d = Infinity;
  for (let s = 0; s < segs.length; s += 4) {
    const ax = segs[s], az = segs[s + 1], dx = segs[s + 2] - ax, dz = segs[s + 3] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    d = Math.min(d, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return d;
}

const scratch = new Float32Array(LF);
const col = [0, 0, 0];
/** Ground colour at tile (x, z) with field value d; writes linear rgb into `out` at `o`. */
function groundColour(l: Lattice, segs: Float64Array, x: number, z: number, d: number, out: Float32Array | number[], o: number) {
  sampleLattice(l, x, z, scratch);
  const [wf, wh, wfen, wd, ws] = [scratch[12], scratch[13], scratch[14], scratch[15], scratch[16]];
  const patch = .5 + .2 * Math.sin(x * .28 + Math.sin(z * .17)) + .18 * Math.sin(z * .37 - x * .14) + .07 * Math.sin(x * 2.7 + z * 3.1);
  let mixT = patch;
  if (wd > 0) mixT += ((.5 + .42 * Math.sin(x * .55 + 1.7 * Math.sin(z * .12)) + .08 * Math.sin(z * 1.9)) - patch) * wd;
  col[0] = scratch[0] + (scratch[3] - scratch[0]) * mixT;
  col[1] = scratch[1] + (scratch[4] - scratch[1]) * mixT;
  col[2] = scratch[2] + (scratch[5] - scratch[2]) * mixT;
  if (wf > 0) lerp3(col, SNOW, wf * .75 * smooth(.5, .72, patch + .22 * Math.sin(x * .9 + z * .4)));
  if (wh > 0) {
    const plot = Math.sin(Math.floor(x / 9) * 91.7 + Math.floor(z / 7) * 47.3) * 9631.7, p = plot - Math.floor(plot);
    if (p < .32) lerp3(col, WHEAT, wh * .5);
    else if (p > .82) lerp3(col, PLOUGH, wh * .35);
  }
  if (wfen > 0) lerp3(col, WET, wfen * .55 * smooth(.55, .78, .5 + .3 * Math.sin(x * .41 - z * .23) + .2 * Math.sin(z * .53 + x * .11)));
  if (ws > 0) {
    const r = Math.hypot(x - CRATER.x, z - CRATER.z);
    const scorch = clamp01(1.25 - r / 22 + .25 * Math.sin(x * .7 + z * .5) * Math.sin(z * .6 - x * .3));
    lerp3(col, SCORCH, ws * scorch * .8);
    if (r < CRATER.rx + 3.5) lerp3(col, EMBER, ws * clamp01(1 - Math.abs(r - CRATER.rx - 1.2) / 2.2) * .5);
  }
  if (inGiantHeadland({ x, z }) && Math.max(x, z) > 49) { col[0] = ASH[0] * (.85 + patch * .25); col[1] = ASH[1] * (.85 + patch * .25); col[2] = ASH[2] * (.85 + patch * .25); }
  else lerp3(col, [scratch[6], scratch[7], scratch[8]], Math.max(0, 1 - d / 1.7));
  if (d > .5) {
    const road = roadDistance(segs, x, z);
    if (road < 1.3) {
      const wornEdge = .1 * Math.sin(x * 2.3 + z * .9) + .07 * Math.sin(z * 2.7 - x * .6);
      lerp3(col, [scratch[9], scratch[10], scratch[11]], clamp01((1.05 + wornEdge - road) * 2.7) * (.78 + patch * .12));
    }
  }
  out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2];
}

export const TERRAIN_FINE_STEP = .5, TERRAIN_COARSE_STEP = 1;

/**
 * One chunk's ground (tiles [cx*CHUNK-.5, (cx+1)*CHUNK-.5) on each axis), or
 * null when the chunk is open sea. Neighbouring chunks share their edge
 * samples exactly, so there are no seams.
 */
export function buildTerrainChunk(cx: number, cz: number, step: number = TERRAIN_FINE_STEP, field: (x: number, z: number) => number = terrainField): BufferGeometry | null {
  const x0 = cx * CHUNK - .5, z0 = cz * CHUNK - .5, n = Math.round(CHUNK / step) + 1;
  const values = new Float32Array(n * n);
  let anyLand = false;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = field(x0 + i * step, z0 + j * step);
    values[j * n + i] = v;
    if (v >= 0) anyLand = true;
  }
  if (!anyLand) return null;
  const lattice = biomeLattice(x0, z0, x0 + CHUNK, z0 + CHUNK);
  const segs = trailSegments(x0, z0, x0 + CHUNK, z0 + CHUNK);
  // Colours on the sample grid, computed only where a cell touches land.
  const colours = new Float32Array(n * n * 3), coloured = new Uint8Array(n * n);
  const colourAt = (k: number) => {
    if (!coloured[k]) { const i = k % n, j = (k - i) / n; groundColour(lattice, segs, x0 + i * step, z0 + j * step, values[k], colours, k * 3); coloured[k] = 1; }
    return k * 3;
  };
  const positions: number[] = [], vcol: number[] = [];
  const edge = [0, 0, 0];
  const emitSample = (k: number) => {
    const i = k % n, j = (k - i) / n, d = values[k];
    positions.push(x0 + i * step - TILE_ORIGIN, Math.min(0, d * .15 - .15), z0 + j * step - TILE_ORIGIN);
    const o = colourAt(k);
    vcol.push(colours[o], colours[o + 1], colours[o + 2]);
  };
  const emitEdge = (x: number, z: number) => {
    positions.push(x - TILE_ORIGIN, -.15, z - TILE_ORIGIN);
    groundColour(lattice, segs, x, z, 0, edge, 0);
    vcol.push(edge[0], edge[1], edge[2]);
  };
  // Shore clipping as in createTerrainGeometry: a fan over the clipped polygon.
  const poly: (number | [number, number])[] = [];
  const emit = (p: number | [number, number]) => typeof p === 'number' ? emitSample(p) : emitEdge(p[0], p[1]);
  const clip = (ka: number, kb: number, kc: number) => {
    const tri = [ka, kb, kc];
    poly.length = 0;
    for (let t = 0; t < 3; t++) {
      const a = tri[t], b = tri[(t + 1) % 3], da = values[a], db = values[b];
      if (da >= 0) poly.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const f = da / (da - db), ai = a % n, aj = (a - ai) / n, bi = b % n, bj = (b - bi) / n;
        poly.push([x0 + (ai + (bi - ai) * f) * step, z0 + (aj + (bj - aj) * f) * step]);
      }
    }
    for (let t = 1; t < poly.length - 1; t++) { emit(poly[0]); emit(poly[t]); emit(poly[t + 1]); }
  };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n;
    if (values[a] < 0 && values[b] < 0 && values[c] < 0 && values[d] < 0) continue;
    clip(a, d, b); clip(b, d, c);
  }
  if (!positions.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new Float32BufferAttribute(vcol, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Module cache of built chunks: `${cx},${cz}@${step}` -> geometry (null: open sea). */
const cache = new Map<string, BufferGeometry | null>();
export const terrainCacheKey = (key: string, step: number) => `${key}@${step}`;
export function cachedTerrainChunk(key: string, step: number): BufferGeometry | null | undefined { return cache.get(terrainCacheKey(key, step)); }
export function ensureTerrainChunk(cx: number, cz: number, step: number): BufferGeometry | null {
  const k = terrainCacheKey(`${cx},${cz}`, step);
  if (!cache.has(k)) cache.set(k, buildTerrainChunk(cx, cz, step));
  return cache.get(k)!;
}
/** Drop (and free) every cached chunk not in `keep` (cache keys). Returns how many were dropped. */
export function pruneTerrainCache(keep: ReadonlySet<string>): number {
  let dropped = 0;
  for (const [k, g] of cache) if (!keep.has(k)) { g?.dispose(); cache.delete(k); dropped++; }
  return dropped;
}
export const terrainCacheSize = () => cache.size;
