import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFrame, useThree } from '@react-three/fiber';
import { Mesh, MeshBasicMaterial, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { create } from 'zustand';
import { BOULDER_KEY_ITEM, holdsItem, STICK_ITEM_ID, tileToWorld } from '@sim';
import { useInventoryRows, useMyPlayer, useWorldBlocked } from '../../spacetime/hooks';
import { useLoadingStore, useUserInputStore } from '../../store';
import { slotsFromRows } from '../itemUi';
import { clickableNear, holdState, MOUSE_TAP_RADIUS } from './tapAssist';
import { groundHover, hoverRoots, hoverTargetOf, hoverTile, isWorldSurface, type HoverHint } from './hoverTarget';
import './worldHover.css';

interface Preview { hint: HoverHint; x: number; y: number }
const useHoverPreview = create<{ preview: Preview | null }>(() => ({ preview: null }));
const noRaycast = () => {};
const readyColor = '#ffe3a0', mutedColor = '#d5b995';

/** A read-only preview, sampled like mouse click assist, without raycasting the terrain 17 times. */
export default function WorldHover() {
  const { gl, scene, camera } = useThree();
  const connected = useThree(s => s.events.connected);
  const me = useMyPlayer(), inventory = useInventoryRows(), blocked = useWorldBlocked();
  const slots = useMemo(() => slotsFromRows(inventory), [inventory]);
  const hasStick = holdsItem(slots, me?.weapon ?? '', STICK_ITEM_ID);
  const hasClub = holdsItem(slots, me?.weapon ?? '', BOULDER_KEY_ITEM);
  const ring = useRef<Mesh>(null);
  const pointer = useRef({ x: 0, y: 0, active: false });
  const lastProbe = useRef(0), lastPreview = useRef('');
  const groundCache = useRef<{ key: string; blocked: Set<number>; hint: HoverHint }>();
  const scratch = useMemo(() => ({ ray: new Raycaster(), ndc: new Vector2(), plane: new Plane(new Vector3(0, 1, 0), 0), point: new Vector3() }), []);

  const clear = () => {
    if (ring.current) ring.current.visible = false;
    if (useHoverPreview.getState().preview) useHoverPreview.setState({ preview: null });
    lastPreview.current = '';
    gl.domElement.style.cursor = '';
    if (gl.domElement.parentElement) gl.domElement.parentElement.style.cursor = '';
  };
  useEffect(() => {
    const canvas = gl.domElement;
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY, active: e.pointerType === 'mouse' && e.buttons === 0 && isWorldSurface(e.target, canvas, connected) };
      if (!pointer.current.active) clear();
    };
    const leave = () => { pointer.current.active = false; clear(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', leave);
    window.addEventListener('blur', leave);
    const surface = canvas.parentElement ?? canvas;
    surface.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', leave);
      window.removeEventListener('blur', leave);
      surface.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', leave);
      clear();
    };
  }, [gl, connected]);

  useFrame(({ clock }) => {
    if (clock.elapsedTime - lastProbe.current < .08) return;
    lastProbe.current = clock.elapsedTime;
    const p = pointer.current, canvas = gl.domElement;
    if (!p.active || !me || holdState.active || useLoadingStore.getState().isLoading || useUserInputStore.getState().clickedOtherObject || !isWorldSurface(document.elementFromPoint(p.x, p.y), canvas, connected)) { clear(); return; }
    const rect = canvas.getBoundingClientRect();
    const hit = clickableNear(scene, camera, rect, p.x, p.y, MOUSE_TAP_RADIUS, t => !hoverTargetOf(t.hit.object, t.hit.point), hoverRoots(scene));
    const target = hit && hoverTargetOf(hit.hit.object, hit.hit.point);
    let hint: HoverHint;
    if (target) {
      hint = target.hint;
      target.root.getWorldPosition(scratch.point);
      if (hint.tile) scratch.point.set(...tileToWorld(hint.tile));
    } else {
      scratch.ndc.set(((p.x - rect.left) / rect.width) * 2 - 1, -((p.y - rect.top) / rect.height) * 2 + 1);
      scratch.ray.setFromCamera(scratch.ndc, camera);
      if (!scratch.ray.ray.intersectPlane(scratch.plane, scratch.point)) { clear(); return; }
      const tile = hoverTile(scratch.point.x, scratch.point.z);
      const key = `${tile.x},${tile.z}:${me.x},${me.z}:${hasStick}:${hasClub}`;
      if (groundCache.current?.key !== key || groundCache.current.blocked !== blocked) groundCache.current = { key, blocked, hint: groundHover(tile, me, blocked, hasStick, hasClub) };
      hint = groundCache.current.hint;
      scratch.point.set(...tileToWorld(hint.tile!));
    }
    if (ring.current) {
      ring.current.visible = true;
      ring.current.position.set(scratch.point.x, .045, scratch.point.z);
      ring.current.scale.setScalar(hint.radius ?? (target ? .8 : .44));
      (ring.current.material as MeshBasicMaterial).color.set(hint.tone === 'muted' ? mutedColor : readyColor);
    }
    canvas.style.cursor = target ? 'pointer' : hint.title === 'Water' ? 'not-allowed' : 'crosshair';
    if (canvas.parentElement) canvas.parentElement.style.cursor = canvas.style.cursor;
    const signature = JSON.stringify([p.x, p.y, hint]);
    if (signature !== lastPreview.current) {
      lastPreview.current = signature;
      useHoverPreview.setState({ preview: { hint, x: p.x, y: p.y } });
    }
  });
  return <mesh ref={ring} visible={false} rotation={[-Math.PI / 2, 0, 0]} renderOrder={100} raycast={noRaycast}>
    <ringGeometry args={[.92, 1, 48]} />
    <meshBasicMaterial color={readyColor} transparent opacity={.9} depthWrite={false} depthTest={false} />
  </mesh>;
}

export function WorldHoverTooltip() {
  const preview = useHoverPreview(s => s.preview);
  if (!preview) return null;
  const { hint, x, y } = preview;
  const width = Math.min(240, window.innerWidth - 16);
  return createPortal(<div className={`world-hover${hint.tone === 'muted' ? ' world-hover-muted' : ''}`} role="tooltip" data-testid="world-hover"
    style={{ left: Math.max(8, Math.min(x + 18, window.innerWidth - width - 8)), top: y > window.innerHeight - 140 ? y - 16 : y + 20, transform: y > window.innerHeight - 140 ? 'translateY(-100%)' : undefined, maxWidth: width }}>
    <strong>{hint.title}</strong>
    <span className="world-hover-action">{hint.action}</span>
    {hint.detail && <span className="world-hover-detail">{hint.detail}</span>}
  </div>, document.body);
}
