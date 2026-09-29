import React, { useEffect, useMemo, useState } from 'react';
import { CircleGeometry, Color, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, RingGeometry, Vector3, type Object3D } from 'three';
import { useBeforeRender } from './beforeRender';

/** Ring styles: your own ring, your combat target's, and everyone else's (fainter). */
export type DecalKind = 'self' | 'target' | 'other';
const HIGHLIGHT = { self: '#fff2c9', target: '#e67855' } as const;

const avatars = new Map<Object3D, DecalKind>();
const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };

/**
 * Give an avatar group its ground decals (blob shadow and selection ring). They are
 * drawn by <AvatarDecals /> as instances: three draw calls for every avatar together.
 */
export function useAvatarDecal(group: React.RefObject<Object3D>, kind: DecalKind): void {
  useEffect(() => {
    const object = group.current;
    if (!object) return;
    avatars.set(object, kind);
    changed();
    return () => { avatars.delete(object); changed(); };
  }, [group, kind]);
}

/** Group-local placement of each decal (the ground plane; the blob's ellipse follows the facing). */
const BLOB_LOCAL = new Matrix4().compose(new Vector3(0, 0.016, 0), new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)), new Vector3(1, 0.65, 1));
const RING_LOCAL = new Matrix4().compose(new Vector3(0, 0.025, 0), new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)), new Vector3(1, 1, 1));
const scratch = new Matrix4();

function instanced(geometry: CircleGeometry | RingGeometry, material: MeshBasicMaterial, capacity: number, renderOrder: number, colors?: Color) {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  if (colors) mesh.setColorAt(0, colors);
  mesh.count = 0;
  // Instances span the island; three 0.149 cannot bound them.
  mesh.frustumCulled = false;
  // Blob, then faint rings, then bright rings, all after the rest of the transparent ground.
  mesh.renderOrder = renderOrder;
  return mesh;
}

/** Every avatar's blob shadow and ring, written from the avatar groups once per rendered frame. */
const AvatarDecals = () => {
  const [capacity, setCapacity] = useState(64);
  useEffect(() => {
    const grow = () => { if (avatars.size > capacity) setCapacity(Math.max(avatars.size, capacity * 2)); };
    listeners.add(grow);
    grow();
    return () => { listeners.delete(grow); };
  }, [capacity]);
  const meshes = useMemo(() => {
    const blob = instanced(new CircleGeometry(0.55, 16), new MeshBasicMaterial({ color: '#233c2a', transparent: true, opacity: 0.19, depthWrite: false }), capacity, 1);
    const ring = new RingGeometry(0.48, 0.58, 24);
    const faint = instanced(ring, new MeshBasicMaterial({ color: '#a7c1d0', transparent: true, opacity: 0.35, depthWrite: false }), capacity, 2);
    // Per-instance colour (self or target) over a white base.
    // Built here, not at module load, so they convert from sRGB like every other colour (r3f turns colour management on with the Canvas).
    const colors = { self: new Color(HIGHLIGHT.self), target: new Color(HIGHLIGHT.target) };
    const bright = instanced(ring, new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 1, depthWrite: false }), capacity, 3, colors.self);
    blob.name = 'AvatarBlobShadows'; faint.name = 'AvatarRings'; bright.name = 'AvatarHighlightRings';
    return { blob, faint, bright, colors };
  }, [capacity]);
  useEffect(() => () => {
    for (const mesh of [meshes.blob, meshes.faint, meshes.bright]) { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); mesh.dispose(); }
  }, [meshes]);
  useBeforeRender(() => {
    const { blob, faint, bright, colors } = meshes;
    let shadows = 0, rings = 0, highlights = 0;
    for (const [group, kind] of avatars) {
      if (shadows >= capacity) break;
      blob.setMatrixAt(shadows++, scratch.multiplyMatrices(group.matrixWorld, BLOB_LOCAL));
      scratch.multiplyMatrices(group.matrixWorld, RING_LOCAL);
      if (kind === 'other') faint.setMatrixAt(rings++, scratch);
      else { bright.setMatrixAt(highlights, scratch); bright.setColorAt(highlights++, colors[kind]); }
    }
    blob.count = shadows; faint.count = rings; bright.count = highlights;
    blob.instanceMatrix.needsUpdate = faint.instanceMatrix.needsUpdate = bright.instanceMatrix.needsUpdate = true;
    if (bright.instanceColor && highlights > 0) bright.instanceColor.needsUpdate = true;
  });
  return <>
    <primitive object={meshes.blob} />
    <primitive object={meshes.faint} />
    <primitive object={meshes.bright} />
  </>;
};
export default AvatarDecals;
