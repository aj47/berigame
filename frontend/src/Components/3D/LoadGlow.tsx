import React, { memo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type Mesh, type MeshBasicMaterial } from 'three';

const noRaycast = () => null;

/**
 * A pulsing gold ring at the feet of a player carrying a large unbanked load
 * (player.load, shared/sim/banking.ts): 1 faint, 2 bright. Everyone sees it, so
 * a big haul walking home is a visible target.
 */
const LoadGlow = memo(({ level }: { level: number }) => {
  const ring = useRef<Mesh>(null);
  const bright = level > 1;
  useFrame(({ clock }) => {
    const material = ring.current?.material as MeshBasicMaterial | undefined;
    if (material) material.opacity = (bright ? 0.55 : 0.32) + Math.sin(clock.elapsedTime * (bright ? 4 : 2.5)) * 0.12;
  });
  if (level <= 0) return null;
  return (
    <mesh ref={ring} name="load_glow" position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={2}>
      <ringGeometry args={[0.42, bright ? 0.95 : 0.72, 28]} />
      <meshBasicMaterial color={bright ? '#ffd67a' : '#e3b65c'} transparent opacity={0.4} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </mesh>
  );
});

export default LoadGlow;
