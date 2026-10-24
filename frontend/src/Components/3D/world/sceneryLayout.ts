import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { FOREST_TREES, RIDGE_TILES, TILE_ORIGIN } from '@sim';
import { BIOMES, biomeOf, type BiomeId } from '@sim/expanse';
import { linear } from '../nodes/lowPoly';
import { chunkKeyOf, hash2 } from './chunks';
import type { TreeStyle } from './treeArt';

/**
 * Per-chunk instance lists for the tall scenery: forest trunks (one list per
 * tree style) and the ridges' boulder walls. Pure data (matrices and colours),
 * so the chunk budgets are testable without a renderer.
 */
export interface InstanceList { count: number; matrices: Float32Array; colors?: Float32Array }

const m = new Matrix4(), q = new Quaternion(), e = new Euler(), p = new Vector3(), s = new Vector3();
export function pushInstance(mats: number[], x: number, y: number, z: number, yaw: number, sx: number, sy = sx, sz = sx, tilt = 0) {
  e.set(tilt, yaw, tilt * .6); q.setFromEuler(e);
  m.compose(p.set(x, y, z), q, s.set(sx, sy, sz));
  for (let k = 0; k < 16; k++) mats.push(m.elements[k]);
}
const finish = (mats: number[], cols?: number[]): InstanceList => ({ count: mats.length / 16, matrices: Float32Array.from(mats), colors: cols ? Float32Array.from(cols) : undefined });

/** Tree style for a trunk tile: the biome's (the island keeps its own tree). */
export const treeStyleAt = (t: { x: number; z: number }): TreeStyle => BIOMES[biomeOf(t)].trees;

let trees: Map<string, Partial<Record<TreeStyle, InstanceList>>> | undefined;
/** FOREST_TREES by chunk and style. Rotation and scale follow each trunk's global index, as before. */
export function treeChunks(): Map<string, Partial<Record<TreeStyle, InstanceList>>> {
  if (trees) return trees;
  const raw = new Map<string, Partial<Record<TreeStyle, number[]>>>();
  FOREST_TREES.forEach((t, i) => {
    const key = chunkKeyOf(t.x, t.z), style = treeStyleAt(t);
    let byStyle = raw.get(key);
    if (!byStyle) raw.set(key, byStyle = {});
    const mats = byStyle[style] ??= [];
    const scale = style === 'broadleaf' ? .8 + (i % 5) * .095 : style === 'crystal' ? .75 + hash2(t.x, t.z) * .55 : .78 + hash2(t.x + 3, t.z) * .4;
    pushInstance(mats, t.x - TILE_ORIGIN, 0, t.z - TILE_ORIGIN, i * 2.4, scale);
  });
  trees = new Map([...raw].map(([key, byStyle]) => [key, Object.fromEntries(Object.entries(byStyle).map(([k, v]) => [k, finish(v!)]))]));
  return trees;
}

const RIDGE_TINT: Partial<Record<BiomeId, number>> = { frostpine: 0xb4bcc4, dunes: 0xb0674a, starfall: 0x4d4652, hearthvale: 0x9a9480, glimmerfen: 0x6f7464 };
let ridges: Map<string, InstanceList> | undefined;
/**
 * The ridges' rock walls: a tall boulder on every ridge tile, a lower filler
 * toward each ridge neighbour (so it reads as one wall), tinted by biome:
 * the Spine grey, the Redwall red sandstone, the Cinder Rim basalt.
 */
export function ridgeChunks(): Map<string, InstanceList> {
  if (ridges) return ridges;
  const onRidge = new Set(RIDGE_TILES.map(t => t.z * 4096 + t.x));
  const raw = new Map<string, { mats: number[]; cols: number[] }>();
  const c = new Color();
  for (const t of RIDGE_TILES) {
    const key = chunkKeyOf(t.x, t.z);
    let list = raw.get(key);
    if (!list) raw.set(key, list = { mats: [], cols: [] });
    const tint = linear(RIDGE_TINT[biomeOf(t)] ?? 0x8f8c7e);
    const r = (k: number) => hash2(t.x * 3 + k, t.z * 5 - k);
    const wx = t.x - TILE_ORIGIN, wz = t.z - TILE_ORIGIN, h = 1.1 + r(1) * .9;
    const add = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, tilt: number, shade: number) => {
      pushInstance(list!.mats, x, y, z, yaw, sx, sy, sz, tilt);
      c.copy(tint).multiplyScalar(shade); list!.cols.push(c.r, c.g, c.b);
    };
    add(wx + (r(2) - .5) * .25, h * .45, wz + (r(3) - .5) * .25, .62 + r(4) * .2, h, .6 + r(5) * .2, r(6) * 6.28, (r(7) - .5) * .3, .82 + r(8) * .3);
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      if (!onRidge.has((t.z + dz) * 4096 + t.x + dx)) continue;
      const fh = .7 + r(9 + dx + dz * 2) * .45;
      add(wx + dx * .5, fh * .4, wz + dz * .5, .5, fh, .5, r(12) * 6.28, 0, .78 + r(13) * .2);
    }
    // A small scree stone at the foot now and then.
    if (r(14) < .45) add(wx + (r(15) - .5) * 1.4, .08, wz + (r(16) - .5) * 1.4, .22 + r(17) * .15, .16, .2, r(18) * 6.28, 0, .9);
  }
  ridges = new Map([...raw].map(([key, l]) => [key, finish(l.mats, l.cols)]));
  return ridges;
}
