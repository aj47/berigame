/** Local Vite-only review of settlement building pieces. Not part of the production build. */
import React, { Suspense, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls, useGLTF } from '@react-three/drei';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';
import { PIECES } from '../../../shared/sim/frontier/catalog';
import { PieceMesh, RoofMesh, type PieceLook } from '../frontier/pieceArt';

type Placed = { piece: string; x: number; z: number; r?: number };
function Piece({ piece, x, z, r = 0, look }: Placed & { look?: PieceLook }) {
  return <group position={[x, 0, z]} rotation={[0, r * Math.PI / 2, 0]}>
    <group position={[0, 0, PIECES[piece]?.edge ? .5 : 0]}><PieceMesh piece={piece} look={look} /></group>
  </group>;
}
function Avatar({ at }: { at: [number, number, number] }) {
  const { scene } = useGLTF('/models/starter-adventurer.glb');
  const model = useMemo(() => clone(scene), [scene]);
  return <primitive object={model} position={at} />;
}
const W = 5, D = 4;
const cottage: Placed[] = [
  ...Array.from({ length: W * D }, (_, i) => ({ piece: 'floor', x: i % W, z: Math.floor(i / W) })),
  ...Array.from({ length: W }, (_, x) => ({ piece: x === 1 || x === 3 ? 'window' : 'wall', x, z: 0, r: 2 })),
  ...Array.from({ length: W }, (_, x) => ({ piece: x === 2 ? 'door' : x === 4 ? 'window' : 'wall', x, z: D - 1, r: 0 })),
  ...Array.from({ length: D }, (_, z) => ({ piece: z === 1 ? 'window' : 'wall', x: 0, z, r: 3 })),
  ...Array.from({ length: D }, (_, z) => ({ piece: z === 2 ? 'window' : 'brick_wall', x: W - 1, z, r: 1 })),
  { piece: 'bed', x: 0, z: 0, r: 0 }, { piece: 'bookshelf', x: 1, z: 0 }, { piece: 'kitchen', x: 4, z: 0 },
  { piece: 'rug', x: 2, z: 2 }, { piece: 'table', x: 2, z: 1 }, { piece: 'chair', x: 1, z: 1, r: 1 }, { piece: 'chair', x: 3, z: 1, r: 3 },
  { piece: 'chest', x: 0, z: 3, r: 1 }, { piece: 'barrel', x: 4, z: 3 }, { piece: 'potted_plant', x: 4, z: 2 }, { piece: 'stool', x: 3, z: 0 },
  { piece: 'lamp', x: 1, z: 4 }, { piece: 'bench', x: 3, z: 4, r: 2 }, { piece: 'planter', x: 5, z: 4 }, { piece: 'sign', x: -1, z: 4 },
  ...[0, 1, 3, 4, 5].map(x => ({ piece: 'fence', x: x - 1, z: 5, r: 0 })), { piece: 'gate', x: 1, z: 5, r: 0 },
  { piece: 'workbench', x: 6, z: 1, r: 3 }, { piece: 'kiln', x: 6, z: 3 }, { piece: 'stable', x: 7, z: 0 },
];
const roof = Array.from({ length: W * D }, (_, i) => ({ x: i % W, z: Math.floor(i / W) }));
const lShape = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [0, 3], [1, 3]].map(([x, z]) => ({ x, z }));
function App() {
  const [view, setView] = useState('cottage'), [roofOn, setRoofOn] = useState(true), [fade, setFade] = useState(false);
  const gallery = Object.keys(PIECES).filter(p => p !== 'roof');
  return <div style={{ height: '100vh', background: '#d9eadf', fontFamily: 'system-ui', color: '#294739' }}>
    <header style={{ position: 'absolute', zIndex: 10, left: 16, top: 12, display: 'flex', gap: 10, alignItems: 'center', background: '#fffbeaee', padding: 10, borderRadius: 14 }}>
      <strong>Settlement pieces</strong>
      {['cottage', 'gallery', 'roofs'].map(v => <button key={v} onClick={() => setView(v)} style={{ padding: '6px 14px', borderRadius: 12, background: view === v ? '#2f6a50' : '#f6f8e9', color: view === v ? '#fff' : '#294739' }}>{v}</button>)}
      <label><input type="checkbox" checked={roofOn} onChange={e => setRoofOn(e.target.checked)} />Roof</label>
      <label><input type="checkbox" checked={fade} onChange={e => setFade(e.target.checked)} />Indoors cutaway</label>
    </header>
    <Canvas shadows="percentage" camera={{ position: [10, 11, 15], fov: 40 }} dpr={[1, 1.5]}>
      <color attach="background" args={['#d9eadf']} />
      <hemisphereLight args={['#fff7de', '#788e7d', .9 * Math.PI]} />
      <directionalLight position={[20, 35, 10]} intensity={1.1 * Math.PI} color="#ffeaca" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-15} shadow-camera-right={15} shadow-camera-top={15} shadow-camera-bottom={-15} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, -.01, 2]} receiveShadow><planeGeometry args={[60, 60]} /><meshStandardMaterial color="#6a9a4a" roughness={1} /></mesh>
      <Suspense fallback={null}>
        {view === 'cottage' && <group position={[-2, 0, -2]}>
          {cottage.map((p, i) => <Piece key={i} {...p} look={fade && ['wall', 'brick_wall', 'window', 'door'].includes(p.piece) ? 'fade' : 'normal'} />)}
          {roofOn && <RoofMesh tiles={roof} look={fade ? 'fade' : 'normal'} />}
          <Avatar at={[2, .15, 2.9]} />
          <Avatar at={[2.4, 0, 4.4]} />
        </group>}
        {view === 'gallery' && gallery.map((piece, i) => <group key={piece} position={[(i % 6) * 2 - 5, 0, Math.floor(i / 6) * 2.4 - 3]}>
          <Piece piece={piece} x={0} z={0} />
          <Html position={[0, -.05, .9]} center><span style={{ whiteSpace: 'nowrap', fontSize: 11, background: '#fffbea', padding: '3px 7px', borderRadius: 8 }}>{PIECES[piece].name}</span></Html>
        </group>)}
        {view === 'roofs' && <>
          <RoofMesh tiles={[{ x: 0, z: 0 }]} at={[-6, -2.4, 0]} />
          <RoofMesh tiles={[{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }]} at={[-4, -2.4, 0]} />
          <RoofMesh tiles={lShape} at={[0, -2.4, 0]} />
          <RoofMesh tiles={Array.from({ length: 21 }, (_, i) => ({ x: i % 7, z: Math.floor(i / 7) }))} at={[4, -2.4, 0]} />
        </>}
      </Suspense>
      <OrbitControls target={[1, 1, 1]} />
    </Canvas>
  </div>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
