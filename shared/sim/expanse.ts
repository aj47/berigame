/**
 * The Expanse: the shared mainland around the original island.
 *
 * The original island (Grove, Coast, Eastreach, the southern wilds and the
 * Boulders) keeps every tile in the 0..127 corner. Five biomes surround it on
 * a 256 x 256 grid, split by straits, rivers and rock ridges so the roads
 * between them are real routes: a few causeways, bridges and passes, with
 * loops so no single chokepoint can be held.
 *
 * Pure geometry shared by the server, the 3D world, the minimap and the wiki.
 * Positive field = land. Never move a published landmark, bridge or pass.
 */
import { SPAWN_TILE } from './constants';
import type { Tile } from './types';

export type BiomeId = 'isle' | 'frostpine' | 'hearthvale' | 'glimmerfen' | 'dunes' | 'starfall';

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** One line for the map and the wiki. */
  detail: string;
  /** Ground colours (sRGB hex) the terrain blends between. */
  ground: [number, number];
  /** Scenery tree style and how thick the woods grow (0..1). */
  trees: 'broadleaf' | 'pine' | 'snowpine' | 'willow' | 'palm' | 'crystal';
  woods: number;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  isle: { id: 'isle', name: 'Bramblewild', detail: 'The original island: the Grove, the Coast, Eastreach and the southern wilds.', ground: [0x578644, 0x7ca655], trees: 'broadleaf', woods: 0.5 },
  frostpine: { id: 'frostpine', name: 'Frostpine Heights', detail: 'Snowy uplands along the King’s Road, cut by the Rimewater and the Spine ridge. Starblossoms and moonstone.', ground: [0xdfe6ea, 0xb9c8cf], trees: 'snowpine', woods: 0.6 },
  hearthvale: { id: 'hearthvale', name: 'Hearthvale', detail: 'Farmland and orchards around Crossroads, the mainland’s market town. Glowcap woods inland, coral on the bays.', ground: [0x6f9c45, 0x9cbf5a], trees: 'broadleaf', woods: 0.35 },
  glimmerfen: { id: 'glimmerfen', name: 'Glimmerfen', detail: 'A drowned marsh of reed beds, willows and boardwalks south of Mossvale. Glowcaps glow on every hummock.', ground: [0x4f6b45, 0x6d8452], trees: 'willow', woods: 0.45 },
  dunes: { id: 'dunes', name: 'Sunscorch Dunes', detail: 'Hot dunes and red bluffs around the Oasis. Sunpeach groves and amber seams.', ground: [0xe2c27f, 0xd3a764], trees: 'palm', woods: 0.15 },
  starfall: { id: 'starfall', name: 'Starfall Reach', detail: 'A scorched crater where stars came down. Dreamvines climb its rim; star iron lies in the ash.', ground: [0x5b5468, 0x7a6f86], trees: 'crystal', woods: 0.25 },
};

const ellipse = (x: number, z: number, cx: number, cz: number, rx: number, rz: number) =>
  (1 - Math.hypot((x - cx) / rx, (z - cz) / rz)) * Math.min(rx, rz);
function segment(x: number, z: number, a: Tile, b: Tile): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}
function polyline(x: number, z: number, pts: readonly Tile[]): number {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segment(x, z, pts[i - 1], pts[i]));
  return d;
}
/** A lobed landmass whose shore wobbles like the original coastline. */
function lobe(x: number, z: number, cx: number, cz: number, rx: number, rz: number, phase: number): number {
  const u = (x - cx) / rx, v = (z - cz) / rz, a = Math.atan2(v, u);
  const shore = 1 + .07 * Math.sin(a * 3 + phase) + .05 * Math.cos(a * 5 - phase * 1.7) + .03 * Math.sin(a * 9 + phase * 2.3);
  return (shore - Math.hypot(u, v)) * Math.min(rx, rz);
}

/** Each biome's landmass: one or more lobes. */
const BIOME_LOBES: Record<Exclude<BiomeId, 'isle'>, readonly [number, number, number, number, number][]> = {
  frostpine: [[190, 38, 56, 30, 0.7], [232, 70, 22, 20, 2.9], [160, 62, 22, 16, 1.6]],
  hearthvale: [[184, 128, 46, 30, 3.3], [150, 112, 16, 14, 0.4], [222, 118, 20, 18, 5.1]],
  glimmerfen: [[42, 190, 38, 46, 1.9], [68, 230, 15, 13, 4.4]],
  dunes: [[128, 200, 31, 38, 2.6], [152, 236, 22, 13, 0.9]],
  starfall: [[212, 206, 36, 36, 4.0]],
};

