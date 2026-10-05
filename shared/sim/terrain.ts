/** The island's single terrain definition: used by the server, 3D world and map. */
import { GRID_SIZE } from './constants';
import type { Tile } from './types';

export const TERRAIN_VERSION = 'bramblewild-expanse-v1';
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
  // A grassy headland, wide enough for the harbour road, leads out to Eastreach.
  land = Math.max(land, 4.5 - segmentDistance(x, z, { x: 46, z: 25 }, { x: 65, z: 25 }), outerLandField(x, z));
  let water = ellipse(x, z, 17, 13, 3.2, 2.8);
  for (let i = 1; i < BROOK.length; i++) water = Math.max(water, 1.05 - segmentDistance(x, z, BROOK[i - 1], BROOK[i]));
  for (const lake of OUTER_LAKES) water = Math.max(water, ellipse(x, z, lake.x, lake.z, lake.rx, lake.rz));
  // The harbour road crosses the east shore into the Meadows.
  return Math.min(land, -water, x + .4, z + .4, (x >= MEADOW_SEAM_X && Math.abs(z-25) <= 4.5 ? Infinity : GRID_SIZE - .5 - x), GRID_SIZE - .6 - z);
}
/** A lobed landmass whose shore wobbles like the original coastline. */
function lobe(x: number, z: number, cx: number, cz: number, rx: number, rz: number, phase: number): number {
  const u = (x - cx) / rx, v = (z - cz) / rz, a = Math.atan2(v, u);
  const shore = 1 + .07 * Math.sin(a * 3 + phase) + .05 * Math.cos(a * 5 - phase * 1.7) + .03 * Math.sin(a * 9 + phase * 2.3);
  return (shore - Math.hypot(u, v)) * Math.min(rx, rz);
}
const MEADOW_SEAM_X = GRID_SIZE - 16;
/** Inland lakes of the outer lands; they never cut a land bridge. */
export const OUTER_LAKES = [
  { id: 'tarn', x: 104, z: 33, rx: 4.5, rz: 3 },
  { id: 'reedmere', x: 40, z: 104, rx: 6, rz: 4 },
  { id: 'sunfall', x: 99, z: 107, rx: 5, rz: 3.5 },
] as const;
/**
 * Eastreach and the southern wilds: three times the original island again.
 * Every lobe stays four tiles of open water clear of the Giant's headland, so
 * the Boulders keep their single boulder-line entrance.
 */
