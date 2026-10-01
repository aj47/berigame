import { Plane, Vector3, type Ray } from 'three';
import { inBounds, isLandTile, TILE_ORIGIN, type Tile } from '@sim';

const ground = new Plane(new Vector3(0, 1, 0), 0);

/** Project through the clicked model to the ground, without snapping to the model's tile. */
export function groundTileFromRay(ray?: Ray): Tile | null {
  const point = ray?.intersectPlane(ground, new Vector3());
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  // worldToTile clamps ocean outside the map onto the shore; keep it invalid here.
  const tile = { x: Math.round(point.x + TILE_ORIGIN), z: Math.round(point.z + TILE_ORIGIN) };
  return inBounds(tile) && isLandTile(tile) ? tile : null;
}
