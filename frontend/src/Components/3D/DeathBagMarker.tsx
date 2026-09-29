import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, DoubleSide, Vector3, type Group, type MeshBasicMaterial } from 'three';
import { tileToWorld } from '@sim';
import { bagLifeLeft, useCameraLook, useMyDeathBag } from '../../spacetime/deathBag';
import { useTick } from '../../spacetime/hooks';

const look = new Vector3();
/** Publishes the camera's ground heading for the DOM compass (only when it turns noticeably). */
export const CameraLookProbe = () => {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    // The camera looks down its local -Z axis (the third column of its world matrix, negated).
    const m = camera.matrixWorld.elements;
    look.set(-m[8], -m[9], -m[10]);
    const len = Math.hypot(look.x, look.z);
    if (len < 1e-4) return;
    const x = look.x / len, z = look.z / len;
    const prev = useCameraLook.getState();
    if (Math.abs(prev.x - x) + Math.abs(prev.z - z) > 0.01) useCameraLook.setState({ x, z });
  });
  return null;
};

/**
 * A beam and a pennant over the bag your latest defeat left behind. Only you
 * see it (it is drawn from your own death piles); it fades as the piles near
 * expiry and disappears once they are picked up or gone.
 */
const DeathBagMarker = () => {
  const bag = useMyDeathBag();
  const tick = useTick();
  const group = useRef<Group>(null);
  const beam = useRef<MeshBasicMaterial>(null);
  const flag = useRef<MeshBasicMaterial>(null);
  const life = bag ? bagLifeLeft(bag, tick) : 0;
  useFrame(({ clock }) => {
    const pulse = 0.75 + 0.25 * Math.sin(clock.elapsedTime * 3);
    // Fade with the time left, never below a faint glow while the bag exists.
    const alpha = (0.15 + 0.6 * life) * pulse;
    if (beam.current) beam.current.opacity = alpha * 0.55;
    if (flag.current) flag.current.opacity = Math.min(1, alpha + 0.25);
    if (group.current) group.current.children[1]?.rotation.set(0, clock.elapsedTime * 0.8, 0);
  });
  if (!bag) return null;
  const [x, , z] = tileToWorld(bag);
  return (
    <group ref={group} position={[x, 0, z]} name="death-bag-marker" userData={{ berigameDeathBag: { x: bag.x, z: bag.z } }}>
      <mesh position={[0, 3, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.16, 0.3, 6, 12, 1, true]} />
        <meshBasicMaterial ref={beam} color="#ffd36b" transparent depthWrite={false} blending={AdditiveBlending} side={DoubleSide} />
      </mesh>
      <group position={[0, 2.2, 0]}>
        <mesh position={[0, 0, 0]} raycast={() => null}><cylinderGeometry args={[0.025, 0.025, 1.0, 6]} /><meshBasicMaterial color="#5b3b22" /></mesh>
        <mesh position={[0.22, 0.32, 0]} raycast={() => null}>
          <planeGeometry args={[0.42, 0.28]} />
          <meshBasicMaterial ref={flag} color="#e0513a" transparent side={DoubleSide} depthWrite={false} />
        </mesh>
      </group>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[1.05, 1.2, 32]} />
        <meshBasicMaterial color="#ffd36b" transparent opacity={0.35 + 0.4 * life} depthWrite={false} />
      </mesh>
    </group>
  );
};

export default DeathBagMarker;
