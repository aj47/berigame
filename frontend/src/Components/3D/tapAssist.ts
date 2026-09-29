import { useUserInputStore } from '../../store';
import { Raycaster, Vector2, type Camera, type Object3D, type Intersection } from 'three';

/** Screen-space tap radius (CSS px) for fingers; mice get a smaller one. */
export const TOUCH_TAP_RADIUS = 30;
export const MOUSE_TAP_RADIUS = 10;

export type ClickHandler = (e: any) => void;

/** The nearest ancestor's R3F onClick handler, skipping the ground itself. */
export function clickHandlerOf(object: Object3D | null): { handler: ClickHandler; object: Object3D } | null {
  for (let o: Object3D | null = object; o; o = o.parent) {
    const handler = (o as any).__r3f?.handlers?.onClick as ClickHandler | undefined;
    if (handler) return o.name === 'land_mesh' ? null : { handler, object: o };
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

export interface TapHit { handler: ClickHandler; object: Object3D; hit: Intersection }

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
): TapHit | null {
  const tried = new Set<Object3D>();
  for (const [dx, dy] of tapSamples(radius)) {
    ndc.set(((clientX + dx - rect.left) / rect.width) * 2 - 1, -((clientY + dy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    for (const hit of raycaster.intersectObjects(scene.children, true)) {
      const found = clickHandlerOf(hit.object);
      if (!found || tried.has(found.object)) continue;
      tried.add(found.object);
      if (!skip({ ...found, hit })) return { ...found, hit };
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
): boolean {
  const store = useUserInputStore as any;
  let opened = false;
  clickableNear(scene, camera, rect, clientX, clientY, radius, (t) => {
    const before = store.getState().clickedOtherObject;
    t.handler(syntheticClick(t, clientX, clientY, nativeEvent));
    const after = store.getState().clickedOtherObject;
    opened = !!after && after !== before;
    return !opened;
  });
  return opened;
}

/** An R3F-shaped click event for calling an object's handler directly. */
export function syntheticClick(target: TapHit, clientX: number, clientY: number, nativeEvent?: Event) {
  return {
    clientX,
    clientY,
    delta: 0,
    point: target.hit.point,
    object: target.hit.object,
    eventObject: target.object,
    nativeEvent,
    stopPropagation: () => {},
  };
}

/** Set while a hold-to-walk gesture is live, so the release's click does not re-target. */
export const holdState = { active: false, suppressClickUntil: 0 };
