import { useThree } from '@react-three/fiber';
import React from 'react';
import { DoubleSide, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { worldToTile, tileToWorld } from '@sim';
import { useGameActions } from '../spacetime/actions';

/**
 * The walkable plane. A click becomes a tile and a `setTarget` reducer call;
 * the server does the pathing from there.
 */
const GroundPlane = () => {
  const { scene } = useThree();
  const { setTarget } = useGameActions();

  const onClick = (e: any) => {
    e.stopPropagation();
    const tile = worldToTile(e.point.x, e.point.z);
    const [wx, wy, wz] = tileToWorld(tile);
    const marker = new Mesh(new SphereGeometry(0.2, 16, 8), new MeshBasicMaterial({ color: 0xffff00 }));
    marker.position.set(wx, wy + 0.05, wz);
    scene.add(marker);
    setTimeout(() => scene.remove(marker), 800);
    setTarget(tile.x, tile.z);
  };

  return (
    <>
      <mesh name="land_mesh" scale={[50, 50, 1]} rotation={[Math.PI / 2, 0, 0]} position={[-0.5, 0, -0.5]} onClick={onClick}>
        <planeGeometry />
        <meshBasicMaterial color="#fff1a1" side={DoubleSide} />
      </mesh>
      <mesh name="water_mesh" scale={[500, 500, 1]} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
        <planeGeometry />
        <meshBasicMaterial color="#006994" side={DoubleSide} />
      </mesh>
    </>
  );
};

export default GroundPlane;
