/** The island's single terrain definition: used by the server, 3D world and map. */
import { GRID_SIZE } from './constants';
import type { Tile } from './types';

export const TERRAIN_VERSION = 'connected-meadows-v2';
export const ISLAND_NAME = 'Bramblewild';
const ellipse = (x: number, z: number, cx: number, cz: number, rx: number, rz: number) =>
  (1 - Math.hypot((x - cx) / rx, (z - cz) / rz)) * Math.min(rx, rz);
export function segmentDistance(x: number, z: number, a: Tile, b: Tile): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}
export const BROOK: readonly Tile[] = [
  { x: 18, z: 14 }, { x: 18, z: 18 }, { x: 17, z: 22 }, { x: 14, z: 25 },
  { x: 11, z: 28 }, { x: 9, z: 32 }, { x: 6, z: 34 }, { x: 2, z: 35 },
];
export const BRIDGES = [
  { id: 'mill', name: 'Millbridge', x: 17, z: 22, width: 6, depth: 2 },
  { id: 'willow', name: 'Willow Crossing', x: 10, z: 30, width: 6, depth: 2 },
] as const;
export function isBridge(t: Tile): boolean {
  return BRIDGES.some(b => Math.abs(t.x - b.x) <= b.width / 2 && Math.abs(t.z - b.z) < b.depth / 2);
}
/** Positive on solid ground; negative in ocean, lake and river. Also supports fractional coordinates. */
export function terrainField(x: number, z: number): number {
  const a = Math.atan2(z - 25, x - 25);
  const radius = 22.8 + Math.sin(a * 3 + .4) * 1.3 + Math.cos(a * 5 - .5) * .9;
  let land = Math.max(radius - Math.hypot(x - 25, z - 25),
    ellipse(x, z, 25, 5, 6, 5.5), ellipse(x, z, 5, 25, 4, 7),
    ellipse(x, z, 46, 26, 4, 8), ellipse(x, z, 25, 45, 7, 5));
  // Sheltered coves break up the shore; the south-east headlands lead to the Giant.
  land = Math.min(land, -ellipse(x, z, 4, 9, 7, 7), -ellipse(x, z, 45, 5, 8, 6),
    -ellipse(x, z, 49, 38, 5, 5), -ellipse(x, z, 4, 44, 6, 5));
  land = Math.max(land, ellipse(x, z, 54, 54, 9, 9), ellipse(x, z, 58, 44, 5, 8),
    ellipse(x, z, 43, 58, 8, 5), ellipse(x, z, 46, 46, 8, 8));
  // A grassy headland, wide enough for the harbour road, reaches the Meadows seam.
  land = Math.max(land, 4.5 - segmentDistance(x, z, { x: 46, z: 25 }, { x: 65, z: 25 }));
  let water = ellipse(x, z, 17, 13, 3.2, 2.8);
  for (let i = 1; i < BROOK.length; i++) water = Math.max(water, 1.05 - segmentDistance(x, z, BROOK[i - 1], BROOK[i]));
  return Math.min(land, -water, x + .4, z + .4, (x >= 46 && Math.abs(z-25) <= 4.5 ? Infinity : GRID_SIZE - .5 - x), GRID_SIZE - .6 - z);
}
export function terrainLand(t: Tile): boolean {
  return t.x >= 0 && t.z >= 0 && t.x < GRID_SIZE && t.z < GRID_SIZE && (terrainField(t.x, t.z) >= 0 || isBridge(t));
}
/** Rounded woodland boundary. The familiar cardinal crossings stay in place. */
export function insideGrove(t: Tile): boolean {
  return (Math.abs(t.x - 25) / 17) ** 2.8 + (Math.abs(t.z - 25) / 17) ** 2.8 <= 1.001;
}
export function groveBoundary(t: Tile): boolean {
  if (!terrainLand(t) || !insideGrove(t)) return false;
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !insideGrove({ x: t.x + dx, z: t.z + dz }));
}
export const LANDMARKS = [
  { id: 'camp', name: 'Trailhead Camp', short: 'Camp', x: 22, z: 18, access: 'grove', detail: 'Start an expedition and meet your travelling companions.' },
  { id: 'mill', name: 'Old Brook Mill', short: 'Old Mill', x: 20, z: 16, access: 'grove', detail: 'Follow the waterwheel down to Millbridge.' },
  { id: 'pool', name: 'Starfall Pool', short: 'Starfall Pool', x: 20, z: 11, access: 'grove', detail: 'A quiet spring above the winding brook.' },
  { id: 'willow', name: 'Willow Crossing', short: 'Willow Bridge', x: 12, z: 30, access: 'grove', detail: 'The long way round to the feast clearing.' },
  { id: 'feast', name: 'Lantern Clearing', short: 'Feast', x: 12, z: 36, access: 'grove', detail: 'Bring a giant berry to the woodland feast.' },
  { id: 'market', name: 'Sunberry Market', short: 'Market', x: 35, z: 37, access: 'grove', detail: 'Deliver your expedition berry here.' },
  { id: 'harbour', name: 'Driftwood Harbour', short: 'Harbour', x: 46, z: 29, access: 'coast', detail: 'Fishing boats, tide rocks and the coast road.' },
  { id: 'beacon', name: 'Northwatch Beacon', short: 'Beacon', x: 25, z: 5, access: 'coast', detail: 'A lookout above the northern beach.' },
  { id: 'ruins', name: 'Tumbledown Ruins', short: 'Ruins', x: 45, z: 46, access: 'coast', detail: 'Broken arches mark the route into the highlands.' },
  { id: 'giant', name: 'Giant’s Headland', short: 'The Giant', x: 54, z: 54, access: 'boulders', detail: 'Obsidian shores and the sleeping raid Giant.' },
] as const;
export const TRAILS: readonly (readonly Tile[])[] = [
  [{ x: 25, z: 5 }, { x: 25, z: 11 }, { x: 27, z: 18 }, { x: 25, z: 25 }],
  [{ x: 46, z: 29 }, { x: 49, z: 25 }, { x: 64, z: 25 }],
  [{ x: 25, z: 25 }, { x: 32, z: 27 }, { x: 39, z: 26 }, { x: 46, z: 29 }],
  [{ x: 25, z: 25 }, { x: 29, z: 32 }, { x: 35, z: 37 }, { x: 41, z: 40 }, { x: 45, z: 46 }, { x: 52, z: 52 }],
  [{ x: 25, z: 25 }, { x: 23, z: 23 }, { x: 20, z: 22 }, { x: 14, z: 22 }, { x: 12, z: 24 }, { x: 7, z: 25 }, { x: 3, z: 25 }],
  [{ x: 23, z: 21 }, { x: 22, z: 18 }, { x: 21, z: 16 }, { x: 21, z: 11 }],
  [{ x: 25, z: 25 }, { x: 20, z: 29 }, { x: 14, z: 30 }, { x: 7, z: 30 }, { x: 7, z: 36 }, { x: 12, z: 36 }, { x: 20, z: 37 }, { x: 25, z: 42 }, { x: 25, z: 46 }],
];
export function trailDistance(x: number, z: number): number {
  let d = Infinity;
  for (const trail of TRAILS) for (let i = 1; i < trail.length; i++) d = Math.min(d, segmentDistance(x, z, trail[i - 1], trail[i]));
  return d;
}
/** Deterministic recovery for saved positions covered by the new coastline. */
export function nearestDryTile(from: Tile, blocked: ReadonlySet<number> = new Set()): Tile {
  let best = { x: 25, z: 25 }, distance = Infinity;
  for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) {
    if (!terrainLand({ x, z }) || blocked.has(z * GRID_SIZE + x) || groveBoundary({ x, z }) || Math.max(x, z) === 50) continue;
    const d = (from.x - x) ** 2 + (from.z - z) ** 2;
    if (d < distance) { best = { x, z }; distance = d; }
  }
  return best;
}