export function outerLandField(x: number, z: number): number {
  return Math.max(
    lobe(x, z, 97, 26, 25, 22, 1.1),
    lobe(x, z, 35, 97, 27, 25, 2.3),
    lobe(x, z, 93, 99, 30, 25, 4.1),
    ellipse(x, z, 64, 95, 15, 12),
    3.6 - segmentDistance(x, z, { x: 60, z: 25 }, { x: 78, z: 25 }),
    3.8 - segmentDistance(x, z, { x: 21, z: 45 }, { x: 17, z: 58 }),
    3.8 - segmentDistance(x, z, { x: 17, z: 58 }, { x: 20, z: 74 }),
    4.2 - segmentDistance(x, z, { x: 108, z: 40 }, { x: 104, z: 80 }),
    4.5 - segmentDistance(x, z, { x: MEADOW_SEAM_X, z: 25 }, { x: GRID_SIZE + 1, z: 25 }),
  );
}
/** The Giant's headland: the only place the boulder line and the Boulders exist. */
export function inGiantHeadland(t: Tile): boolean {
  return t.x >= 30 && t.z >= 32 && t.x < 66 && t.z < 66;
}
/** Whole tiles are sampled once: movement rules ask about the same tiles every tick. */
let landTiles: Uint8Array | undefined;
export function terrainLand(t: Tile): boolean {
  if (!(t.x >= 0 && t.z >= 0 && t.x < GRID_SIZE && t.z < GRID_SIZE)) return false;
  if (!Number.isInteger(t.x) || !Number.isInteger(t.z)) return terrainField(t.x, t.z) >= 0 || isBridge(t);
  if (!landTiles) {
    landTiles = new Uint8Array(GRID_SIZE * GRID_SIZE);
    for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++)
      if (terrainField(x, z) >= 0 || isBridge({ x, z })) landTiles[z * GRID_SIZE + x] = 1;
  }
  return landTiles[t.z * GRID_SIZE + t.x] === 1;
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
  { id: 'eastreach', name: 'Eastreach Heath', short: 'Eastreach', x: 88, z: 16, access: 'coast', detail: 'Open heath past the harbour road, with berry thickets and driftwood bays.' },
  { id: 'tarn', name: 'Mirror Tarn', short: 'Tarn', x: 97, z: 33, access: 'coast', detail: 'A still upland lake ringed by pines.' },
  { id: 'saltmarsh', name: 'Saltmarsh Causeway', short: 'Causeway', x: 18, z: 62, access: 'coast', detail: 'A narrow land bridge south to Mossvale.' },
  { id: 'mossvale', name: 'Mossvale Wood', short: 'Mossvale', x: 28, z: 92, access: 'coast', detail: 'Deep southern woods around Reedmere lake.' },
  { id: 'hollow', name: 'Bramble Hollow', short: 'Hollow', x: 64, z: 92, access: 'coast', detail: 'A sheltered dell where the southern wilds meet.' },
  { id: 'sunfall', name: 'Sunfall Bluffs', short: 'Sunfall', x: 106, z: 96, access: 'coast', detail: 'Wind-bent bluffs above the far south-east shore.' },
] as const;
export const TRAILS: readonly (readonly Tile[])[] = [
  [{ x: 25, z: 5 }, { x: 25, z: 11 }, { x: 27, z: 18 }, { x: 25, z: 25 }],
  [{ x: 46, z: 29 }, { x: 49, z: 25 }, { x: 64, z: 25 }, { x: 80, z: 25 }, { x: 100, z: 25 }, { x: GRID_SIZE - 1, z: 25 }],
  [{ x: 25, z: 25 }, { x: 32, z: 27 }, { x: 39, z: 26 }, { x: 46, z: 29 }],
  [{ x: 25, z: 25 }, { x: 29, z: 32 }, { x: 35, z: 37 }, { x: 41, z: 40 }, { x: 45, z: 46 }, { x: 52, z: 52 }],
  [{ x: 25, z: 25 }, { x: 23, z: 23 }, { x: 20, z: 22 }, { x: 14, z: 22 }, { x: 12, z: 24 }, { x: 7, z: 25 }, { x: 3, z: 25 }],
  [{ x: 23, z: 21 }, { x: 22, z: 18 }, { x: 21, z: 16 }, { x: 21, z: 11 }],
  [{ x: 25, z: 25 }, { x: 20, z: 29 }, { x: 14, z: 30 }, { x: 7, z: 30 }, { x: 7, z: 36 }, { x: 12, z: 36 }, { x: 20, z: 37 }, { x: 25, z: 42 }, { x: 25, z: 46 }],
  // The outer loop: Eastreach, the far-east land bridge, the southern wilds and the causeway home.
  [{ x: 100, z: 25 }, { x: 108, z: 40 }, { x: 106, z: 60 }, { x: 104, z: 80 }, { x: 94, z: 94 }, { x: 70, z: 94 }, { x: 46, z: 94 }, { x: 28, z: 88 }, { x: 20, z: 74 }, { x: 17, z: 58 }, { x: 21, z: 46 }, { x: 25, z: 46 }],
  [{ x: 88, z: 25 }, { x: 88, z: 16 }, { x: 80, z: 9 }],
  [{ x: 94, z: 94 }, { x: 106, z: 96 }, { x: 112, z: 110 }],
  [{ x: 28, z: 88 }, { x: 18, z: 100 }, { x: 24, z: 114 }],
  [{ x: 70, z: 94 }, { x: 72, z: 112 }],
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
    if (!terrainLand({ x, z }) || blocked.has(z * GRID_SIZE + x) || groveBoundary({ x, z }) || (inGiantHeadland({ x, z }) && Math.max(x, z) === 50)) continue;
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
].map(([x,z]) => ({x,z})).filter(t => terrainField(t.x,t.z) > 1 && !groveBoundary(t) && trailDistance(t.x,t.z) > 1.25)
  .concat(outerForest());
/**
 * Woods for the outer lands on a jittered four-tile lattice: thick in Mossvale
 * and around the tarn, scattered on the open heath. Deterministic, so the server
 * and every client agree on each trunk.
 */
function outerForest(): Tile[] {
  const out: Tile[] = [];
  const hash = (x: number, z: number) => { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); };
  for (let gz = 0; gz < GRID_SIZE / 4; gz++) for (let gx = 0; gx < GRID_SIZE / 4; gx++) {
    const t = { x: gx * 4 + 1 + Math.floor(hash(gx, gz) * 3), z: gz * 4 + 1 + Math.floor(hash(gz + 41, gx) * 3) };
    if (t.x < 64 && t.z < 64 && !(t.x < 24 && t.z >= 44)) continue;
    const woods = .5 + .35 * Math.sin(t.x * .11 + 1.3) * Math.cos(t.z * .09 - .4) + .2 * Math.sin((t.x + t.z) * .05);
    if (hash(t.x + 7, t.z + 13) > woods) continue;
    if (outerLandField(t.x, t.z) < 2.2 || terrainField(t.x, t.z) < 2.2 || trailDistance(t.x, t.z) < 2.5) continue;
    if (LANDMARKS.some(l => Math.max(Math.abs(l.x - t.x), Math.abs(l.z - t.z)) < 4)) continue;
    out.push(t);
  }
  return out;
}
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
