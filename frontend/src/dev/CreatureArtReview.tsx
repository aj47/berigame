/** Local Vite-only review of creature and companion art. Not part of the production build. */
import React, { Suspense, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls, useGLTF } from '@react-three/drei';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';
import { CREATURE_SPECIES, CreatureModel, creatureHeight, type CreatureMotion } from '../frontier/creatureArt';

function Avatar({ at }: { at: [number, number, number] }) {
  const { scene } = useGLTF('/models/starter-adventurer.glb');
  const model = useMemo(() => clone(scene), [scene]);
  return <primitive object={model} position={at} />;
}
function Specimen({ species, x, z, speed, tamed, labels }: { species: string; x: number; z: number; speed: number; tamed: boolean; labels: boolean }) {
  const motion = useRef<CreatureMotion>({ speed });
  motion.current.speed = speed;
  return <group position={[x, 0, z]}>
    <CreatureModel species={species} motion={motion} tamed={tamed} />
    {labels && <Html position={[0, creatureHeight(species) + .15, 0]} center style={{ pointerEvents: 'none' }}>
      <span style={{ background: '#fffbeaee', padding: '2px 8px', borderRadius: 10, font: '12px system-ui', color: '#294739', whiteSpace: 'nowrap' }}>{species}</span>
    </Html>}
  </group>;
}
const VIEWS: Record<string, { eye: [number, number, number]; target: [number, number, number] }> = {
  gallery: { eye: [0, 4.2, 9.5], target: [0, .5, 0] },
  bunny: { eye: [1.1, 1.1, 2.1], target: [-3.6, .45, -1.2] },
  closeup: { eye: [0, 1.4, 3.4], target: [0, .5, 0] },
};
function App() {
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState(params.get('view') ?? 'gallery');
  const [walking, setWalking] = useState(params.get('walk') === '1');
  const [tamed, setTamed] = useState(params.get('tamed') !== '0');
  const [labels, setLabels] = useState(params.get('labels') !== '0');
  const species = [...CREATURE_SPECIES, 'mystery'];
  const v = VIEWS[view];
  const focus = params.get('species');
  return <div style={{ height: '100vh', background: '#d9eadf', fontFamily: 'system-ui', color: '#294739' }}>
    <header style={{ position: 'absolute', zIndex: 10, left: 16, top: 12, display: 'flex', gap: 10, alignItems: 'center', background: '#fffbeaee', padding: 10, borderRadius: 14 }}>
      <strong>Creatures</strong>
      {Object.keys(VIEWS).map(k => <button key={k} onClick={() => setView(k)} style={{ padding: '6px 14px', borderRadius: 12, background: view === k ? '#2f6a50' : '#f6f8e9', color: view === k ? '#fff' : '#294739' }}>{k}</button>)}
      <label><input type="checkbox" checked={walking} onChange={e => setWalking(e.target.checked)} />Walking</label>
      <label><input type="checkbox" checked={tamed} onChange={e => setTamed(e.target.checked)} />Tamed collars</label>
      <label><input type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)} />Labels</label>
    </header>
    <Canvas key={view} shadows="percentage" camera={{ position: v.eye, fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={['#d9eadf']} />
      <hemisphereLight args={['#fff7de', '#788e7d', .9 * Math.PI]} />
      <directionalLight position={[8, 14, 10]} intensity={1.1 * Math.PI} color="#ffeaca" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={10} shadow-camera-bottom={-10} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.005, 0]} receiveShadow><planeGeometry args={[40, 40]} /><meshStandardMaterial color="#6a9a4a" roughness={1} /></mesh>
      <Suspense fallback={null}>
        {focus
          ? <Specimen species={focus} x={0} z={0} speed={walking ? 2.5 : 0} tamed={tamed} labels={labels} />
          : species.map((s, i) => <Specimen key={s} species={s} x={(i % 6) * 1.45 - 3.6} z={Math.floor(i / 6) * 2.2 - 1.2} speed={walking ? 2.5 : 0} tamed={tamed} labels={labels} />)}
        {!focus && <Avatar at={[4.6, 0, -1.2]} />}
      </Suspense>
      <OrbitControls target={focus ? [0, .5, 0] : v.target} />
    </Canvas>
  </div>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
