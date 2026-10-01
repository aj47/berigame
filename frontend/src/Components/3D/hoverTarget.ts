import type { Object3D, Vector3 } from 'three';
import { areaOf, enterRule, inBounds, isLandTile, nearestReachableTile, tileEquals, TILE_ORIGIN, type Tile } from '@sim';

export interface HoverHint {
  title: string;
  action: string;
  detail?: string;
  tone?: 'ready' | 'muted';
  radius?: number;
  tile?: Tile;
  /** Stable identity for choosing between avatars under the same pointer. */
  playerHex?: string;
  /** Panels do not change clickedOtherObject, but still consume a click. */
  click?: 'panel';
}

export type HoverTarget = HoverHint | ((point: Vector3) => HoverHint | null) | null;

/** Drei's labels make the canvas pointer-transparent; R3F receives events on its wrapper. */
export function isWorldSurface(target: EventTarget | null, canvas: HTMLCanvasElement, connected?: EventTarget): boolean {
  return !!target && (target === canvas || target === canvas.parentElement || target === connected);
}

/** Read metadata only. Hover must never invoke an interaction handler. */
export function hoverTargetOf(object: Object3D | null, point: Vector3): { root: Object3D; hint: HoverHint } | null | undefined {
  for (let root = object; root; root = root.parent) {
    if (!Object.prototype.hasOwnProperty.call(root.userData, 'hoverTarget')) continue;
    const target = root.userData.hoverTarget as HoverTarget;
    const hint = typeof target === 'function' ? target(point) : target;
    return hint ? { root, hint } : null;
  }
  return undefined;
}

export function hoverRoots(scene: Object3D): Object3D[] {
  const roots: Object3D[] = [];
  scene.traverse(o => { if (o.userData.hoverTarget) roots.push(o); });
  return roots;
}

/** Unlike worldToTile, preserve out-of-bounds ocean instead of clamping it to shore. */
export function hoverTile(x: number, z: number): Tile {
  return { x: Math.round(x + TILE_ORIGIN), z: Math.round(z + TILE_ORIGIN) };
}

export function groundHover(tile: Tile, me: Tile, blocked: Set<number>, hasStick: boolean, hasClub: boolean): HoverHint {
  if (!inBounds(tile) || !isLandTile(tile)) return { title: 'Water', action: 'Choose a spot on land', tone: 'muted', tile };
  const destination = nearestReachableTile(me, tile, blocked, enterRule(hasStick, hasClub));
  const fromArea = areaOf(me), toArea = areaOf(tile);
  if (!hasStick && fromArea === 'grove' && toArea !== 'grove') {
    return { title: 'Thorny brambles', action: 'Click to walk to the edge', detail: 'Carry a sturdy stick to cross', tone: 'muted', tile: destination };
  }
  if (!hasClub && fromArea !== 'boulders' && (toArea === 'boulders' || toArea === 'boulder-line')) {
    return { title: 'Boulder boundary', action: 'Click to walk to the edge', detail: 'Carry a stone club to cross', tone: 'muted', tile: destination };
  }
  return tileEquals(destination, tile)
    ? { title: 'Walk here', action: 'Click to move', tile: destination }
    : { title: 'Walk nearby', action: 'Click to move to the highlighted spot', detail: 'The way to that spot is blocked', tone: 'muted', tile: destination };
}
