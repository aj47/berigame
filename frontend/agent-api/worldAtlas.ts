import {
  BRIDGES, GRID_SIZE, ISLE_SIZE, LANDMARKS, SCENERY_BLOCKERS, SPAWN_TILE, TERRAIN_MAP, TERRAIN_VERSION, TIER_BIOMES, TIER_NODES, TRAILS, type Tile,
} from '../../shared/sim';
import { BIOMES, CAUSEWAYS, EXPANSE_BRIDGES, RIDGES, RIVERS, WAYSTONES, biomeOf, type BiomeId } from '../../shared/sim/expanse';

/**
 * GET /world: the whole map in one static, compact read. /state carries world.map (rows and obstacles in their old
 * shape) only on GET /state?map=1, for one release; this adds biomes, routes and waystones and run-length encodes the
 * grids, so an agent fetches it once per TERRAIN_VERSION instead of reading 80 KB of map with every poll. Pure and memoised.
 */
export const WORLD_ATLAS_VERSION = 1;

/** One letter per biome in biomeRows. */
export const BIOME_LETTERS: Record<BiomeId, string> = { isle: 'b', frostpine: 'f', hearthvale: 'h', glimmerfen: 'g', dunes: 'd', starfall: 's' };

const biomeCache = new Map<number, BiomeId>();
/** The biome of a tile (expanse.ts biomeOf), cached: nodes and players ask for the same tiles every poll. */
export function biomeAt(t: Tile): BiomeId {
  const key = t.z * GRID_SIZE + t.x;
  let b = biomeCache.get(key);
  if (!b) { b = biomeOf(t); if (biomeCache.size < 1 << 16) biomeCache.set(key, b); }
  return b;
}

/** Run-length encode a row: a count before each character, e.g. "12~40." is 12 water tiles then 40 ground. */
export function encodeRuns(row: string): string {
  let out = '';
  for (let i = 0; i < row.length;) {
    let j = i + 1;
    while (j < row.length && row[j] === row[i]) j++;
    out += `${j - i}${row[i]}`;
    i = j;
  }
  return out;
}
/** Inverse of encodeRuns. */
export function decodeRuns(runs: string): string {
  return runs.replace(/(\d+)(\D)/g, (_, n: string, c: string) => c.repeat(Number(n)));
}

/** Column ranges per row: "3-7,12" means x 3 to 7 and x 12. */
function columnRuns(xs: number[]): string {
  const sorted = [...new Set(xs)].sort((a, b) => a - b), parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(',');
}

function riverAt(t: Tile): string {
  let best = '', bestD = Infinity;
  for (const r of RIVERS) for (const p of r.points) {
    const d = Math.hypot(p.x - t.x, p.z - t.z);
    if (d < bestD) { best = r.id; bestD = d; }
  }
  return best;
}

let atlas: ReturnType<typeof buildAtlas> | undefined;
export function worldAtlas() { return atlas ??= buildAtlas(); }

function buildAtlas() {
  const biomeRows = TERRAIN_MAP.rows.map((row, z) => encodeRuns([...row].map((c, x) => c === '~' ? '~' : BIOME_LETTERS[biomeAt({ x, z })]).join('')));
  const byRow: number[][] = Array.from({ length: GRID_SIZE }, () => []);
  for (const o of SCENERY_BLOCKERS) byRow[o.z]?.push(o.x);
  const ids = Object.keys(BIOMES) as BiomeId[];
  return {
    v: WORLD_ATLAS_VERSION, name: TERRAIN_MAP.name, version: TERRAIN_VERSION, gridSize: GRID_SIZE,
    isle: { x0: 0, z0: 0, size: ISLE_SIZE, rule: 'The original island keeps every tile it had; the Expanse lies outside this corner.' },
    spawn: { ...SPAWN_TILE },
    legend: {
      rows: `${TERRAIN_MAP.legend}. Each entry of rows is one z (row), run-length encoded: a count then a character, e.g. "12~40." is 12 water tiles then 40 ground; decoded, character x is column x.`,
      biomeRows: `Same encoding; ${ids.map(id => `${BIOME_LETTERS[id]} ${id}`).join(', ')}, ~ water.`,
      obstacles: 'obstacles[z] lists the blocked columns in row z as ranges ("3-7,12" is x 3..7 and x 12): forest trunks, ridge boulders, standing stones and gates. Nodes block their tile too; read them from /state nodes.',
    },
    rows: TERRAIN_MAP.rows.map(encodeRuns),
    biomeRows,
    obstacles: byRow.map(columnRuns),
    biomes: ids.map(id => ({ id, name: BIOMES[id].name, detail: BIOMES[id].detail,
      tiers: TIER_BIOMES.flatMap((b, i) => b.includes(id) ? [i + 1] : []),
      nodeKinds: TIER_NODES.filter(d => TIER_BIOMES[d.tier - 1].includes(id)).map(d => d.key),
      waystone: WAYSTONES.find(w => biomeAt(w) === id)?.id ?? null })),
    landmarks: LANDMARKS.map(l => ({ id: l.id, name: l.name, tile: { x: l.x, z: l.z }, biome: biomeAt(l), detail: l.detail })),
    waystones: WAYSTONES.map(w => ({ id: w.id, name: w.name, tile: { x: w.x, z: w.z }, biome: biomeAt(w) })),
    routes: {
      rule: 'Straits, rivers and ridges divide the map. Causeways are the only land between landmasses, bridges the only dry crossings of a river, passes the only gaps in a ridge.',
      causeways: CAUSEWAYS.map(c => ({ id: c.id, name: c.name, from: { ...c.from }, to: { ...c.to }, halfWidth: c.width, connects: [biomeAt(c.from), biomeAt(c.to)] })),
      bridges: [
        ...BRIDGES.map(b => ({ id: b.id, name: b.name, tile: { x: b.x, z: b.z }, width: b.width, depth: b.depth, river: 'brook', biome: 'isle' as BiomeId })),
        ...EXPANSE_BRIDGES.map(b => ({ id: b.id, name: b.name, tile: { x: b.x, z: b.z }, width: b.width, depth: b.depth, river: riverAt(b), biome: biomeAt(b) })),
      ],
      ridges: RIDGES.map(r => ({ id: r.id, name: r.name, points: r.points.map(p => ({ ...p })), passes: r.passes.map(p => ({ ...p })), biome: biomeAt(r.passes[0]) })),
      rivers: RIVERS.map(r => ({ id: r.id, name: r.name, points: r.points.map(p => ({ ...p })) })),
      roads: TRAILS.map(t => t.map(p => ({ x: p.x, z: p.z }))),
    },
  };
}
