import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFrame, useThree } from '@react-three/fiber';
import { Mesh, MeshBasicMaterial, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { create } from 'zustand';
import { BOULDER_KEY_ITEM, holdsItem, STICK_ITEM_ID, tileToWorld } from '@sim';
import { useInventoryRows, useMyPlayer, useWorldBlocked } from '../../spacetime/hooks';
import { useFrontier } from '../../frontier/useFrontier';
import { useLoadingStore, useUserInputStore } from '../../store';
import { slotsFromRows } from '../itemUi';
import { clickableNear, holdState, MOUSE_TAP_RADIUS } from './tapAssist';
import { connectedGroundHover, groundHover, hoverRoots, hoverTargetOf, hoverTile, isWorldSurface, meadowBlockedTiles, type HoverHint } from './hoverTarget';
import './worldHover.css';

interface Preview { hint: HoverHint; x: number; y: number }
const useHoverPreview = create<{ preview: Preview | null }>(() => ({ preview: null }));
const noRaycast = () => {};
const readyColor = '#ffe3a0', mutedColor = '#d5b995';
function hintSignature(x: number, y: number, hint: HoverHint): string {
  return `${x}|${y}|${hint.title}|${hint.action}|${hint.detail ?? ''}|${hint.tone ?? ''}|${hint.radius ?? ''}|${hint.tile ? `${hint.tile.x},${hint.tile.z}` : ''}`;
}

/** Live hover inputs, kept off the mesh so a walk does not rebuild the probe. */
function HoverBindings({ live }: { live: React.MutableRefObject<{ me: ReturnType<typeof useMyPlayer>; inventory: ReturnType<typeof useInventoryRows>; blocked: ReturnType<typeof useWorldBlocked>; frontier: ReturnType<typeof useFrontier> }> }) {
  const me = useMyPlayer(), inventory = useInventoryRows(), blocked = useWorldBlocked();
  const frontier = useFrontier();
  live.current = { me, inventory, blocked, frontier };
  return null;
}

/** A read-only preview, sampled like mouse click assist, without raycasting the terrain 17 times. */
export default function WorldHover() {
  const { gl, scene, camera } = useThree();
  const connected = useThree(s => s.events.connected);
  const live = useRef({ me: null as ReturnType<typeof useMyPlayer>, inventory: [] as ReturnType<typeof useInventoryRows>, blocked: new Set<number>(), frontier: null as ReturnType<typeof useFrontier> | null });
  const meadowCache = useRef<{ key: string; set: Set<string> }>({ key: '', set: new Set() });
  const ring = useRef<Mesh>(null);
  const pointer = useRef({ x: 0, y: 0, active: false });
  const lastProbe = useRef(0), lastPreview = useRef('');
  const groundCache = useRef<{ key: string; blocked: Set<number>; meadowBlocked: Set<string>; hint: HoverHint }>();
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
    const { me, inventory, blocked, frontier } = live.current;
    if (!p.active || !me || holdState.active || useLoadingStore.getState().isLoading || useUserInputStore.getState().clickedOtherObject || !isWorldSurface(document.elementFromPoint(p.x, p.y), canvas, connected)) { clear(); return; }
    const slots = slotsFromRows(inventory);
    const hasStick = holdsItem(slots, me.weapon ?? '', STICK_ITEM_ID);
    const hasClub = holdsItem(slots, me.weapon ?? '', BOULDER_KEY_ITEM);
    const expansion = !!frontier?.enabled;
    let meadowBlocked = meadowCache.current.set;
    if (expansion) {
      const meadowKey = Array.from(meadowBlockedTiles(frontier!, me, me.identity.toHexString())).sort().join(';');
      if (meadowCache.current.key !== meadowKey) meadowCache.current = { key: meadowKey, set: new Set(meadowKey ? meadowKey.split(';') : []) };
      meadowBlocked = meadowCache.current.set;
    } else if (meadowCache.current.key) meadowCache.current = { key: '', set: new Set() };
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
      const key = `${tile.x},${tile.z}:${me.region}:${me.x},${me.z}:${hasStick}:${hasClub}:${expansion}`;
      if (groundCache.current?.key !== key || groundCache.current.blocked !== blocked || groundCache.current.meadowBlocked !== meadowBlocked) groundCache.current = {
        key, blocked, meadowBlocked,
        hint: expansion ? connectedGroundHover(tile, me, blocked, meadowBlocked, hasStick, hasClub) : groundHover(tile, me, blocked, hasStick, hasClub),
      };
      hint = groundCache.current.hint;
      scratch.point.set(...tileToWorld(hint.tile!));
    }
    if (ring.current) {
      ring.current.visible = true;
      ring.current.position.set(scratch.point.x, .045, scratch.point.z);
      ring.current.scale.setScalar(hint.radius ?? (target ? .8 : .44));
      (ring.current.material as MeshBasicMaterial).color.set(hint.tone === 'muted' ? mutedColor : readyColor);
    }
    canvas.style.cursor = target ? 'pointer' : ['Water', 'Path blocked'].includes(hint.title) ? 'not-allowed' : 'crosshair';
    if (canvas.parentElement) canvas.parentElement.style.cursor = canvas.style.cursor;
    const signature = hintSignature(p.x, p.y, hint);
    if (signature !== lastPreview.current) {
      lastPreview.current = signature;
      useHoverPreview.setState({ preview: { hint, x: p.x, y: p.y } });
    }
  });
  return <>
    <HoverBindings live={live} />
    <mesh ref={ring} visible={false} rotation={[-Math.PI / 2, 0, 0]} renderOrder={100} raycast={noRaycast}>
    <ringGeometry args={[.92, 1, 48]} />
    <meshBasicMaterial color={readyColor} transparent opacity={.9} depthWrite={false} depthTest={false} />
  </mesh>
  </>;
}

export function WorldHoverTooltip() {
  const preview = useHoverPreview(s => s.preview);
  if (!preview) return null;
  const { hint, x, y } = preview;
  const width = Math.min(210, window.innerWidth - 16);
  return createPortal(<div className={`world-hover${hint.tone === 'muted' ? ' world-hover-muted' : ''}`} role="tooltip" data-testid="world-hover"
    style={{ left: Math.max(8, Math.min(x + 18, window.innerWidth - width - 8)), top: y > window.innerHeight - 140 ? y - 16 : y + 20, transform: y > window.innerHeight - 140 ? 'translateY(-100%)' : undefined, maxWidth: width }}>
    <strong>{hint.title}</strong>
    <span className="world-hover-action">{hint.action}</span>
    {hint.detail && <span className="world-hover-detail">{hint.detail}</span>}
  </div>, document.body);
}
