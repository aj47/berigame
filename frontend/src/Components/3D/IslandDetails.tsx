import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { ConeGeometry, IcosahedronGeometry, MeshStandardMaterial, Object3D, OctahedronGeometry } from 'three';
import { GRID_SIZE } from '@sim';
import { merged, part, withWind } from './envArt';
import { linear } from './nodes/lowPoly';

const noRaycast = () => null;
const GRASS = 240, STONES = 28, FLOWERS = 70, PALMS = 14;

/** A three-blade grass tuft, vertex-coloured darker at the root. */
const tuftGeo = merged([0, 1, 2].map((i) => part(new ConeGeometry(.35, 1, 3).translate(0, .5, 0), i === 1 ? 0x5fa23c : 0x3f7f2e, [(i - 1) * .22, 0, (i % 2) * .12], [1, i === 1 ? 1.15 : .85, 1], [0, i * 1.1, (i - 1) * .35], .2, i)));
/** A flower: one bright blossom on a short stem. */
const flowerGeo = merged([
  part(new ConeGeometry(.12, 1, 3).translate(0, .5, 0), 0x4d8a3c, [0, 0, 0], [1, 1, 1], [0, 0, 0], 0, 1),
  part(new OctahedronGeometry(.42, 0), 0xffffff, [0, 1.05, 0], [1, .6, 1], [0, .4, 0], .1, 2),
  part(new IcosahedronGeometry(.16, 0), 0xffe07a, [0, 1.25, 0], [1, 1, 1], [0, 0, 0], 0, 3),
]);
/** A beach palm (trunk and fronds merged) for the sand rim outside the walkable grid. */
const palmGeo = merged([
  ...[0, 1, 2, 3, 4].map((i) => part(new ConeGeometry(.2 - i * .02, .75, 6).translate(0, .37, 0), i % 2 ? 0x9a7a52 : 0x7d5e3c, [i * i * .045, i * .66, 0], [1, 1, 1], [0, 0, -i * .09], .12, i)),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => part(new OctahedronGeometry(1, 0).scale(.95, .07, .26).translate(.95, 0, 0).rotateZ(-.35 - (i % 2) * .25).rotateY(i / 8 * Math.PI * 2), i % 2 ? 0x3e8e41 : 0x5aa84a, [.75, 3.35, 0], [1, 1, 1], [0, 0, 0], .2, 10 + i)),
  ...[0, 1, 2].map((i) => part(new IcosahedronGeometry(.16, 0), 0x7a5a2e, [.75 + Math.cos(i * 2.1) * .2, 3.15, Math.sin(i * 2.1) * .2], [1, 1, 1], [0, 0, 0], .1, 30 + i)),
]);

const grassMat = withWind(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }), .08, 0);
const flowerMat = withWind(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .8 }), .05, 0);
const palmMat = withWind(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .9 }), .018, 1.5);
const stoneMat = new MeshStandardMaterial({ color: '#b3aa8c', flatShading: true, roughness: 1 });
const stoneGeo = new IcosahedronGeometry(1, 0);
/** Berry-juice blossoms plus hibiscus pink and white. */
const BLOSSOMS = [0xef4444, 0xf59e0b, 0xffffff, 0xf472b6, 0x818cf8, 0xfde68a].map(linear);

/** Deterministic, low ground cover. Four instanced draws; no colliders. Sway runs in the vertex shader. */
const IslandDetails = () => {
  const grass = useRef<any>();
  const stones = useRef<any>();
  const flowers = useRef<any>();
  const palms = useRef<any>();
  const samples = useMemo(() => {
    let seed = 31415;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const result: number[][] = [];
    while (result.length < GRASS) {
      const x = rand()*47-24, z = rand()*47-24;
      if (Math.abs(x)<1.8 || Math.abs(z)<1.8 || Math.hypot(x,z)<4) continue;
      result.push([x,z,rand(),rand()]);
    }
    return result;
  }, []);
  useLayoutEffect(() => {
    const obj = new Object3D();
    samples.forEach(([x,z,a,b],i) => {
      obj.position.set(x,0,z);obj.rotation.set(0,a*Math.PI*2,0);obj.scale.set(.22+a*.12,.22+b*.16,.22+a*.12);obj.updateMatrix();grass.current.setMatrixAt(i,obj.matrix);
      if (i<STONES) {obj.position.set(x+.4,.04,z-.3);obj.scale.set(.12+a*.12,.08+b*.04,.11+a*.1);obj.updateMatrix();stones.current.setMatrixAt(i,obj.matrix);}
      if (i<FLOWERS) {obj.position.set(x+.25,0,z+.15);obj.scale.setScalar(.2+b*.08);obj.updateMatrix();flowers.current.setMatrixAt(i,obj.matrix);flowers.current.setColorAt(i,BLOSSOMS[(i*7+Math.floor(a*6))%BLOSSOMS.length]);}
    });
    // Palms stand on the sand rim just outside the grid, leaning out to sea.
    const half = GRID_SIZE / 2;
    for (let i = 0; i < PALMS; i++) {
      const side = i % 4, t = ((i * 0.618) % 1) * 44 - 22;
      const out = half + .05;
      const [x, z, yaw] = side === 0 ? [t, out, -Math.PI / 2] : side === 1 ? [out, t, 0] : side === 2 ? [t, -out, Math.PI / 2] : [-out, t, Math.PI];
      obj.position.set(x - .5 + (side === 1 ? .2 : 0), 0, z - .5 + (side === 0 ? .2 : 0));
      obj.rotation.set(0, yaw + (i % 3 - 1) * .4, 0);
      obj.scale.setScalar(.85 + (i % 3) * .12);
      obj.updateMatrix();
      palms.current.setMatrixAt(i, obj.matrix);
    }
    for(const ref of [grass,stones,flowers,palms]) ref.current.instanceMatrix.needsUpdate=true;
    if (flowers.current.instanceColor) flowers.current.instanceColor.needsUpdate = true;
  }, [samples]);
  return <group>
    <instancedMesh ref={grass} args={[tuftGeo,grassMat,GRASS]} raycast={noRaycast} />
    <instancedMesh ref={stones} args={[stoneGeo,stoneMat,STONES]} raycast={noRaycast} />
    <instancedMesh ref={flowers} args={[flowerGeo,flowerMat,FLOWERS]} raycast={noRaycast} />
    <instancedMesh ref={palms} args={[palmGeo,palmMat,PALMS]} raycast={noRaycast} />
  </group>;
};
export default IslandDetails;
