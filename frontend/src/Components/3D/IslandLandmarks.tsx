import React, { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, MeshStandardMaterial, Object3D, TorusGeometry } from 'three';
import { BRIDGES, FOREST_TREES, tileToWorld } from '@sim';
import { merged, part, withWind } from './envArt';
const noRaycast = () => null;
const mat = new MeshStandardMaterial({ vertexColors:true, roughness:1, flatShading:true });
const box=(color:number,p:[number,number,number],s:[number,number,number],r:[number,number,number]=[0,0,0])=>part(new BoxGeometry(1,1,1),color,p,s,r,.08,Math.round(p[0]*31+p[1]*99));
const wood=0x816145, paleWood=0xba9160, stone=0x959482, roof=0x59796a;
const bridgeGeo=merged([
  ...Array.from({length:18},(_,i)=>box(i%3===0?wood:paleWood,[-3.3+i*.39,-.015,0],[.35,.1,1.8])),
  ...[-.96,.96].flatMap(z=>[
    box(wood,[0,-.12,z],[7,.25,.15]),box(paleWood,[0,.66,z],[6.8,.1,.1]),
    ...[-3.2,0,3.2].map(x=>box(wood,[x,.25,z],[.16,1.05,.16]))]),
]);
const millGeo=merged([
  box(stone,[0,.25,0],[2.8,.5,2.6]),box(0xe5d1a1,[0,1.35,0],[2.6,2.2,2.4]),
  ...[-1.25,1.25].flatMap(x=>[-1.15,1.15].map(z=>box(wood,[x,1.4,z],[.14,2.3,.14]))),
  box(wood,[0,2.15,0],[2.7,.16,2.5]),box(roof,[-.72,2.75,0],[1.9,.17,3.05],[0,0,.55]),box(roof,[.72,2.75,0],[1.9,.17,3.05],[0,0,-.55]),
  box(wood,[.35,.9,1.22],[.65,1.5,.09]),box(0x344e4b,[-.7,1.5,1.23],[.5,.6,.06]),
  box(stone,[.7,3.1,-.6],[.4,1,.4]),box(0x505e47,[.7,3.65,-.6],[.6,.15,.6]),
]);
const wheelGeo=merged([
  ...[-.22,.22].map(z=>part(new TorusGeometry(1.1,.095,4,12),wood,[0,0,z])),
  ...Array.from({length:12},(_,i)=>{
    const a=i*Math.PI/6;return box(paleWood,[Math.sin(a)*1.02,Math.cos(a)*1.02,0],[.42,.14,.65],[0,0,-a]);}),
  ...[0,Math.PI/3,2*Math.PI/3].map(a=>box(wood,[0,0,0],[.13,2.2,.16],[0,0,a])),
]);
const beaconGeo=merged([
  part(new CylinderGeometry(.62,.85,2.7,8),0xe7ddbc,[0,1.35,0]),
  part(new CylinderGeometry(.66,.66,.45,8),0xad654c,[0,2.05,0]),
  part(new CylinderGeometry(.8,.8,.18,8),stone,[0,2.8,0]),
  part(new CylinderGeometry(.47,.47,.7,8),0xe8ba64,[0,3.2,0]),
  ...[-.45,.45].flatMap(x=>[-.45,.45].map(z=>box(wood,[x,3.2,z],[.07,.9,.07]))),
  part(new ConeGeometry(.9,.65,8),roof,[0,3.9,0]),
]);
const forestGeo=merged([
  part(new CylinderGeometry(.12,.25,2.1,5),wood,[0,1,0]),
  ...[0,1,2].map(i=>part(new ConeGeometry(1.45-i*.29,2.25-i*.25,7),[0x355e40,0x477e4e,0x669656][i],[0,2+i*.72,0],[1,1,1],[0,i*.7,0],.13,i+1)),
]);
const forestMat=withWind(mat.clone(),.013,1.6);
const archGeo=merged([
  ...[-2,2].flatMap(x=>[0,1,2,3,4].map(i=>box(i%2?0x899482:stone,[x,.25+i*.5,0],[.8,.46,.85],[0,(i%2)*.04,0]))),
  box(stone,[0,2.75,0],[4.9,.65,1]),box(0x62785b,[-1,3.14,0],[1.8,.16,1.05]),
]);
const boatGeo=merged([
  part(new IcosahedronGeometry(1,0),wood,[0,-.05,0],[.7,.35,1.6]),
  box(0x574936,[0,.16,0],[.8,.08,1.65]),box(paleWood,[0,.28,0],[1,.11,.24]),
  box(wood,[0,1.25,-.15],[.07,2.4,.07]),
  part(new ConeGeometry(.85,1.65,3),0xeee0bb,[.3,1.45,-.15],[1,1,.055],[0,0,-.08]),
]);
const harbourGeo=merged([
  ...Array.from({length:9},(_,i)=>box(paleWood,[-1.2+i*.3,0,0],[.27,.13,2])),
  ...[-1.25,1.25].flatMap(x=>[-1,1].map(z=>box(wood,[x,.2,z],[.18,.85,.18]))),
  box(roof,[0,2.1,0],[2.9,.15,2.5],[0,0,.06]),
  ...[-1.2,1.2].map(x=>box(wood,[x,1,0],[.12,2,.12])),
]);
const signGeo=merged([box(wood,[0,.52,0],[.1,1.05,.1]),box(paleWood,[0,.88,0],[.7,.28,.1]),box(wood,[0,.82,.06],[.32,.035,.012])]);

