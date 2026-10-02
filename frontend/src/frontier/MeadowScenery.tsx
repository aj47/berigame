import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { InstancedMesh, Object3D } from 'three';
import { PLOTS, RESOURCE_PATCHES, type RegionId } from '../../../shared/sim/frontier/catalog';
import { regionLand } from '../../../shared/sim/frontier/regions';
import { AdventureAssetView } from '../Components/3D/AdventureModels';

type Decoration = { x: number; z: number; scale: number };
function GroveInstances({ points, kind }: { points: Decoration[]; kind: 'trunk' | 'leaves' | 'flowers' | 'rock' }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const object = new Object3D();
    points.forEach((p, i) => {
      object.position.set(p.x - 25, (kind === 'leaves' ? 1.9 : kind === 'trunk' ? .75 : .12) * p.scale, p.z - 25);
      object.rotation.set(0, (p.x * p.z) % 6, 0);
      object.scale.set(p.scale, p.scale * (kind === 'rock' ? .5 : 1), p.scale);
      object.updateMatrix();
      ref.current?.setMatrixAt(i, object.matrix);
    });
    if (ref.current) { ref.current.instanceMatrix.needsUpdate = true; }
  }, [points, kind]);
  return <instancedMesh frustumCulled={false} ref={ref} args={[undefined, undefined, points.length]}>
    {kind === 'trunk' ? <cylinderGeometry args={[.15, .22, 1.5, 5]} /> : <icosahedronGeometry args={[kind === 'leaves' ? 1.15 : kind === 'rock' ? .6 : .15, 0]} />}
    <meshStandardMaterial color={kind === 'trunk' ? '#7e6546' : kind === 'leaves' ? '#5c874c' : kind === 'rock' ? '#999c83' : '#eddb9c'} roughness={1} />
  </instancedMesh>;
}
export function ResourceModel({ item }: { item: string }) {
  if (item === 'timber' || item === 'resin' || item.startsWith('berry_')) return <group>
    <mesh position={[0,.7,0]}><cylinderGeometry args={[.13,.22,1.4,6]}/><meshStandardMaterial color="#876449"/></mesh>
    <mesh position={[0,1.8,0]} scale={[1,1.1,1]}><icosahedronGeometry args={[1.05,1]}/><meshStandardMaterial color={item.startsWith('berry_') ? '#769b4b' : '#4c7b4e'}/></mesh>
    {item.startsWith('berry_') && [-1,0,1].map((n)=><mesh key={n} position={[n*.55,1.65+Math.abs(n)*.3,.8]}><sphereGeometry args={[.16,6,4]}/><meshStandardMaterial color={item.includes('strawberry')?'#c75e56':'#c0d37b'}/></mesh>)}
  </group>;
  if (['fibre','reeds','carrot_seed'].includes(item)) return <group>{[-1,0,1].map(n=><mesh key={n} position={[n*.25,.45,0]} rotation={[0,0,n*.2]}><coneGeometry args={[.23,.9,4]}/><meshStandardMaterial color="#a4b35d"/></mesh>)}</group>;
  return <group>{[-1,0,1].map(n=><mesh key={n} position={[n*.35,.28,Math.abs(n)*.2]} scale={[.7,.5,.6]}><icosahedronGeometry args={[.8,0]}/><meshStandardMaterial color={item==='clay'?'#b98562':'#91998a'}/></mesh>)}</group>;
}
export default function MeadowScenery({ region, claimed }: { region: RegionId; claimed: string[] }) {
  const decoration = useMemo(() => {
    const trees: Decoration[] = [], flowers: Decoration[] = [], rocks: Decoration[] = [];
    const plots = PLOTS.filter(p=>p.region===region), resources=RESOURCE_PATCHES.filter(p=>p.region===region);
    for(let z=5;z<124;z+=3) for(let x=4;x<124;x+=3) {
      const noise = ((x * 7381 + z * 1933) % 997) / 997;
      if(!regionLand(region,{x,z}) || (Math.abs(x-(region === "settlement" ? 31 : 5))<5 && Math.abs(z-64)<15) || resources.some(p=>Math.max(Math.abs(x-p.x),Math.abs(z-p.z))<3)) continue;
      const reserved = plots.find(p=>x>=p.x-1&&x<=p.x+16&&z>=p.z-1&&z<=p.z+16);
      if (reserved && claimed.includes(reserved.id)) continue;
      const plot = !!reserved && x<reserved.x+9 && z<reserved.z+9;
      const road = Math.abs(x-(region === "settlement" ? 31 : 5))<2 || plots.some(p=>Math.abs(z-(p.z-2))<2 && x<102);
      if(road) continue;
      const point={x:x+noise*.5,z:z-noise*.4,scale:.7+noise*.7};
      if(!plot && noise>.38) trees.push(point);
      else if(noise<.32) flowers.push({...point,scale:.8+noise});
      else if(!plot && noise<.37) rocks.push(point);
    }
    if(region === 'settlement') {
      for(const [x,z] of [[29,58],[34,58],[29,70],[34,71]]) trees.push({x,z,scale:.75});
    }
    return {trees,flowers,rocks};
  },[region, claimed.join(",")]);
  return <group>
    <GroveInstances points={decoration.trees} kind="trunk"/><GroveInstances points={decoration.trees} kind="leaves"/>
    <GroveInstances points={decoration.flowers} kind="flowers"/><GroveInstances points={decoration.rocks} kind="rock"/>
    {region === 'settlement' && <>
      <group position={[9,0,35]} rotation={[0,-.55,0]}><AdventureAssetView asset="workshop" scale={.8}/></group>
      <group position={[9,0,43]} rotation={[0,-.6,0]}><AdventureAssetView asset="market" scale={.7}/></group>
      <group position={[9,0,37.5]}><AdventureAssetView asset="handcart" scale={.8}/></group>
      <group position={[4,0,36.5]}><AdventureAssetView asset="feast" scale={.55}/></group>
    </>}
  </group>;
}
