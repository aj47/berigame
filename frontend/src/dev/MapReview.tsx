/** Vite-only environment review; not included in the production build. */
import React,{Suspense,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas,useFrame,useThree} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import TerrainChunks from '../Components/3D/world/TerrainChunks';
import IslandLandmarks from '../Components/3D/IslandLandmarks';
import IslandDetails from '../Components/3D/IslandDetails';
import BrambleHedge from '../Components/3D/BrambleHedge';
import BouldersArea from '../Components/3D/BouldersArea';
import {Ocean} from '../Objects/GroundPlane';
import {AdventureModel} from '../Components/3D/AdventureModels';
import {envTime} from '../Components/3D/envArt';
function Clock(){useFrame((_,dt)=>envTime.value+=dt);return null;}
function App(){const [view,setView]=useState('island');const views:{[k:string]:{eye:[number,number,number];target:[number,number,number]}}={island:{eye:[55,70,76],target:[5,0,5]},mill:{eye:[-17,10,5],target:[-7,0,-9]},harbour:{eye:[32,10,17],target:[21,0,4]},ruins:{eye:[30,12,32],target:[20,0,21]},whole:{eye:[39,170,175],target:[39,0,39]},eastreach:{eye:[72,40,40],target:[72,0,2]},south:{eye:[30,45,110],target:[25,0,70]},expanse:{eye:[103,260,330],target:[103,0,103]},kingsgate:{eye:[136,14,20],target:[121,0,0]},crossroads:{eye:[160,18,116],target:[147,0,99]},fen:{eye:[20,16,175],target:[9,0,157]},dunes:{eye:[118,18,198],target:[100,0,178]},crater:{eye:[205,30,215],target:[189,0,185]}};const v=views[view];return <div style={{height:'100vh',background:'#cdeef0'}}><div style={{position:'absolute',left:24,top:20,zIndex:10,background:'#fff4dded',padding:'14px 18px',borderRadius:18,color:'#34513e',fontFamily:'system-ui'}}><strong style={{display:'block',fontFamily:'Georgia',fontSize:28}}>Bramblewild</strong><p style={{margin:'5px 0 10px'}}>Coves, crossings & little places to get lost.</p>{Object.keys(views).map(k=><button key={k} onClick={()=>setView(k)} style={{marginRight:6,padding:8}}>{k}</button>)}</div><Canvas key={view} camera={{position:v.eye,fov:42,far:500}} dpr={[1,1.5]}><color attach="background" args={['#cdeef0']}/><hemisphereLight args={['#e0f3fa','#839573',.75*Math.PI]}/><directionalLight position={[-12,24,10]} intensity={Math.PI} color="#ffe9c5"/><Clock/><TerrainChunks/><Ocean/><IslandLandmarks/><IslandDetails/><BrambleHedge/><BouldersArea/><Suspense fallback={null}><group position={[-3,0,-7]}><AdventureModel asset="workshop"/></group><group position={[10,0,12]}><AdventureModel asset="market"/></group><group position={[-13,0,11]}><AdventureModel asset="feast"/></group><group position={[32,0,32]}><AdventureModel asset="berry-giant" scale={1.7}/></group></Suspense><OrbitControls target={v.target} minDistance={6} maxDistance={320}/></Canvas></div>;}
const root=createRoot(document.getElementById('root')!);root.render(<App/>);if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());
