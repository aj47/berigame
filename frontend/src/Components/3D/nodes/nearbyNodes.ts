import { SPAWN_TILE, isBerryNode } from '@sim';
import { homePoint } from '../../../../../shared/sim/frontier/homeMap';

/**
 * Only gathering nodes near you are mounted (berry trees always are: there are
 * few and the Meadows and minimap expect them). Your position is quantized to
 * a cell first, so the list is refiltered only when you cross a cell edge,
 * not on every step or tick.
 */
export const NODE_VIEW_RADIUS = 36;
export const NODE_VIEW_CELL = 8;

/** Your view cell as a stable key ("cx,cz" in the joined home frame); spawn's while you have no row. */
export function nodeViewCell(me: { x: number; z: number; region?: string } | null | undefined): string {
  const p = me ? homePoint(me, me.region ?? 'bramblewild') : SPAWN_TILE;
  return `${Math.floor(p.x / NODE_VIEW_CELL)},${Math.floor(p.z / NODE_VIEW_CELL)}`;
}

/**
 * Nodes to mount for a view cell: every berry tree, and every other node within
 * NODE_VIEW_RADIUS (Chebyshev) of anywhere in the cell, so a node inside the
 * radius of your exact tile is always included.
 */
export function nearbyNodes<T extends { x: number; z: number; kind?: number }>(nodes: readonly T[], cell: string): T[] {
  const [cx, cz] = cell.split(',').map(Number);
  const minX = cx * NODE_VIEW_CELL - NODE_VIEW_RADIUS, maxX = (cx + 1) * NODE_VIEW_CELL - 1 + NODE_VIEW_RADIUS;
  const minZ = cz * NODE_VIEW_CELL - NODE_VIEW_RADIUS, maxZ = (cz + 1) * NODE_VIEW_CELL - 1 + NODE_VIEW_RADIUS;
  return nodes.filter((n) => isBerryNode(n) || (n.x >= minX && n.x <= maxX && n.z >= minZ && n.z <= maxZ));
}
