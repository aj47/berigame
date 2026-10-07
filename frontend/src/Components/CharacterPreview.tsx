import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import type { Appearance } from '@sim';
import AdventurerModel, { modelUrl } from './3D/AdventurerModel';

class PreviewBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="creator-preview-error">Preview could not load. Reopen the creator to retry.</p> : this.props.children; }
}
function PreviewCamera({ closeUp }: { closeUp: boolean }) {
  const { camera } = useThree();
  useEffect(() => { camera.position.set(0, closeUp ? 1.85 : 1.2, closeUp ? 2.1 : 4.9); }, [camera, closeUp]);
  return <OrbitControls key={String(closeUp)} target={[0,closeUp?1.82:1.1,0]} enablePan={false} enableZoom={false} minPolarAngle={Math.PI*.35} maxPolarAngle={Math.PI*.56}/>;
}
export default function CharacterPreview({ appearance, name, head = 0, neck = 0, focusFace = false }: { appearance: Appearance; name: string; head?: number; neck?: number; focusFace?: boolean }) {
  const motion = useRef({ moving: false }), transient = useRef(null);
  const [turn, setTurn] = useState(0), [closeUp, setCloseUp] = useState(focusFace);
  useEffect(() => setCloseUp(focusFace), [focusFace]);
  return <div className="creator-preview" aria-label="Live character preview">
    <div className="creator-preview-heading"><strong title={name.trim()}>{name.trim() || 'A new story'}</strong></div>
    <PreviewBoundary>
      <Canvas dpr={[1,1.5]} camera={{ position:[0,1.2,4.9], fov:32 }} gl={{alpha:true,antialias:true}}>
        <ambientLight intensity={.7*Math.PI}/><directionalLight position={[3,5,4]} intensity={1.3*Math.PI}/><directionalLight position={[-3,2,-2]} intensity={.6*Math.PI} color="#b6d5ec"/>
        <Suspense fallback={<Html center><span className="creator-loading">Loading preview…</span></Html>}>
          <group rotation={[0,turn,0]}>
            <AdventurerModel url={modelUrl(appearance.hairStyle)} appearance={appearance} identity="character-preview" isSelf={false} state={0} weapon="" head={head} neck={neck} motion={motion} transient={transient} preview />
          </group>
          <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.01,0]}><circleGeometry args={[.73,48]}/><meshStandardMaterial color="#b9bba4" roughness={1}/></mesh>
        </Suspense>
        <PreviewCamera closeUp={closeUp}/>
      </Canvas>
    </PreviewBoundary>
    <div className="creator-rotate"><button type="button" aria-label="Turn character left" onClick={()=>setTurn(turn-Math.PI/4)}>↶</button><button className="creator-view-toggle" type="button" onClick={()=>setCloseUp(!closeUp)}>{closeUp?'Full body':'View face'}</button><button type="button" aria-label="Turn character right" onClick={()=>setTurn(turn+Math.PI/4)}>↷</button></div>
  </div>;
}
