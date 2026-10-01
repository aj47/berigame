import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, DodecahedronGeometry, IcosahedronGeometry, Object3D } from 'three';
import { BOULDERS_MIN, BOULDER_LINE, GRID_SIZE, boulderLineTiles, isBoulderLine, terrainField, inBoulders, tileToWorld } from '@sim';
import { seeded } from './nodes/lowPoly';

const noRaycast = () => null;
const lineGeo = new DodecahedronGeometry(1, 0);
const pebbleGeo = new IcosahedronGeometry(1, 0);

interface Rock { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number; tilt: number; shade: number }

/**
 * M3 "The Boulders" dressing, in three instanced draws with raycasting off (the
 * server decides who may pass; clicks reach the ground):
 * - the boulder line: a big flat-shaded boulder on each of its 29 tiles, with
 *   a lower filler rock between neighbours so it reads as one wall;
 * - rim rocks along the plateau's sea edge, framing the area (never on a tile centre);
 * - low pebbles scattered over the plateau (too small to read as blockers).
 */
const BouldersArea = () => {
  const line = useRef<any>();
  const rim = useRef<any>();
  const pebbles = useRef<any>();
  const { lineRocks, rimRocks, pebbleRocks } = useMemo(() => {
    const rand = seeded(5050);
    const lineRocks: Rock[] = [];
    for (const t of boulderLineTiles()) {
      const [wx, , wz] = tileToWorld(t);
      const h = 0.62 + rand() * 0.22;
      lineRocks.push({ x: wx + (rand() - 0.5) * 0.12, y: h * 0.55, z: wz + (rand() - 0.5) * 0.12, sx: 0.55 + rand() * 0.1, sy: h, sz: 0.55 + rand() * 0.1, yaw: rand() * 6.28, tilt: (rand() - 0.5) * 0.25, shade: rand() * 0.75 });
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        if (!isBoulderLine({ x: t.x + dx, z: t.z + dz })) continue;
        const fh = 0.38 + rand() * 0.12;
        lineRocks.push({ x: wx + dx * 0.5, y: fh * 0.45, z: wz + dz * 0.5, sx: 0.36, sy: fh, sz: 0.36, yaw: rand() * 6.28, tilt: 0, shade: 0.99 });
      }
    }
    // Rim: along the plateau's outer sea edges, half a tile beyond the last row.
    const rimRocks: Rock[] = [];
    const edge = (x: number, z: number) => {
      const s = 0.45 + rand() * 0.55;
      rimRocks.push({ x, y: s * 0.35, z, sx: s * (0.9 + rand() * 0.5), sy: s * (0.8 + rand() * 0.9), sz: s * (0.9 + rand() * 0.5), yaw: rand() * 6.28, tilt: (rand() - 0.5) * 0.4, shade: rand() });
    };
    for(let z=36;z<64;z++)for(let x=36;x<64;x++){
      const d=terrainField(x,z);
      if(inBoulders({x,z}) && d<.6 && rand()<.6) edge(x-25,z-25);
    }
    const pebbleRocks: Rock[] = [];
    for (let i = 0; i < 90; i++) {
      const eastArm = rand() < 0.55;
      const x = eastArm ? BOULDER_LINE + 1 + rand() * (GRID_SIZE - BOULDER_LINE - 2) : BOULDERS_MIN + rand() * (BOULDER_LINE - BOULDERS_MIN);
      const z = eastArm ? BOULDERS_MIN + rand() * (GRID_SIZE - BOULDERS_MIN - 1) : BOULDER_LINE + 1 + rand() * (GRID_SIZE - BOULDER_LINE - 2);
      if(!inBoulders({x,z}) || terrainField(x,z)<.5) continue;
      const s = 0.06 + rand() * 0.1;
      pebbleRocks.push({ x: x - 25, y: s * 0.3, z: z - 25, sx: s * 1.4, sy: s * 0.7, sz: s, yaw: rand() * 6.28, tilt: 0, shade: rand() });
    }
    return { lineRocks, rimRocks, pebbleRocks };
  }, []);

  useLayoutEffect(() => {
    const obj = new Object3D();
    const place = (mesh: any, rocks: Rock[], palette: Color[], filler?: Color) => {
      rocks.forEach((r, i) => {
        obj.position.set(r.x, r.y, r.z);
        obj.rotation.set(r.tilt, r.yaw, r.tilt * 0.5);
        obj.scale.set(r.sx, r.sy, r.sz);
        obj.updateMatrix();
        mesh.setMatrixAt(i, obj.matrix);
        mesh.setColorAt(i, r.shade === 0.99 && filler ? filler : palette[Math.floor(r.shade * palette.length) % palette.length]);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    // Warm grey volcanic stone, a shade apart from the sand and the tide rocks.
    place(line.current, lineRocks, [new Color('#7b716a'), new Color('#8c8278'), new Color('#6a615b'), new Color('#948a7c')], new Color('#5d5550'));
    place(rim.current, rimRocks, [new Color('#6e655e'), new Color('#817669'), new Color('#5a534e')]);
    place(pebbles.current, pebbleRocks, [new Color('#5a524c'), new Color('#9a8f80'), new Color('#3b3444')]);
  }, [lineRocks, rimRocks, pebbleRocks]);

  return (
    <group name="boulders_area">
      <instancedMesh ref={line} args={[lineGeo, undefined, lineRocks.length]} raycast={noRaycast}>
        <meshStandardMaterial color="#ffffff" roughness={0.95} flatShading />
      </instancedMesh>
      <instancedMesh ref={rim} args={[lineGeo, undefined, rimRocks.length]} raycast={noRaycast}>
        <meshStandardMaterial color="#ffffff" roughness={0.95} flatShading />
      </instancedMesh>
      <instancedMesh ref={pebbles} args={[pebbleGeo, undefined, pebbleRocks.length]} raycast={noRaycast}>
        <meshStandardMaterial color="#ffffff" roughness={1} flatShading />
      </instancedMesh>
    </group>
  );
};
export default React.memo(BouldersArea);