/**
 * Causeways and land bridges: the only ways between landmasses. Width is the
 * half-width of dry ground. Ids are stable (the wiki and agents name them).
 */
export const CAUSEWAYS = [
  { id: 'kings-road', name: 'King’s Causeway', from: { x: 118, z: 25 }, to: { x: 140, z: 25 }, width: 3.6 },
  { id: 'sunfall', name: 'Sunfall Causeway', from: { x: 113, z: 111 }, to: { x: 140, z: 116 }, width: 3.2 },
  { id: 'stonepass', name: 'Stonepass', from: { x: 196, z: 66 }, to: { x: 192, z: 100 }, width: 3.4 },
  { id: 'fenway', name: 'Fenway', from: { x: 26, z: 118 }, to: { x: 32, z: 148 }, width: 3.0 },
  { id: 'dune-road', name: 'Dune Road', from: { x: 162, z: 150 }, to: { x: 140, z: 170 }, width: 3.2 },
  { id: 'reedbank', name: 'Reedbank', from: { x: 78, z: 196 }, to: { x: 92, z: 198 }, width: 3.0 },
  { id: 'ashway', name: 'Ashway', from: { x: 156, z: 214 }, to: { x: 180, z: 210 }, width: 3.0 },
  { id: 'emberstair', name: 'Emberstair', from: { x: 214, z: 146 }, to: { x: 214, z: 172 }, width: 3.0 },
] as const;

/** Rivers and lakes inside the biomes (water carves land). */
export const RIVERS: readonly { id: string; name: string; points: readonly Tile[]; width: number }[] = [
  { id: 'rimewater', name: 'Rimewater', points: [{ x: 205, z: 8 }, { x: 200, z: 22 }, { x: 206, z: 40 }, { x: 198, z: 58 }], width: 1.2 },
  { id: 'hearth', name: 'Hearthrun', points: [{ x: 196, z: 102 }, { x: 186, z: 118 }, { x: 192, z: 136 }, { x: 186, z: 158 }], width: 1.1 },
  { id: 'glimmer', name: 'Glimmer Water', points: [{ x: 40, z: 150 }, { x: 46, z: 172 }, { x: 36, z: 196 }, { x: 46, z: 222 }, { x: 40, z: 236 }, { x: 38, z: 250 }], width: 1.1 },
];
export const EXPANSE_LAKES = [
  { id: 'frostmere', x: 172, z: 34, rx: 7, rz: 4.5 },
  { id: 'millpond', x: 206, z: 132, rx: 5, rz: 3.5 },
  { id: 'fen-a', x: 26, z: 172, rx: 5, rz: 4 },
  { id: 'fen-b', x: 58, z: 184, rx: 4.5, rz: 6 },
  { id: 'fen-c', x: 24, z: 210, rx: 6, rz: 4 },
  { id: 'fen-d', x: 60, z: 214, rx: 4, rz: 3.5 },
  { id: 'oasis', x: 122, z: 198, rx: 6, rz: 5 },
  { id: 'crater', x: 214, z: 210, rx: 9, rz: 9 },
] as const;

/**
 * Bridges over the rivers (axis-aligned: `width` along x, `depth` along z),
 * like Millbridge and Willow Crossing on the island.
 */
export const EXPANSE_BRIDGES = [
  { id: 'rime-bridge', name: 'Rime Bridge', x: 200, z: 25, width: 6, depth: 2 },
  { id: 'north-ford', name: 'Northford', x: 202, z: 50, width: 6, depth: 2 },
  { id: 'hearth-bridge', name: 'Hearth Bridge', x: 188, z: 128, width: 6, depth: 2 },
  { id: 'south-bridge', name: 'Southmill Bridge', x: 189, z: 148, width: 6, depth: 2 },
  { id: 'fen-boardwalk-n', name: 'North Boardwalk', x: 45, z: 168, width: 6, depth: 2 },
  { id: 'fen-boardwalk-s', name: 'South Boardwalk', x: 39, z: 204, width: 6, depth: 2 },
] as const;

/**
 * Rock ridges: impassable walls of boulders. A pass is a gap where the ridge
 * stops. They turn open ground into routes without making it water.
 */
