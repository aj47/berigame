import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferGeometry, DynamicDrawUsage, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, OctahedronGeometry,
  Quaternion, Vector3,
} from 'three';
import { BULLET_LIFE_HALF_STEPS, BULLET_STRIDE, TILE_ORIGIN, bulletTileAt } from '@sim';
import { estimatedTick } from '../fx/harvestProgress';
import { setBulletCount, type BulletStyle } from './bulletStats';

/** Packed bullets ([F, ox, oz, dx, dz, q] per bullet, shared/sim/bullets.ts) and the box they may be drawn in. */
export interface BulletSource { bullets: Int32Array; boxX0: number; boxZ0: number; boxX1: number; boxZ1: number }

export interface BulletLayerProps {
  /** Read every frame (no React render per tick); null draws nothing. */
  source: () => BulletSource | null;
  /** 'spire' draws q = 2 bullets as shards and q = 1 as motes; 'runner' draws Clatterhorn's beetling swarm. */
  palette: 'spire' | 'runner';
}

/** Instances per style before the first growth; doubles when a frame needs more (the AvatarDecals pattern). */
export const BULLET_CAPACITY = 256;

/** The capacity that holds `needed` instances: `current` doubled as often as needed. */
export function bulletCapacity(current: number, needed: number): number {
  let c = Math.max(1, current);
  while (c < needed) c *= 2;
  return c;
}

const A = { x: 0, z: 0 }, B = { x: 0, z: 0 };

/**
 * Tile-space position of bullet i at the continuous half-step `hf`: linear
 * interpolation between the integer half-step tiles tile(floor(hf)) and
 * tile(floor(hf) + 1), exactly the collision model (knight-move bullets
 * visibly stair-step). False (hidden) outside 0 <= hf <= 36 or the box.
 */
export function bulletPosition(b: Int32Array, i: number, hf: number, box: Omit<BulletSource, 'bullets'>, out: { x: number; z: number }): boolean {
  if (!(hf >= 0 && hf <= BULLET_LIFE_HALF_STEPS)) return false;
  const h = Math.floor(hf), f = hf - h;
  if (!bulletTileAt(b, i, h, A)) return false;
  if (A.x < box.boxX0 || A.x > box.boxX1 || A.z < box.boxZ0 || A.z > box.boxZ1) return false;
  if (f > 0 && bulletTileAt(b, i, h + 1, B)) {
    out.x = A.x + (B.x - A.x) * f;
    out.z = A.z + (B.z - A.z) * f;
  } else {
    out.x = A.x;
    out.z = A.z;
  }
  return true;
}

/** Which style draws bullet i of a palette. */
export function bulletStyleOf(palette: BulletLayerProps['palette'], q: number): BulletStyle {
  return palette === 'runner' ? 'runner' : q === 2 ? 'shard' : 'mote';
}

interface StyleArt { style: BulletStyle; geometry: () => BufferGeometry; color: string; y: number; oriented: boolean }
const ART: Record<BulletStyle, StyleArt> = {
  // A stretched octahedron along +z (its flight direction once oriented).
  shard: { style: 'shard', geometry: () => new OctahedronGeometry(0.2, 0).scale(0.75, 0.75, 1.9), color: '#7fe7ff', y: 0.55, oriented: true },
  mote: { style: 'mote', geometry: () => new IcosahedronGeometry(0.2, 0), color: '#ff7ad9', y: 0.45, oriented: false },
  // A low, wide beetling shape.
  runner: { style: 'runner', geometry: () => new OctahedronGeometry(0.28, 0).scale(1, 0.45, 1.35), color: '#3b5ba9', y: 0.16, oriented: true },
};
const STYLES: Record<BulletLayerProps['palette'], readonly BulletStyle[]> = { spire: ['shard', 'mote'], runner: ['runner'] };

function makeMesh(art: StyleArt, capacity: number): InstancedMesh {
  const material = new MeshBasicMaterial({ color: art.color, toneMapped: false, transparent: true, depthWrite: false });
  const mesh = new InstancedMesh(art.geometry(), material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  // Bullets span the arena; three 0.149 cannot bound instances.
  mesh.frustumCulled = false;
  // Never a click or hover target.
  mesh.raycast = () => {};
  mesh.name = `Bullets:${art.style}`;
  return mesh;
}

const UP = new Vector3(0, 1, 0);
const pos = new Vector3(), scale = new Vector3(1, 1, 1), turn = new Quaternion(), matrix = new Matrix4();
const P = { x: 0, z: 0 };

/**
 * Instanced bullets on the avatar timeline (`renderTick = estimatedTick(now) - 1`),
 * interpolated between the integer half-step tiles that collide (FINAL_SPEC 7.5).
 * One InstancedMesh per style, no React per bullet, allocation-free per frame,
 * partial uploads. Its drawn counts feed `bulletStats` (the HUD's data-bullets).
 */
export default function BulletLayer({ source, palette }: BulletLayerProps) {
  const styles = STYLES[palette];
  const [capacity, setCapacity] = useState(BULLET_CAPACITY);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const meshes = useMemo(() => styles.map((s) => makeMesh(ART[s], capacity)), [styles, capacity]);
  useEffect(() => () => {
    for (const m of meshes) { m.geometry.dispose(); (m.material as MeshBasicMaterial).dispose(); m.dispose(); }
  }, [meshes]);
  useEffect(() => () => { for (const s of styles) setBulletCount(s, 0); }, [styles]);
  const counts = useRef<number[]>([]);

  useFrame(() => {
    const src = sourceRef.current();
    const n = src ? Math.floor(src.bullets.length / BULLET_STRIDE) : 0;
    const drawn = counts.current;
    for (let k = 0; k < meshes.length; k++) drawn[k] = 0;
    if (src && n > 0) {
      const b = src.bullets;
      const renderTick = estimatedTick(performance.now()) - 1;
      let overflow = 0;
      for (let i = 0; i < n; i++) {
        const o = i * BULLET_STRIDE;
        const hf = 2 * (renderTick - b[o]);
        if (!bulletPosition(b, i, hf, src, P)) continue;
        const style = bulletStyleOf(palette, b[o + 5]);
        const k = styles.indexOf(style);
        if (k < 0) continue;
        if (drawn[k] >= capacity) { overflow = Math.max(overflow, drawn[k] + 1); continue; }
        const art = ART[style];
        pos.set(P.x - TILE_ORIGIN, art.y, P.z - TILE_ORIGIN);
        if (art.oriented) turn.setFromAxisAngle(UP, Math.atan2(b[o + 3], b[o + 4]));
        else turn.identity();
        meshes[k].setMatrixAt(drawn[k]++, matrix.compose(pos, turn, scale));
      }
      if (overflow > capacity) setCapacity(bulletCapacity(capacity, overflow));
    }
    for (let k = 0; k < meshes.length; k++) {
      const mesh = meshes[k], count = drawn[k];
      mesh.count = count;
      if (count > 0) {
        // Upload only the instances in use, not the whole capacity.
        mesh.instanceMatrix.updateRange.offset = 0;
        mesh.instanceMatrix.updateRange.count = count * 16;
        mesh.instanceMatrix.needsUpdate = true;
      }
      setBulletCount(styles[k], count);
    }
  });

  return <>{meshes.map((m) => <primitive key={m.uuid} object={m} />)}</>;
}
export type { BulletStyle };
