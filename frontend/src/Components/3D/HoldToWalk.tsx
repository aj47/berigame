import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { GRID_SIZE, worldToTile } from '@sim';
import { useGameActions } from '../../spacetime/actions';
import { useUserInputStore } from '../../store';
import { TOUCH_TAP_RADIUS, holdState, openMenuNear } from './tapAssist';

/** Press this long without moving to start a hold. */
export const HOLD_MS = 380;
/** Movement (px) that turns a press into a camera drag. */
export const HOLD_SLOP = 10;
/** How often a held finger re-aims the walk target. */
export const HOLD_RETARGET_MS = 250;
export const HOLD_EVENT = 'berigame-hold-walk';

const ground = new Plane(new Vector3(0, 1, 0), 0);
const raycaster = new Raycaster();
const ndc = new Vector2();
const point = new Vector3();

/**
 * Touch (and mouse) press-and-hold:
 * - on a tree, item or adventurer: opens its action menu (a context menu);
 * - on the ground: walks continuously toward the finger until it lifts,
 *   with camera dragging paused meanwhile.
 */
const HoldToWalk = () => {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const { setTarget } = useGameActions();
  const setTargetRef = useRef(setTarget);
  setTargetRef.current = setTarget;

  useEffect(() => {
    const el = gl.domElement;
    let timer = 0, retarget = 0, pointerId = -1;
    let startX = 0, startY = 0, x = 0, y = 0, lastTile = '';
    const tileUnder = () => {
      const rect = el.getBoundingClientRect();
      ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(ground, point)) return null;
      const t = worldToTile(point.x, point.z);
      return t.x >= 0 && t.z >= 0 && t.x < GRID_SIZE && t.z < GRID_SIZE ? t : null;
    };
    const aim = () => {
      const t = tileUnder();
      if (!t) return;
      const key = `${t.x},${t.z}`;
      if (key === lastTile) return;
      lastTile = key;
      void setTargetRef.current(t.x, t.z);
    };
    const stop = () => {
      window.clearTimeout(timer);
      window.clearInterval(retarget);
      timer = retarget = 0;
      if (holdState.active) {
        holdState.active = false;
        holdState.suppressClickUntil = performance.now() + 400;
        window.dispatchEvent(new CustomEvent(HOLD_EVENT, { detail: false }));
      }
      pointerId = -1;
    };
    const begin = () => {
      timer = 0;
      const rect = el.getBoundingClientRect();
      // Context menu: the same menu a tap on the object opens.
      if (openMenuNear(scene, camera, rect, x, y, TOUCH_TAP_RADIUS)) {
        holdState.suppressClickUntil = performance.now() + 600;
        pointerId = -1;
        return;
      }
      useUserInputStore.getState().setClickedOtherObject(null);
      holdState.active = true;
      lastTile = '';
      window.dispatchEvent(new CustomEvent(HOLD_EVENT, { detail: true }));
      navigator.vibrate?.(12);
      aim();
      retarget = window.setInterval(aim, HOLD_RETARGET_MS);
    };
    const down = (e: PointerEvent) => {
      if (pointerId !== -1) { stop(); return; } // a second finger: pinch, not a hold
      if (e.button !== 0) return;
      pointerId = e.pointerId;
      startX = x = e.clientX;
      startY = y = e.clientY;
      timer = window.setTimeout(begin, HOLD_MS);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      x = e.clientX;
      y = e.clientY;
      if (timer && Math.hypot(x - startX, y - startY) > HOLD_SLOP) stop();
    };
    const up = (e: PointerEvent) => { if (e.pointerId === pointerId) stop(); };
    const menu = (e: Event) => { if (holdState.active || timer) e.preventDefault(); };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', menu);
    return () => {
      stop();
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('contextmenu', menu);
    };
  }, [gl, camera, scene]);
  return null;
};
export default HoldToWalk;