export const RIDGES: readonly { id: string; name: string; points: readonly Tile[]; passes: readonly Tile[] }[] = [
  { id: 'spine', name: 'the Spine', points: [{ x: 150, z: 50 }, { x: 176, z: 56 }, { x: 214, z: 52 }, { x: 240, z: 60 }], passes: [{ x: 181, z: 57 }, { x: 228, z: 56 }] },
  { id: 'redwall', name: 'the Redwall', points: [{ x: 98, z: 178 }, { x: 116, z: 186 }, { x: 140, z: 184 }, { x: 156, z: 196 }], passes: [{ x: 122, z: 186 }] },
  { id: 'cinderrim', name: 'the Cinder Rim', points: [{ x: 194, z: 186 }, { x: 214, z: 180 }, { x: 236, z: 190 }], passes: [{ x: 214, z: 180 }] },
];
const RIDGE_HALF_WIDTH = 0.9;
const PASS_RADIUS = 2.6;

/** Positive on the Expanse's own land (0 contribution in the original corner). */
export function expanseLand(x: number, z: number): number {
  let land = -Infinity;
  for (const lobes of Object.values(BIOME_LOBES)) for (const [cx, cz, rx, rz, ph] of lobes) land = Math.max(land, lobe(x, z, cx, cz, rx, rz, ph));
  for (const c of CAUSEWAYS) land = Math.max(land, c.width - segment(x, z, c.from, c.to));
  return land;
}

/** Positive inside the Expanse's rivers and lakes. */
export function expanseWater(x: number, z: number): number {
  let water = -Infinity;
  for (const r of RIVERS) water = Math.max(water, r.width - polyline(x, z, r.points));
  for (const l of EXPANSE_LAKES) water = Math.max(water, ellipse(x, z, l.x, l.z, l.rx, l.rz));
  return water;
}

export function isExpanseBridge(t: Tile): boolean {
  return EXPANSE_BRIDGES.some((b) => Math.abs(t.x - b.x) <= b.width / 2 && Math.abs(t.z - b.z) < b.depth / 2);
}

/** Ridge tiles (impassable rock), excluding the passes. */
export function onRidge(t: Tile): boolean {
  for (const r of RIDGES) {
    if (polyline(t.x, t.z, r.points) > RIDGE_HALF_WIDTH) continue;
    if (r.passes.some((p) => Math.hypot(t.x - p.x, t.z - p.z) <= PASS_RADIUS)) continue;
    return true;
  }
  return false;
}

/** Which biome a tile belongs to: the nearest lobe it is inside, else the island. */
export function biomeOf(t: Tile): BiomeId {
  if (t.x < 128 && t.z < 128) return 'isle';
  let best: BiomeId = 'isle', score = -Infinity;
  for (const [id, lobes] of Object.entries(BIOME_LOBES) as [Exclude<BiomeId, 'isle'>, (typeof BIOME_LOBES)[keyof typeof BIOME_LOBES]][]) {
    for (const [cx, cz, rx, rz, ph] of lobes) {
      const s = lobe(t.x, t.z, cx, cz, rx, rz, ph) / Math.min(rx, rz);
      if (s > score) { score = s; best = id; }
    }
  }
  return best;
}

/** The mainland's places. Ids are stable; agents and the wiki link them. */
export const EXPANSE_LANDMARKS = [
  { id: 'kingsgate', name: 'Kingsgate', short: 'Kingsgate', x: 146, z: 25, access: 'coast', detail: 'A toll-house at the end of the King’s Causeway. Frostpine starts here.' },
  { id: 'frostmere', name: 'Frostmere', short: 'Frostmere', x: 172, z: 42, access: 'coast', detail: 'A frozen lake under the Spine.' },
  { id: 'rimewatch', name: 'Rimewatch', short: 'Rimewatch', x: 222, z: 28, access: 'coast', detail: 'A watchtower over the Rimewater, on the road to the Meadows.' },
  { id: 'crossroads', name: 'Crossroads', short: 'Crossroads', x: 172, z: 124, access: 'coast', detail: 'The mainland’s market town: a ledger clerk, a drop box and a waystone.' },
  { id: 'orchards', name: 'Hearthvale Orchards', short: 'Orchards', x: 214, z: 116, access: 'coast', detail: 'Old orchards on the eastern bluffs.' },
  { id: 'fenhold', name: 'Fenhold', short: 'Fenhold', x: 34, z: 182, access: 'coast', detail: 'A stilt village in the heart of Glimmerfen.' },
  { id: 'oasis', name: 'Sunscorch Oasis', short: 'Oasis', x: 130, z: 206, access: 'coast', detail: 'Palms around the only fresh water in the dunes.' },
  { id: 'redwall-gap', name: 'Redwall Gap', short: 'Redwall Gap', x: 122, z: 190, access: 'coast', detail: 'The one way through the Redwall.' },
  { id: 'crater', name: 'Starfall Crater', short: 'Crater', x: 196, z: 220, access: 'coast', detail: 'Where the stars came down. Bring friends.' },
] as const;

