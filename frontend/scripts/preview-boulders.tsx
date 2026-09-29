/**
 * Standalone preview of M3 "The Boulders" and the F3 Giant, using the game's
 * own components with mocked rows (no server). Not part of the game build.
 * ?view=overview|idle|windup|slam|stomp|defeated|obsidian
 */
import React, { Suspense, useEffect, useLayoutEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { AnimationMixer, Vector3 } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils';
import { GIANT_MAX_HP, GIANT_TILE, GiantAttack, GiantState, freshGiant, tileToWorld } from '@sim';
import BouldersArea from '../src/Components/3D/BouldersArea';
import ObsidianOutcrop from '../src/Components/3D/nodes/ObsidianOutcrop';
import TideRock from '../src/Components/3D/nodes/TideRock';
import { GiantModel } from '../src/Components/3D/Giant';
import { BouldersGround, Ocean } from '../src/Objects/GroundPlane';
import { useGiantStore } from '../src/spacetime/stores/giantStore';
import { envTime } from '../src/Components/3D/envArt';
import '../src/App.css';

const view = new URLSearchParams(location.search).get('view') ?? 'idle';

const Adventurer = ({ tile, yaw = 0, clip = 'Idle' }: { tile: { x: number; z: number }; yaw?: number; clip?: string }) => {
  const gltf = useGLTF('/models/starter-adventurer.glb');
  const model = useMemo(() => cloneSkinned(gltf.scene), [gltf]);
  const mixer = useMemo(() => new AnimationMixer(model), [model]);
  useLayoutEffect(() => {
    const a = gltf.animations.find((x) => x.name === clip) ?? gltf.animations.find((x) => x.name === 'Idle');
    if (a) { mixer.clipAction(a).play(); mixer.update(0.3); }
  }, [mixer, gltf, clip]);
  useFrame((_, dt) => mixer.update(dt));
  const [x, , z] = tileToWorld(tile);
  return <primitive object={model} position={[x, 0, z]} rotation={[0, yaw, 0]} />;
};

const Rig = ({ target, dist }: { target: [number, number, number]; dist: number }) => {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    const polar = 0.78, az = 0.45;
    camera.position.set(target[0] + dist * Math.sin(polar) * Math.sin(az), target[1] + dist * Math.cos(polar), target[2] + dist * Math.sin(polar) * Math.cos(az));
    camera.lookAt(new Vector3(...target));
  }, [camera, target, dist]);
  useFrame((_, dt) => { envTime.value += Math.min(dt, 0.1); });
  return null;
};

function giantFor(v: string) {
  const g = { id: 1, ...freshGiant(0) } as any;
  if (v === 'windup') Object.assign(g, { state: GiantState.Windup, attack: GiantAttack.Slam, slamX: GIANT_TILE.x - 2, slamZ: GIANT_TILE.z + 1, stateUntilTick: 3, hp: 312, lastHitTick: 0 });
  if (v === 'stomp') Object.assign(g, { state: GiantState.Windup, attack: GiantAttack.Stomp, stateUntilTick: 4, hp: 250, lastHitTick: 0 });
  if (v === 'slam') Object.assign(g, { state: GiantState.Recover, attack: GiantAttack.Slam, slamX: GIANT_TILE.x - 2, slamZ: GIANT_TILE.z + 1, stateUntilTick: 99, hp: 204, lastHitTick: 0 });
  if (v === 'defeated') Object.assign(g, { state: GiantState.Defeated, hp: 0, respawnTick: 412, lastHitTick: 0 });
  if (v === 'idle' || v === 'overview' || v === 'obsidian') g.hp = GIANT_MAX_HP;
  return g;
}

const Scene = () => {
  const giant = useMemo(() => giantFor(view), []);
  useEffect(() => {
    if (view !== 'slam') return;
    const t = setInterval(() => useGiantStore.setState({ slamAt: performance.now() - 60 }), 1400);
    useGiantStore.setState({ slamAt: performance.now() - 60 });
    return () => clearInterval(t);
  }, []);
  useEffect(() => { const t = setTimeout(() => ((window as any).__previewReady = true), 1500); return () => clearTimeout(t); }, []);
  const [gx, , gz] = tileToWorld(GIANT_TILE);
  const target: [number, number, number] = view === 'overview' ? [22, 0, 22] : view === 'obsidian' ? [15.5, 0.5, 34] : [gx - 1.5, 1.4, gz];
  const dist = view === 'overview' ? 46 : view === 'obsidian' ? 10 : 17;
  return <>
    <Rig target={target} dist={dist} />
    <color attach="background" args={['#cdeef0']} />
    <fog attach="fog" args={['#cdeef0', 55, 150]} />
    <directionalLight position={[-12, 24, 10]} intensity={1.0} color="#ffe2b8" />
    <hemisphereLight args={['#cfe8ff', '#8c7a52', 0.55]} />
    <Ocean />
    {/* The old island's south-east Coast, for context. */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}><planeGeometry args={[50, 50]} /><meshStandardMaterial color="#86a03c" roughness={1} /></mesh>
    <mesh position={[-0.5, -0.26, -0.5]} scale={[52, 0.5, 52]}><boxGeometry /><meshStandardMaterial color="#f2dc9e" roughness={1} /></mesh>
    <BouldersGround />
    <BouldersArea />
    <TideRock position={tileToWorld({ x: 46, z: 46 })} rotation={1} />
    <ObsidianOutcrop position={tileToWorld({ x: 60, z: 40 })} rotation={0.7} />
    <ObsidianOutcrop position={tileToWorld({ x: 40, z: 60 })} rotation={2.1} />
    <GiantModel giant={giant} tick={100} onAttack={() => {}} />
    <Suspense fallback={null}>
      {view !== 'overview' && view !== 'obsidian' && <>
        <Adventurer tile={{ x: GIANT_TILE.x - 2, z: GIANT_TILE.z + 1 }} yaw={Math.PI / 2} clip={view === 'defeated' ? 'Cheer' : 'Idle'} />
        <Adventurer tile={{ x: GIANT_TILE.x - 1, z: GIANT_TILE.z + 2 }} yaw={Math.PI} />
        <Adventurer tile={{ x: GIANT_TILE.x - 5, z: GIANT_TILE.z - 1 }} yaw={Math.PI / 2} />
      </>}
      {view === 'obsidian' && <Adventurer tile={{ x: 41, z: 59 }} yaw={-Math.PI / 2} />}
    </Suspense>
  </>;
};

createRoot(document.getElementById('root')!).render(
  <Canvas camera={{ fov: 42, near: 0.1, far: 300 }} dpr={1}><Scene /></Canvas>,
);