export default function IslandLandmarks({onGroundClick}:{onGroundClick?:(e:any)=>void}){
  const forest=useRef<any>(null),wheel=useRef<any>(null),boat=useRef<any>(null);
  useLayoutEffect(()=>{const o=new Object3D();FOREST_TREES.forEach((t,i)=>{o.position.set(...tileToWorld(t));o.rotation.set(0,i*2.4,0);o.scale.setScalar(.8+(i%5)*.095);o.updateMatrix();forest.current.setMatrixAt(i,o.matrix);});forest.current.instanceMatrix.needsUpdate=true;forest.current.computeBoundingSphere?.();},[]);
  useFrame(({clock},dt)=>{if(wheel.current)wheel.current.rotation.z+=Math.min(dt,.1)*.3;if(boat.current){boat.current.position.y=-.18+Math.sin(clock.elapsedTime*.9)*.035;boat.current.rotation.z=Math.sin(clock.elapsedTime*.8)*.035;}});
  return <group name="bramblewild_landmarks">
    {BRIDGES.map(b=><mesh key={b.id} name="land_mesh" userData={{ landmark: b.name }} position={tileToWorld(b)} geometry={bridgeGeo} material={mat} onClick={onGroundClick}/>)}
    <instancedMesh ref={forest} args={[forestGeo,forestMat,FOREST_TREES.length]} raycast={noRaycast}/>
    <group name="Old Brook Mill" position={[-4,0,-11]} raycast={noRaycast}>
      <mesh geometry={millGeo} material={mat}/>
      <group position={[-1.7,.85,0]} rotation={[0,Math.PI/2,0]}><mesh ref={wheel} geometry={wheelGeo} material={mat}/></group>
    </group>
    <mesh name="Northwatch Beacon" position={[2,0,-20.5]} geometry={beaconGeo} material={mat} raycast={noRaycast}/>
    <mesh name="Tumbledown arch" position={[20,0,20]} geometry={archGeo} material={mat} raycast={noRaycast}/>
    <group position={[20,0,23]} raycast={noRaycast}>{[-2,2].map(x=><mesh key={x} position={[x,.6,0]}><cylinderGeometry args={[.38,.5,1.2,6]}/><meshStandardMaterial color="#959482" flatShading/></mesh>)}</group>
    <mesh name="Driftwood Harbour" position={[22,0,4]} geometry={harbourGeo} material={mat} raycast={noRaycast}/>
    <mesh ref={boat} name="Fishing skiff" position={[25.8,-.18,5.5]} rotation={[0,.4,0]} geometry={boatGeo} material={mat} raycast={noRaycast}/>
    {[{x:24,z:19},{x:21,z:21},{x:13,z:31},{x:34,z:36},{x:43,z:28},{x:44,z:43}].map((t,i)=><mesh key={i} position={tileToWorld(t)} geometry={signGeo} material={mat} raycast={noRaycast}/>)}
  </group>;
}
