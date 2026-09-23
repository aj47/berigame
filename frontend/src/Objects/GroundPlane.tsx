import { useFrame } from '@react-three/fiber';
import React, { useRef } from 'react';
import { GRID_SIZE, worldToTile, tileToWorld } from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useUserInputStore } from '../store';

/** The terrain exactly covers the server grid; its coastline never hides walkable tiles. */
const GroundPlane = () => {
  const { setTarget } = useGameActions();
  const marker = useRef<any>(null);
  const clickedAt = useRef(-Infinity);
  useFrame(() => {
    if (!marker.current) return;
    const age = (performance.now() - clickedAt.current) / 850;
    // Before the first click age is Infinity. Keep hidden marker transforms
    // finite, and stop updating its matrix once the short animation finishes.
    if (age >= 1 || age < 0) {
      marker.current.visible = false;
      return;
    }
    marker.current.visible = true;
    marker.current.scale.setScalar(0.8 + age * 0.45);
    marker.current.material.opacity = Math.max(0, 1 - age);
  });
  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    useUserInputStore.getState().setClickedOtherObject(null);
    const tile = worldToTile(e.point.x, e.point.z);
    if (tile.x < 0 || tile.z < 0 || tile.x >= GRID_SIZE || tile.z >= GRID_SIZE) return;
    const [x, , z] = tileToWorld(tile);
    marker.current.position.set(x, 0.045, z);
    clickedAt.current = performance.now();
    setTarget(tile.x, tile.z);
  };
  return <>
    <mesh name="land_mesh" rotation={[-Math.PI / 2, 0, 0]} position={[-0.5, 0, -0.5]} onClick={onClick}>
      <planeGeometry args={[GRID_SIZE, GRID_SIZE]} /><meshStandardMaterial color="#849765" roughness={1} />
    </mesh>
    {/* Shallow sand shelves and broad rock strata cost only a few draw calls. */}
    <mesh position={[-0.5, -0.26, -0.5]}><boxGeometry args={[52, 0.5, 52]} /><meshStandardMaterial color="#d8c698" roughness={1} /></mesh>
    <mesh position={[-0.5, -0.85, -0.5]}><boxGeometry args={[53, 0.8, 53]} /><meshStandardMaterial color="#9d987d" roughness={1} /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.1, 0]}><planeGeometry args={[400, 400]} /><meshBasicMaterial color="#679da7" /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.5, -1.09, -0.5]}><planeGeometry args={[58, 58]} /><meshBasicMaterial color="#83b6b8" /></mesh>
    <mesh ref={marker} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.28, 0.36, 24]} /><meshBasicMaterial color="#fff2bd" transparent depthWrite={false} />
    </mesh>
    {/* Worn paths and the gathering circle are flat, non-blocking ground details. */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
      <circleGeometry args={[3.15, 12]} /><meshStandardMaterial color="#c4b485" roughness={1} />
    </mesh>
    {[[0, -9, 1.8, 16], [8, 0, 16, 1.8], [-8, 0, 16, 1.8], [0, 8, 1.8, 16]].map(([x,z,w,h],i) => <mesh key={i} rotation={[-Math.PI / 2,0,0]} position={[x,0.004,z]}>
      <planeGeometry args={[w,h]} /><meshStandardMaterial color="#b2a47b" roughness={1} />
    </mesh>)}
  </>;
};
export default GroundPlane;
