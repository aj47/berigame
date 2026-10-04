import { useUserInputStore } from '../../store';
import { Raycaster, Vector2, type Camera, type Object3D, type Intersection, type Ray } from 'three';
import { hoverTargetOf } from './hoverTarget';

/** Screen-space tap radius (CSS px) for fingers; mice get a smaller one. */
export const TOUCH_TAP_RADIUS = 30;
export const MOUSE_TAP_RADIUS = 10;

export type ClickHandler = (e: any) => void;

/** A held press always keeps the options menu available in one-click mode. */
export function isDirectAttackClick(event: { interaction?: string; button?: number; nativeEvent?: { button?: number } }, enabled: boolean): boolean {
  return enabled && event.interaction !== 'menu' && (event.button ?? event.nativeEvent?.button ?? 0) === 0;
}

/** The nearest ancestor's R3F onClick handler, skipping the ground itself. */
export function clickHandlerOf(object: Object3D | null): { handler: ClickHandler; object: Object3D } | null {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (o.name === 'land_mesh' || o.userData.worldSurface) return null;
    const handler = (o as any).__r3f?.handlers?.onClick as ClickHandler | undefined;
    if (handler) return { handler, object: o };
  }
  return null;
}

/** Sample offsets: centre, then two rings, nearest first. */
export function tapSamples(radius: number): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  for (const k of [0.5, 1]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      out.push([Math.cos(a) * radius * k, Math.sin(a) * radius * k]);
    }
  }
  return out;
}

const raycaster = new Raycaster();
const ndc = new Vector2();

export interface TapHit { handler: ClickHandler; object: Object3D; hit: Intersection; intersections: Intersection[] }

/** Collect interactive subtrees once, excluding terrain and decorative geometry. */
function clickableRoots(scene: Object3D): Object3D[] {
  const roots: Object3D[] = [];
  const visit = (object: Object3D) => {
    if (object.name !== 'land_mesh' && !object.userData.worldSurface && (object as any).__r3f?.handlers?.onClick) {
      roots.push(object);
      // Descendant handlers still resolve through clickHandlerOf; raycast the
      // subtree only once so overlapping avatars retain their original hits.
      return;
    }
    for (const child of object.children) visit(child);
  };
  visit(scene);
  return roots;
}

/**
 * Find a clickable object (tree, node, item, adventurer) within `radius` px of
 * a screen point, so a finger that lands just beside a small target still
 * selects it. Returns null when only the ground is there.
 */
export function clickableNear(
  scene: Object3D,
  camera: Camera,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  radius: number,
  skip: (hit: TapHit) => boolean = () => false,
  roots: Object3D[] = clickableRoots(scene),
): TapHit | null {
  if (!roots.length) return null;
  const tried = new Set<Object3D>();
  for (const [dx, dy] of tapSamples(radius)) {
    ndc.set(((clientX + dx - rect.left) / rect.width) * 2 - 1, -((clientY + dy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const intersections = raycaster.intersectObjects(roots, true);
    for (const hit of intersections) {
      const found = clickHandlerOf(hit.object);
      if (!found || tried.has(found.object)) continue;
      tried.add(found.object);
      if (!skip({ ...found, hit, intersections })) return { ...found, hit, intersections };
    }
  }
  return null;
}

/**
 * Open the action menu of whatever clickable lies within `radius` px, as a tap
 * on it would. Objects whose handler declines (you, the dead) are skipped.
 * Returns whether a menu opened.
 */
export function openMenuNear(
  scene: Object3D, camera: Camera, rect: { left: number; top: number; width: number; height: number },
  clientX: number, clientY: number, radius: number, nativeEvent?: Event,
  interaction: 'click' | 'menu' = 'click',
): boolean {
  const store = useUserInputStore as any;
  let opened = false;
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  // Assistance may sample beside the pointer; walking still uses the original click.
  const originalRay = raycaster.ray.clone();
  clickableNear(scene, camera, rect, clientX, clientY, radius, (t) => {
    const target = hoverTargetOf(t.hit.object, t.hit.point);
    if (target === null) return true;
    const before = store.getState().clickedOtherObject;
    t.handler({ ...syntheticClick(t, clientX, clientY, nativeEvent, originalRay), interaction });
    const after = store.getState().clickedOtherObject;
    opened = (!!after && after !== before) || target?.hint.click === 'panel' || target?.hint.click === 'action';
    return !opened;
  });
  return opened;
}

/** An R3F-shaped click event for calling an object's handler directly. */
export function syntheticClick(target: TapHit, clientX: number, clientY: number, nativeEvent?: Event, ray?: Ray) {
  return {
    clientX,
    clientY,
    delta: 0,
    ray,
    point: target.hit.point,
    object: target.hit.object,
    eventObject: target.object,
    intersections: target.intersections,
    nativeEvent,
    stopPropagation: () => {},
  };
}

/** Set while a hold-to-walk gesture is live, so the release's click does not re-target. */
export const holdState = { active: false, suppressClickUntil: 0 };
