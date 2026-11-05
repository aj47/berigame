import { Color } from 'three';
import { ISLE_SIZE, TILE_ORIGIN, areaOf, terrainField, trailDistance } from '@sim';
import { biomeOf, onRidge, type BiomeId } from '@sim/expanse';
import { linear, seeded } from '../nodes/lowPoly';
import { CHUNK } from './chunks';
import { pushInstance, type InstanceList } from './sceneryLayout';

/**
 * Biome-aware ground cover for one chunk: grass tufts on the island and in
 * Hearthvale, snow tufts in Frostpine, reeds by the fen's water, dry grass and
 * cacti in the dunes, ash and crystal shards in Starfall, stones everywhere,
 * flowers where it is green and palms on warm shores. Deterministic per chunk.
 */
export type ScatterKind = 'tuft' | 'dryTuft' | 'snowTuft' | 'reed' | 'cactus' | 'shard' | 'stone' | 'flower' | 'palm';
export const SCATTER_KINDS: readonly ScatterKind[] = ['tuft', 'dryTuft', 'snowTuft', 'reed', 'cactus', 'shard', 'stone', 'flower', 'palm'];
/** Ground-cover attempts per chunk (most land on water or roads and are skipped). */
export const SCATTER_ATTEMPTS = 150;

const WHITE = new Color(1, 1, 1);
const BLOSSOMS = [0xef4444, 0xf59e0b, 0xffffff, 0xf472b6, 0x818cf8, 0xfde68a].map(linear);
const STARBLOSSOMS = [0xdbeafe, 0xbfe3ff, 0xffffff, 0xc7d2fe].map(linear);
const FEN_GRASS = linear(0xa9c08f), STONE: Record<BiomeId, Color> = {
  isle: WHITE, hearthvale: WHITE, frostpine: linear(0xe8eef3), glimmerfen: linear(0x9aa48c), dunes: linear(0xe6a07a), starfall: linear(0x575060),
};
const PALM_CHANCE: Partial<Record<BiomeId, number>> = { isle: .035, dunes: .08, hearthvale: .02 };

const cache = new Map<string, Partial<Record<ScatterKind, InstanceList>>>();
export function scatterChunk(cx: number, cz: number): Partial<Record<ScatterKind, InstanceList>> {
  const key = `${cx},${cz}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rand = seeded(31415 + cx * 7919 + cz * 104729);
  const lists: Partial<Record<ScatterKind, { mats: number[]; cols: number[] }>> = {};
  const add = (kind: ScatterKind, colour: Color, x: number, y: number, z: number, yaw: number, sx: number, sy = sx, sz = sx) => {
    const l = lists[kind] ??= { mats: [], cols: [] };
    pushInstance(l.mats, x - TILE_ORIGIN, y, z - TILE_ORIGIN, yaw, sx, sy, sz);
    l.cols.push(colour.r, colour.g, colour.b);
  };
  const x0 = cx * CHUNK - .5, z0 = cz * CHUNK - .5;
  for (let n = 0; n < SCATTER_ATTEMPTS; n++) {
    const x = x0 + rand() * CHUNK, z = z0 + rand() * CHUNK, a = rand(), b = rand(), c = rand();
    const d = terrainField(x, z);
    if (d < 1.8 || trailDistance(x, z) < 1.4) continue;
    if (Math.hypot(x - 25, z - 25) < 4) continue;
    const t = { x: Math.round(x), z: Math.round(z) };
    const biome = biomeOf(t);
    if (biome !== 'isle' && onRidge(t)) continue;
    const yaw = a * Math.PI * 2, tuft = [.22 + a * .12, .22 + b * .16, .22 + a * .12] as const;
    switch (biome) {
      case 'isle': case 'hearthvale':
        add('tuft', WHITE, x, 0, z, yaw, ...tuft);
        if (c < (biome === 'hearthvale' ? .38 : .3)) add('flower', BLOSSOMS[Math.floor(c * 97) % BLOSSOMS.length], x + .25, 0, z + .15, 0, .2 + b * .08);
        break;
      case 'frostpine':
        add('snowTuft', WHITE, x, 0, z, yaw, .3 + a * .2, .25 + b * .2, .3 + a * .2);
        if (c < .08) add('flower', STARBLOSSOMS[Math.floor(c * 97) % STARBLOSSOMS.length], x + .25, 0, z + .15, 0, .17 + b * .06);
        break;
      case 'glimmerfen':
        // Reed beds crowd the water's edge; drier hummocks get dark grass.
        if (d < 4.5 || c < .25) add('reed', WHITE, x, 0, z, yaw, .32 + a * .15, .32 + b * .25, .32 + a * .15);
        else add('tuft', FEN_GRASS, x, 0, z, yaw, ...tuft);
        break;
      case 'dunes':
        if (c < .09) add('cactus', WHITE, x, 0, z, yaw, .3 + b * .22);
        else if (c < .65) add('dryTuft', WHITE, x, 0, z, yaw, ...tuft);
        break;
      case 'starfall':
        if (c < .22) add('shard', WHITE, x, 0, z, yaw, .2 + b * .22, .25 + a * .35, .2 + b * .22);
        else if (c < .55) add('dryTuft', STONE.starfall, x, 0, z, yaw, ...tuft);
        break;
    }
    // Stones (ash rubble in Starfall) everywhere; the island keeps its old share.
    if (b < (biome === 'starfall' ? .35 : biome === 'isle' ? .12 : .15)) {
      const flat = biome === 'starfall' ? .55 : 1;
      add('stone', STONE[biome], x + .4, .04, z - .3, yaw, .12 + a * .12, (.08 + b * .04) * flat, .11 + a * .1);
    }
  }
  // Palms on warm shores: the island's coast, the dunes and Hearthvale's bays.
  for (let z = Math.ceil(z0); z < z0 + CHUNK; z++) for (let x = Math.ceil(x0); x < x0 + CHUNK; x++) {
    const biome: BiomeId = x < ISLE_SIZE && z < ISLE_SIZE ? 'isle' : biomeOf({ x, z });
    const chance = PALM_CHANCE[biome];
    if (!chance) continue;
    const d = terrainField(x, z);
    if (!(d > .2 && d < 1.1)) continue;
    const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    if (h - Math.floor(h) > chance || trailDistance(x, z) <= 2) continue;
    if (biome === 'isle' && areaOf({ x, z }) !== 'coast') continue;
    add('palm', WHITE, x, 0, z, (x * 31 + z) * 2.4, .7 + ((x + z) % 3) * .12);
  }
  const out = Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, { count: l!.mats.length / 16, matrices: Float32Array.from(l!.mats), colors: Float32Array.from(l!.cols) }])) as Partial<Record<ScatterKind, InstanceList>>;
  cache.set(key, out);
  return out;
}

/** Concatenate several chunks' lists of one kind into one instance buffer. */
export function joinLists(lists: readonly (InstanceList | undefined)[]): InstanceList {
  let count = 0;
  for (const l of lists) count += l?.count ?? 0;
  const matrices = new Float32Array(count * 16), colors = new Float32Array(count * 3);
  let at = 0;
  for (const l of lists) {
    if (!l?.count) continue;
    matrices.set(l.matrices, at * 16);
    if (l.colors) colors.set(l.colors, at * 3); else colors.fill(1, at * 3, (at + l.count) * 3);
    at += l.count;
  }
  return { count, matrices, colors };
}