/** Waystones: where a defeated character comes back, the nearest one to where they fell. */
export const WAYSTONES: readonly (Tile & { id: string; name: string })[] = [
  { id: 'kingsgate', name: 'Kingsgate waystone', x: 148, z: 29 },
  { id: 'crossroads', name: 'Crossroads waystone', x: 168, z: 128 },
  { id: 'fenhold', name: 'Fenhold waystone', x: 30, z: 186 },
  { id: 'oasis', name: 'Oasis waystone', x: 134, z: 210 },
  { id: 'crater', name: 'Crater waystone', x: 190, z: 224 },
];

/** Every place a defeated character can come back: the island spawn first, then the waystones. */
export const RESPAWN_POINTS: readonly (Tile & { id: string; name: string })[] = [
  { id: 'spawn', name: 'the Grove', x: SPAWN_TILE.x, z: SPAWN_TILE.z },
  ...WAYSTONES,
];

/**
 * Where a character defeated at `fell` comes back: the nearest respawn point by
 * Euclidean distance (straight line, not walking distance), ties to the earlier
 * entry in RESPAWN_POINTS, so the island spawn wins a tie.
 *
 * Corpse runs: the bag drops where the character fell (tick.ts phaseDeath), so
 * the nearest waystone keeps the walk back to it short on a 256-tile map. The
 * killer may still be close; the usual respawn grace covers the arrival and
 * nothing else changes. The safe ring stays around the island spawn only, so a
 * waystone is no sanctuary.
 */
export function respawnPointFor(fell: Tile): Tile & { id: string; name: string } {
  let best = RESPAWN_POINTS[0], bestD = Infinity;
  for (const p of RESPAWN_POINTS) {
    const d = (p.x - fell.x) ** 2 + (p.z - fell.z) ** 2;
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Roads across the mainland, drawn on the ground and kept clear of nodes. */
export const EXPANSE_TRAILS: readonly (readonly Tile[])[] = [
  // The King's Road continues from the harbour road to the Meadows join.
  [{ x: 128, z: 25 }, { x: 146, z: 25 }, { x: 172, z: 24 }, { x: 200, z: 25 }, { x: 222, z: 28 }, { x: 255, z: 25 }],
  // Kingsgate south over the Spine to Crossroads.
  [{ x: 172, z: 24 }, { x: 178, z: 46 }, { x: 181, z: 57 }, { x: 194, z: 66 }, { x: 192, z: 100 }, { x: 172, z: 124 }],
  // Sunfall Causeway to Crossroads, and on east to the orchards.
  [{ x: 113, z: 111 }, { x: 140, z: 116 }, { x: 156, z: 118 }, { x: 172, z: 124 }, { x: 188, z: 128 }, { x: 214, z: 116 }],
  // Crossroads south to the dunes and the crater.
  [{ x: 172, z: 124 }, { x: 166, z: 140 }, { x: 162, z: 150 }, { x: 140, z: 170 }, { x: 130, z: 182 }, { x: 122, z: 190 }, { x: 130, z: 206 }, { x: 156, z: 214 }, { x: 180, z: 210 }, { x: 196, z: 220 }],
  // The orchards down the Emberstair to the crater.
  [{ x: 214, z: 116 }, { x: 214, z: 146 }, { x: 214, z: 172 }, { x: 214, z: 180 }, { x: 206, z: 196 }],
  // Mossvale down the Fenway to Fenhold, and east over the Reedbank to the dunes.
  [{ x: 24, z: 114 }, { x: 26, z: 118 }, { x: 32, z: 148 }, { x: 45, z: 168 }, { x: 34, z: 182 }, { x: 39, z: 204 }, { x: 60, z: 198 }, { x: 78, z: 196 }, { x: 92, z: 198 }, { x: 110, z: 200 }, { x: 130, z: 206 }],
];
