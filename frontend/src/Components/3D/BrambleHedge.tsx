import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, Object3D, Vector3 } from 'three';
import { SPAWN_TILE, brambleTiles, isBramble, tileToWorld } from '@sim';

/** Marks the lower filler lumps between tiles (darkest palette entry). */
const FILLER_SHADE = 0.99;
const noRaycast = () => null;
const UP = new Vector3(0, 1, 0);
const THORN_LENGTH = 0.3;

/** Deterministic LCG so the hedge looks the same for everyone, every load. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Bush { x: number; z: number; sx: number; sy: number; sz: number; yaw: number; shade: number }
interface Thorn { x: number; y: number; z: number; dir: Vector3; s: number }

/**
 * The rounded woodland boundary: one squashed, flat-shaded thorn bush per tile
 * plus small pale thorns, in two instanced draws. Purely visual: raycasting is
 * off so clicks reach the ground (the server decides who may pass).
 */
const BrambleHedge = () => {
  const bushes = useRef<any>();
  const thorns = useRef<any>();
  const { bushList, thornList } = useMemo(() => {
    const rand = seeded(1717);
    const bushList: Bush[] = [];
    const thornList: Thorn[] = [];
    const lump = (x: number, z: number, along: 'x' | 'z', long: number, short: number, height: number, shade: number): Bush => ({
      x, z,
      // Stretched along the hedge so neighbours knit together into one wall.
      sx: along === 'x' ? long : short,
      sz: along === 'z' ? long : short,
      // The centre sits 0.45 radii up, so the visible top is 1.45 radii high.
      sy: height / 1.45,
      // Only a small twist: a large one would turn the stretch across the hedge.
      yaw: (rand() - 0.5) * 0.5,
      shade,
    });
    for (const tile of brambleTiles()) {
      const [wx, , wz] = tileToWorld(tile);
      const along: 'x' | 'z' = Math.abs(tile.x - SPAWN_TILE.x) > Math.abs(tile.z - SPAWN_TILE.z) ? 'z' : 'x';
      const b = lump(wx + (rand() - 0.5) * 0.1, wz + (rand() - 0.5) * 0.1, along,
        0.74 + rand() * 0.12, 0.56 + rand() * 0.08, 0.53 + rand() * 0.07, rand() * 0.74);
      bushList.push(b);
      // A lower filler lump between this tile and the next keeps the wall unbroken.
      const next = along === 'x' ? { x: tile.x + 1, z: tile.z } : { x: tile.x, z: tile.z + 1 };
      if (isBramble(next)) {
        bushList.push(lump(wx + (along === 'x' ? 0.5 : (rand() - 0.5) * 0.16), wz + (along === 'z' ? 0.5 : (rand() - 0.5) * 0.16), along,
          0.5 + rand() * 0.1, 0.46 + rand() * 0.06, 0.4 + rand() * 0.08, FILLER_SHADE));
      }
    }
    // About 400 pale thorns: two on each main bush, one on each filler.
    bushList.forEach((b, index) => {
      const count = b.shade === FILLER_SHADE ? 1 : 2;
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        const up = 0.25 + rand() * 0.85;
        const cx = Math.cos(a) * Math.cos(up), cy = Math.sin(up), cz = Math.sin(a) * Math.cos(up);
        thornList.push({
          // On the ellipsoid surface, tip pointing outward.
          x: b.x + cx * b.sx * 0.9,
          y: b.sy * 0.45 + cy * b.sy * 0.9,
          z: b.z + cz * b.sz * 0.9,
          dir: new Vector3(cx / b.sx, cy / b.sy, cz / b.sz).normalize(),
          s: 0.8 + ((index * 7 + i * 3) % 5) * 0.12,
        });
      }
    });
    return { bushList, thornList };
  }, []);

  useLayoutEffect(() => {
    const obj = new Object3D();
    // Dark olive bramble greens, a shade apart from the grass; fillers use the darkest.
    const palette = [new Color('#46552a'), new Color('#3c4b24'), new Color('#52602f'), new Color('#2f3c1c')];
    bushList.forEach((b, i) => {
      obj.position.set(b.x, b.sy * 0.45, b.z);
      obj.rotation.set(0, b.yaw, 0);
      obj.scale.set(b.sx, b.sy, b.sz);
      obj.updateMatrix();
      bushes.current.setMatrixAt(i, obj.matrix);
      bushes.current.setColorAt(i, palette[Math.floor(b.shade * palette.length) % palette.length]);
    });
    thornList.forEach((t, i) => {
      // The cone is centred on its origin: push it out so its base sits on the bush.
      obj.position.set(t.x, t.y, t.z).addScaledVector(t.dir, THORN_LENGTH * 0.42 * t.s);
      obj.quaternion.setFromUnitVectors(UP, t.dir);
      obj.scale.set(t.s, t.s, t.s);
      obj.updateMatrix();
      thorns.current.setMatrixAt(i, obj.matrix);
    });
    bushes.current.instanceMatrix.needsUpdate = true;
    if (bushes.current.instanceColor) bushes.current.instanceColor.needsUpdate = true;
    thorns.current.instanceMatrix.needsUpdate = true;
  }, [bushList, thornList]);

  return (
    <group name="bramble_hedge">
      <instancedMesh ref={bushes} args={[undefined, undefined, bushList.length]} raycast={noRaycast}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.95} flatShading />
      </instancedMesh>
      <instancedMesh ref={thorns} args={[undefined, undefined, thornList.length]} raycast={noRaycast}>
        <coneGeometry args={[0.055, THORN_LENGTH, 4]} />
        <meshStandardMaterial color="#f1e7c6" roughness={0.7} flatShading />
      </instancedMesh>
    </group>
  );
};
export default BrambleHedge;