/** Trunks and building footprints are real obstacles; their canopies may overhang paths. */
export const FOREST_TREES: readonly Tile[] = [
  [12,16],[11,19],[13,18],[12,22],[11,26],[10,35],[14,38],[17,39],
  [16,34],[19,34],[18,36],[22,35],[32,12],[35,14],[37,17],[38,20],
  [35,21],[40,23],[38,31],[37,33],[33,40],[30,38],[28,41],
  [28,12],[29,15],[30,18],[32,19],[11,12],[13,10],[36,10],
  [15,9],[32,9],[40,16],[18,41],[8,38],[42,33],[44,24],
].map(([x,z]) => ({x,z})).filter(t => terrainField(t.x,t.z) > 1 && !groveBoundary(t) && trailDistance(t.x,t.z) > 1.25);
export const SCENERY_BLOCKERS: readonly Tile[] = [
  ...FOREST_TREES,
  ...[13,14,15].flatMap(z => [20,21,22].map(x => ({x,z}))),
  {x:27,z:4}, {x:27,z:5},
  {x:43,z:45}, {x:47,z:45}, {x:43,z:48}, {x:47,z:48},
];

/** Compact machine-readable map; x is the column, z the row. */
export const TERRAIN_MAP = {
  name: ISLAND_NAME, version: TERRAIN_VERSION, landmarks: LANDMARKS, bridges: BRIDGES,
  legend: '. ground, ~ water, = bridge, # brambles; static obstacles are listed separately',
  rows: Array.from({ length: GRID_SIZE }, (_, z) => Array.from({ length: GRID_SIZE }, (_, x) =>
    !terrainLand({ x, z }) ? '~' : groveBoundary({ x, z }) ? '#' : isBridge({ x, z }) ? '=' : '.').join('')),
  obstacles: SCENERY_BLOCKERS,
};
