import { PIECES, type Point } from './catalog';
import type { Building } from './model';

type Placement = Pick<Building, 'piece' | 'region' | 'x' | 'z' | 'rotation' | 'edge'>;
const SIDES = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }] as const;
export const BUILDING_SIDES = ['south', 'east', 'north', 'west'] as const;
export const isEdgeBuilding = (b: Pick<Placement, 'piece' | 'edge'>) => !!b.edge && !!PIECES[b.piece]?.edge;
const cellKey = (p: Point) => `${p.x},${p.z}`;
export function boundaryKey(a: Point, b: Point): string {
  return `edge:${[cellKey(a), cellKey(b)].sort().join(':')}`;
}
export function buildingBoundary(b: Placement): string | undefined {
  if (!isEdgeBuilding(b)) return;
  const side = SIDES[b.rotation];
  return boundaryKey(b, { x: b.x + side.x, z: b.z + side.z });
}
/** Opposite sides of adjacent floors describe the same physical boundary. */
export function buildingsOverlap(a: Placement, b: Placement): boolean {
  if (a.region !== b.region) return false;
  const aEdge = buildingBoundary(a), bEdge = buildingBoundary(b);
  if (aEdge || bEdge) return !!aEdge && aEdge === bEdge;
  return a.x === b.x && a.z === b.z && PIECES[a.piece]?.layer === PIECES[b.piece]?.layer;
}
/** Snap a click on a floor to its nearest side, retaining rotation for its centre. */
export function buildingSideAt(point: Point, tile: Point, fallback = 0): number {
  const dx = point.x - tile.x, dz = point.z - tile.z;
  if (Math.max(Math.abs(dx), Math.abs(dz)) < .1) return fallback;
  return Math.abs(dx) > Math.abs(dz) ? dx > 0 ? 1 : 3 : dz > 0 ? 0 : 2;
}
/** Keep boundary keys alongside cells so existing memoized Set plumbing stays lossless. */
export function buildingCollisionKeys(pieces: readonly Building[], blocks: (b: Building) => boolean = b => !!PIECES[b.piece]?.solid): Set<string> {
  return new Set(pieces.filter(blocks).map(b => buildingBoundary(b) ?? cellKey(b)));
}
export function buildingBlocker(keys: ReadonlySet<string>) {
  const blocked = (p: Point) => keys.has(cellKey(p));
  const crosses = (a: Point, b: Point): boolean => {
    if (a.x === b.x || a.z === b.z) return keys.has(boundaryKey(a, b));
    // A diagonal must clear both corners; otherwise it slips around a wall end.
    const x = { x: b.x, z: a.z }, z = { x: a.x, z: b.z };
    return [boundaryKey(a, x), boundaryKey(a, z), boundaryKey(x, b), boundaryKey(z, b)].some(key => keys.has(key));
  };
  return Object.assign(blocked, { crosses });
}
