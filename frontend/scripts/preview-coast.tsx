/**
 * Standalone preview of the M2 Coast art (driftwood pile, tide rock, stone club)
 * next to a berry tree and the adventurer for scale. Not part of the game.
 * ?view=game  the in-game camera angle and distance (polar 0.78, azimuth 0.45, 18 units, fov 42)
 * ?view=close the same angle, closer
 * ?view=hand  the adventurer holding the club (StickIdle pose)
 */
import React, { Suspense, useEffect, useLayoutEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { AnimationMixer, Mesh, Vector3 } from 'three';
import { stickMount } from '../src/animation/stickSwing';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils';
import DriftwoodPile from '../src/Components/3D/nodes/DriftwoodPile';
import TideRock from '../src/Components/3D/nodes/TideRock';
import { clubGeometry, clubMaterial } from '../src/Components/3D/clubProp';

const view = new URLSearchParams(location.search).get('view') ?? 'game';

/** Static copy of BerryTree's meshes (the real one needs the game store). */
const Tree = ({ position }: { position: [number, number, number] }) => <group position={position}>
  <mesh position={[0, .68, 0]}><cylinderGeometry args={[.11, .19, 1.36, 6]} /><meshStandardMaterial color="#795238" flatShading /></mesh>
  <mesh position={[0, 1.76, 0]} scale={[1, .84, 1]}><icosahedronGeometry args={[.92, 0]} /><meshStandardMaterial color="#6d925d" flatShading /></mesh>
  <mesh position={[-.18, 2.23, -.07]} scale={[.78, .73, .77]}><icosahedronGeometry args={[.8, 0]} /><meshStandardMaterial color="#85a575" flatShading /></mesh>
  {[[-.55, 1.65, .55], [.5, 1.82, .47], [0, 2.23, .45], [.66, 1.95, -.16]].map((p, i) => <mesh key={i} position={p as any}><icosahedronGeometry args={[.18, 0]} /><meshStandardMaterial color="#d9423b" flatShading /></mesh>)}
</group>;

const Adventurer = ({ position, club, clip = 'Idle', yaw = 0 }: { position: [number, number, number]; club?: boolean; clip?: string; yaw?: number }) => {
  const gltf = useGLTF('/models/starter-adventurer.glb');
  const model = useMemo(() => cloneSkinned(gltf.scene), [gltf]);
  const mixer = useMemo(() => new AnimationMixer(model), [model]);
  useLayoutEffect(() => {
    const action = gltf.animations.find((a) => a.name === clip) ?? gltf.animations.find((a) => a.name === 'Idle');
    if (action) { mixer.clipAction(action).play(); mixer.update(0.4); }
    if (!club) return;
    // Mount like AdventurerModel's stick on older rigs: a mesh under HandR at stickMount(),
    // which the club shares with the stick (same +Y butt-to-tip frame and length).
    const hand = model.getObjectByName('HandR');
    if (!hand) return;
    const mesh = new Mesh(clubGeometry(), clubMaterial());
    mesh.name = 'HeldClub';
    const mount = stickMount();
    mesh.position.fromArray(mount.position);
    mesh.quaternion.fromArray(mount.quaternion);
    hand.add(mesh);
    return () => { hand.remove(mesh); };
  }, [model, mixer, club, clip]);
  return <primitive object={model} position={position} rotation={[0, yaw, 0]} dispose={null} />;
};

function Camera() {
  const { camera } = useThree();
  useEffect(() => {
    const [target, distance] = view === 'hand' ? [new Vector3(0, 1.3, 0), 5] : view === 'close' ? [new Vector3(0.6, 0.6, 0), 8] : [new Vector3(0.6, 0, 0), 18];
    const polar = view === 'hand' ? 1.25 : 0.78, azimuth = view === 'hand' ? 0.35 : 0.45;
    camera.position.set(
      target.x + distance * Math.sin(polar) * Math.sin(azimuth),
      target.y + distance * Math.cos(polar),
      target.z + distance * Math.sin(polar) * Math.cos(azimuth),
    );
    camera.lookAt(target);
    (window as any).__previewReady = true;
  }, [camera]);
  return null;
}

const Scene = () => <>
  <ambientLight intensity={0.55 * Math.PI} />
  <hemisphereLight args={['#dff2ff', '#b89b6a', 0.45 * Math.PI]} />
  <directionalLight position={[6, 12, 6]} intensity={0.9 * Math.PI} />
  <Camera />
  {/* sand */}
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}><planeGeometry args={[40, 40]} /><meshStandardMaterial color="#e2cd9b" /></mesh>
  <Suspense fallback={null}>
    {view === 'hand' ? <>
      <Adventurer position={[-0.7, 0, 0]} club clip="StickIdle" yaw={0.5} />
      <Adventurer position={[0.7, 0, 0]} club clip="StickIdle" yaw={-1.4} />
    </> : <>
      <Tree position={[-2.5, 0, -1]} />
      <Adventurer position={[-0.8, 0, 0.6]} />
      <Adventurer position={[0.6, 0, 1.6]} club clip="StickIdle" yaw={0.4} />
      <DriftwoodPile position={[0.8, 0, -0.5]} />
      <DriftwoodPile position={[2.2, 0, 0.8]} ripe={false} rotation={0.8} />
      <TideRock position={[3.2, 0, -1]} />
      <TideRock position={[4.4, 0, 0.6]} ripe={false} rotation={0.4} />
    </>}
  </Suspense>
</>;

createRoot(document.getElementById('root')!).render(
  <Canvas dpr={1.5} camera={{ fov: view === 'hand' ? 30 : 42, near: 0.1, far: 180 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
    <color attach="background" args={['#9fc9d8']} />
    <Scene />
  </Canvas>,
);
