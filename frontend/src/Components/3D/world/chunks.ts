import { GRID_SIZE, SPAWN_TILE } from '@sim';
import { homePoint } from '../../../../../shared/sim/frontier/homeMap';

/**
 * The world is cut into square chunks of tiles. Terrain, trees, ridges, props
 * and ground cover are built and mounted per chunk, only near the local
 * player, so the 256-tile map never sits in one undrawable, uncullable mesh.
 *
 * The player's position is first quantized to a view cell, so the chunk lists
 * are recomputed only when you cross a cell edge, never on every step.
 */
export const CHUNK = 32;
export const CHUNKS_PER_SIDE = GRID_SIZE / CHUNK;
export const VIEW_CELL = 8;

/**
 * How far (tiles, from your view cell to the chunk's edge) each layer is mounted.
 * The fog runs 55..150 from a follow camera at most ~31 tiles behind you, so
 * the terrain reaches the fog's end (unmounted land would show as ocean foam);
 * tall trees and props go out to where the fog is mostly closed; ground cover
 * stays close.
 */
export const VIEW_RADIUS = {
  terrain: 150,
  /** Inside this the terrain is built at half-tile resolution, beyond it at one tile. */
  terrainFine: 64,
  trees: 104,
  props: 120,
  scatter: 44,
} as const;
/** A chunk stays cached until it is this much further out than its layer's radius. */
export const KEEP_MARGIN = 32;

export interface ChunkRef { cx: number; cz: number; key: string; /** Tiles from the view cell to the chunk's edge (0 inside). */ dist: number }

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;
export const chunkOf = (x: number, z: number) => ({
  cx: Math.max(0, Math.min(CHUNKS_PER_SIDE - 1, Math.floor((x + 0.5) / CHUNK))),
  cz: Math.max(0, Math.min(CHUNKS_PER_SIDE - 1, Math.floor((z + 0.5) / CHUNK))),
});
export const chunkKeyOf = (x: number, z: number) => { const c = chunkOf(x, z); return chunkKey(c.cx, c.cz); };

/** Your view cell ("cx,cz" of VIEW_CELL tiles) in Bramblewild's frame, clamped onto the grid; spawn's with no row. */
export function viewCellOf(me: { x: number; z: number; region?: string } | null | undefined): string {
  const p = me ? homePoint(me, me.region ?? 'bramblewild') : SPAWN_TILE;
  const x = Math.max(0, Math.min(GRID_SIZE - 1, p.x)), z = Math.max(0, Math.min(GRID_SIZE - 1, p.z));
  return `${Math.floor(x / VIEW_CELL)},${Math.floor(z / VIEW_CELL)}`;
}

/** Distance between the view cell's tile rectangle and a chunk's (0 when they overlap). */
function cellChunkDistance(cell: string, cx: number, cz: number): number {
  const [vx, vz] = cell.split(',').map(Number);
  const ax0 = vx * VIEW_CELL, ax1 = ax0 + VIEW_CELL, az0 = vz * VIEW_CELL, az1 = az0 + VIEW_CELL;
  const bx0 = cx * CHUNK - 0.5, bx1 = bx0 + CHUNK, bz0 = cz * CHUNK - 0.5, bz1 = bz0 + CHUNK;
  const dx = Math.max(0, bx0 - ax1, ax0 - bx1), dz = Math.max(0, bz0 - az1, az0 - bz1);
  return Math.hypot(dx, dz);
}

/**
 * Chunks within `radius` tiles of the view cell, nearest first. A null cell
 * (no game connection: the dev map review) means every chunk.
 */
export function chunksNear(cell: string | null, radius: number): ChunkRef[] {
  const out: ChunkRef[] = [];
  for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
    const dist = cell === null ? 0 : cellChunkDistance(cell, cx, cz);
    if (dist <= radius) out.push({ cx, cz, key: chunkKey(cx, cz), dist });
  }
  return out.sort((a, b) => a.dist - b.dist || a.cz - b.cz || a.cx - b.cx);
}

/** Group items by the chunk their tile falls in. */
export function bucketByChunk<T extends { x: number; z: number }>(items: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = chunkKeyOf(item.x, item.z);
    let list = out.get(key);
    if (!list) out.set(key, list = []);
    list.push(item);
  }
  return out;
}

/** Deterministic hash in [0,1) for a lattice point. */
export function hash2(x: number, z: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
