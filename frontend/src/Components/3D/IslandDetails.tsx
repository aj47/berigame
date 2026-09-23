import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { Object3D } from 'three';

/** Deterministic, low ground cover. Three instanced draws; no colliders or animation. */
const IslandDetails = () => {
  const grass = useRef<any>();
  const stones = useRef<any>();
  const flowers = useRef<any>();
  const samples = useMemo(() => {
    let seed = 31415;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const result: number[][] = [];
    while (result.length < 180) {
      const x = rand()*47-24, z = rand()*47-24;
      if (Math.abs(x)<1.8 || Math.abs(z)<1.8 || Math.hypot(x,z)<4) continue;
      result.push([x,z,rand(),rand()]);
    }
    return result;
  }, []);
  useLayoutEffect(() => {
    const obj = new Object3D();
    samples.forEach(([x,z,a,b],i) => {
      obj.position.set(x,.055,z);obj.rotation.set(0,a*Math.PI,0);obj.scale.set(.055+a*.045,.18+b*.13,.045);obj.updateMatrix();grass.current.setMatrixAt(i,obj.matrix);
      if (i<28) {obj.position.set(x,.055,z);obj.scale.set(.12+a*.12,.08+b*.04,.11+a*.1);obj.updateMatrix();stones.current.setMatrixAt(i,obj.matrix);}
      if (i<48) {obj.position.set(x+.15,.13,z+.1);obj.scale.setScalar(.035+b*.025);obj.updateMatrix();flowers.current.setMatrixAt(i,obj.matrix);}
    });
    for(const ref of [grass,stones,flowers]) ref.current.instanceMatrix.needsUpdate=true;
  }, [samples]);
  return <group>
    <instancedMesh ref={grass} args={[undefined,undefined,180]}><coneGeometry args={[1,1,3]} /><meshStandardMaterial color="#58744c" flatShading /></instancedMesh>
    <instancedMesh ref={stones} args={[undefined,undefined,28]}><icosahedronGeometry args={[1,0]} /><meshStandardMaterial color="#979780" flatShading /></instancedMesh>
    <instancedMesh ref={flowers} args={[undefined,undefined,48]}><icosahedronGeometry args={[1,0]} /><meshBasicMaterial color="#efe2a9" /></instancedMesh>
  </group>;
};
export default IslandDetails;
