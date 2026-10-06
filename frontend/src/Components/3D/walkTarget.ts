import { Plane, Vector3, type Ray } from 'three';
import { inBounds, TILE_ORIGIN, type Tile } from '@sim';
import { isOpenGround } from '../../bosses/selectors';

const ground = new Plane(new Vector3(0, 1, 0), 0);

/**
 * Which side of the Spire floor boundary the local player stands on. GameComponent
 * keeps it current, so menus built from a click ray (store.js) offer walks on
 * your side only: from the overworld the floor reads as water, and from inside
 * the overworld is out of reach.
 */
let viewerOnFloor = false;
export function setWalkViewerOnFloor(onFloor: boolean): void { viewerOnFloor = onFloor; }

/** Project through the clicked model to the ground, without snapping to the model's tile. */
export function groundTileFromRay(ray?: Ray, meOnFloor = viewerOnFloor): Tile | null {
  const point = ray?.intersectPlane(ground, new Vector3());
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  // worldToTile clamps ocean outside the map onto the shore; keep it invalid here.
  const tile = { x: Math.round(point.x + TILE_ORIGIN), z: Math.round(point.z + TILE_ORIGIN) };
  return inBounds(tile) && isOpenGround(tile, meOnFloor) ? tile : null;
}
