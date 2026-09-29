import { BOULDERS_MIN, GRID_SIZE, ISLAND_SIZE, TILE_ORIGIN } from './constants';
import type { Facing, Tile } from './types';

export function inBounds(t: Tile): boolean {
  return t.x >= 0 && t.x < GRID_SIZE && t.z >= 0 && t.z < GRID_SIZE;
}

/**
 * Land, not water: the original island square, or the Boulders L past its
 * south-east shoreline (both coordinates >= BOULDERS_MIN). Everything else in
 * the grown grid is sea that nothing walks on.
 */
export function isLandTile(t: Tile): boolean {
  if (!inBounds(t)) return false;
  if (t.x < ISLAND_SIZE && t.z < ISLAND_SIZE) return true;
  return t.x >= BOULDERS_MIN && t.z >= BOULDERS_MIN;
}

/** LAND_MASK[tileKey] === 1 for land tiles, for tight loops (BFS). */
export const LAND_MASK: Uint8Array = (() => {
  const m = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) if (isLandTile({ x, z })) m[z * GRID_SIZE + x] = 1;
  return m;
})();

export function clampTile(t: Tile): Tile {
  return {
    x: Math.min(GRID_SIZE - 1, Math.max(0, t.x)),
    z: Math.min(GRID_SIZE - 1, Math.max(0, t.z)),
  };
}

/** Tile -> world position of the tile centre (y is always 0). */
export function tileToWorld(t: Tile): [number, number, number] {
  return [t.x - TILE_ORIGIN, 0, t.z - TILE_ORIGIN];
}

/** World x/z -> nearest tile, clamped into the grid. */
export function worldToTile(x: number, z: number): Tile {
  return clampTile({ x: Math.round(x + TILE_ORIGIN), z: Math.round(z + TILE_ORIGIN) });
}

/** Dense integer key for Sets/Maps. */
export function tileKey(t: Tile): number {
  return t.z * GRID_SIZE + t.x;
}

export function tileEquals(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.z === b.z;
}

export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

const DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1],
];

/** The 8 surrounding tiles, in facing order (S, SW, W, NW, N, NE, E, SE), land only. */
export function neighbors8(t: Tile): Tile[] {
  const out: Tile[] = [];
  for (const [dx, dz] of DELTAS) {
    const n = { x: t.x + dx, z: t.z + dz };
    if (isLandTile(n)) out.push(n);
  }
  return out;
}

/** Facing code for a movement delta (signs only matter). */
export function facingFromDelta(dx: number, dz: number): Facing {
  const sx = Math.sign(dx);
  const sz = Math.sign(dz);
  for (let i = 0; i < DELTAS.length; i++) {
    if (DELTAS[i][0] === sx && DELTAS[i][1] === sz) return i as Facing;
  }
  return 0;
}

/** Yaw (radians, around +y) that makes a model whose forward is +z look along the facing. */
export function facingToYaw(f: Facing): number {
  const [dx, dz] = DELTAS[f];
  return Math.atan2(dx, dz);
}

export function blockedSetFromTiles(tiles: Iterable<Tile>): Set<number> {
  const s = new Set<number>();
  for (const t of tiles) s.add(tileKey(t));
  return s;
}
