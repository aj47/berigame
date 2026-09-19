import { GRID_SIZE, TILE_ORIGIN } from './constants';
import type { Facing, Tile } from './types';

export function inBounds(t: Tile): boolean {
  return t.x >= 0 && t.x < GRID_SIZE && t.z >= 0 && t.z < GRID_SIZE;
}

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

/** The 8 surrounding tiles, in facing order (S, SW, W, NW, N, NE, E, SE), in-bounds only. */
export function neighbors8(t: Tile): Tile[] {
  const out: Tile[] = [];
  for (const [dx, dz] of DELTAS) {
    const n = { x: t.x + dx, z: t.z + dz };
    if (inBounds(n)) out.push(n);
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

/**
 * Tile the defender is pushed to when knocked back by the attacker: one step
 * directly away. Returns null when that tile is out of bounds or blocked.
 */
export function knockbackTile(defender: Tile, attacker: Tile, blocked: Set<number>): Tile | null {
  const dx = Math.sign(defender.x - attacker.x);
  const dz = Math.sign(defender.z - attacker.z);
  if (dx === 0 && dz === 0) return null;
  const t = { x: defender.x + dx, z: defender.z + dz };
  if (!inBounds(t) || blocked.has(tileKey(t))) return null;
  return t;
}
