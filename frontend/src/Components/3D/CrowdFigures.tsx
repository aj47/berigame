import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { CapsuleGeometry, Color, InstancedMesh, MeshStandardMaterial, Object3D, SphereGeometry } from 'three';
import { ROBE_COLORS, tileToWorld, type Appearance } from '@sim';
import type { CrowdInput } from './avatarStacks';

/** Most simple figures one crowd draws; the interest block bounds a crowd anyway. */
export const MAX_CROWD_FIGURES = 512;

const body = new CapsuleGeometry(0.22, 0.55, 3, 8).translate(0, 0.5, 0);
const head = new SphereGeometry(0.17, 8, 6).translate(0, 1.08, 0);
const robe = new MeshStandardMaterial({ roughness: 0.9, flatShading: true });
const skin = new MeshStandardMaterial({ color: 0xe2b48c, roughness: 0.9, flatShading: true });
const scratch = new Object3D(), tint = new Color();

/**
 * Players past the full-avatar budget (renderQuality fullAvatars), drawn as
 * one robe-coloured figure each: two draw calls for the whole crowd, no
 * skeletons or animation. They stand on their server tile and turn to face
 * where they are heading.
 */
const CrowdFigures = ({ figures, appearances }: { figures: readonly CrowdInput[]; appearances: Map<string, Appearance> }) => {
  const bodies = useRef<InstancedMesh>(null), heads = useRef<InstancedMesh>(null);
  const shown = useMemo(() => figures.slice(0, MAX_CROWD_FIGURES), [figures]);
  useLayoutEffect(() => {
    const b = bodies.current, h = heads.current;
    if (!b || !h) return;
    shown.forEach((p, i) => {
      const [x, y, z] = tileToWorld(p);
      scratch.position.set(x, y, z);
      scratch.updateMatrix();
      b.setMatrixAt(i, scratch.matrix); h.setMatrixAt(i, scratch.matrix);
      const robeIndex = appearances.get(p.hex)?.robeColor ?? 0;
      b.setColorAt(i, tint.set(ROBE_COLORS[robeIndex % ROBE_COLORS.length].color));
    });
    b.count = h.count = shown.length;
    b.instanceMatrix.needsUpdate = h.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    b.computeBoundingSphere(); h.computeBoundingSphere();
  }, [shown, appearances]);
  if (!shown.length) return null;
  return <>
    <instancedMesh ref={bodies} args={[body, robe, MAX_CROWD_FIGURES]} castShadow={false} />
    <instancedMesh ref={heads} args={[head, skin, MAX_CROWD_FIGURES]} castShadow={false} />
  </>;
};
export default React.memo(CrowdFigures);
