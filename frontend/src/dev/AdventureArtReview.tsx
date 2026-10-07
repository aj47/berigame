/** Local Vite-only art review. This entry is not part of the production build. */
import React, {Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas,useFrame} from '@react-three/fiber';
import {Html,OrbitControls,useGLTF} from '@react-three/drei';
import {AnimationMixer,LoopRepeat} from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils';
import {AdventureModel,type AdventureAsset} from '../Components/3D/AdventureModels';
import {avatarClips} from '../animation/pruneClips';
import {EMOTE_CLIPS} from '../animation/emotes';

function Dancer({clip,playing,time,variant='starter-adventurer.glb'}:{clip:string;playing:boolean;time:number;variant?:string}){
  const {scene,animations}=useGLTF('/models/'+variant),model=useMemo(()=>clone(scene),[scene]);
  const clips=useMemo(()=>avatarClips(scene,animations),[scene,animations]),mixer=useMemo(()=>new AnimationMixer(model),[model]);
  const action=useRef<any>();
  useEffect(()=>{mixer.stopAllAction();const c=clips.find(c=>c.name===clip)!;action.current=mixer.clipAction(c);action.current.reset().setLoop(LoopRepeat,Infinity).play();return()=>mixer.stopAllAction();},[mixer,clips,clip]);
  useEffect(()=>()=>{mixer.uncacheRoot(model);model.traverse((o:any)=>{if(o.isSkinnedMesh)o.skeleton.dispose();});},[mixer,model]);
  useFrame((_,dt)=>{if(playing)mixer.update(dt);else if(action.current){action.current.time=Math.min(time,action.current.getClip().duration);mixer.update(0);}});
  return <primitive object={model} dispose={null}/>;
}
function App(){
  const [view,setView]=useState('cast'),[motion,setMotion]=useState(false),[playing,setPlaying]=useState(true),[time,setTime]=useState(.8),[variant,setVariant]=useState('starter-adventurer.glb');
  const props:AdventureAsset[]=['market','feast','workshop','handcart','giant-berry','strange-seed','leaf-cover','scent-bait','workshop-site'];
  return <div style={{height:'100vh',background:'#e8dfcc',fontFamily:'system-ui',color:'#354530'}}>
    <header style={{position:'absolute',zIndex:1000000000,left:24,top:18,right:24,display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',background:'#f7f0dded',padding:10,borderRadius:16}}><strong style={{fontFamily:'Georgia',fontSize:26}}>BeriGame · island stories</strong>{['cast','props','emotes','carry'].map(v=><button key={v} onClick={()=>setView(v)} style={{padding:'9px 18px',borderRadius:16,border:'1px solid #8f967a',background:view===v?'#476847':'#fff8e8',color:view===v?'white':'#354530'}}>{v}</button>)}
      <label><input type="checkbox" checked={motion} onChange={e=>setMotion(e.target.checked)}/>Walk</label>
      <label><input type="checkbox" checked={playing} onChange={e=>setPlaying(e.target.checked)}/>Animate</label>
      <label>Pose <input aria-label="Animation pose time" type="range" min="0" max="4.2" step=".05" value={time} onChange={e=>setTime(+e.target.value)}/>{time.toFixed(2)}s</label>
      <select aria-label="Player hairstyle" value={variant} onChange={e=>setVariant(e.target.value)}><option value="starter-adventurer.glb">Tousled</option><option value="starter-adventurer-cropped.glb">Cropped</option><option value="starter-adventurer-topknot.glb">Topknot</option></select>
    </header>
    <Canvas shadows="percentage" camera={{position:[7,6,12],fov:38}} dpr={[1,1.5]}><color attach="background" args={['#e8dfcc']}/><ambientLight intensity={.5*Math.PI}/><hemisphereLight args={['#fff8e8','#799576',.5*Math.PI]}/><directionalLight position={[4,10,8]} intensity={1.2*Math.PI} castShadow shadow-mapSize={[2048,2048]}/>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.035,0]} receiveShadow><planeGeometry args={[80,80]}/><meshStandardMaterial color="#dbd2bd" roughness={1}/></mesh>
      <Suspense fallback={<Html>Loading art…</Html>}>
      {view==='cast'&&(['gardener','moss','pip','berry-giant'] as const).map((asset,i)=><group key={asset} position={[(i-1.5)*3,0,0]} rotation={[0,.2,0]}><AdventureModel asset={asset} mood={motion?'walk':asset==='pip'?'happy':'idle'}/><Html position={[0,-.1,1.2]} center><span style={{whiteSpace:'nowrap',fontWeight:700,background:'#fff4dd',padding:'8px 16px',borderRadius:20}}>{['The gardener','Moss · the porter','Pip · the rascal','The Berry Giant'][i]}</span></Html></group>)}
      {view==='props'&&props.map((asset,i)=><group key={asset} position={[(i%3-1)*4.1,0,(Math.floor(i/3)-1)*3.8]}><AdventureModel asset={asset}/><Html position={[0,0,1.35]} center><span style={{whiteSpace:'nowrap',fontSize:12,background:'#fff4dd',padding:6,borderRadius:9}}>{asset}</span></Html></group>)}
      {view==='emotes'&&EMOTE_CLIPS.map((clip,i)=><group key={clip+variant} position={[(i%4-1.5)*2.8,0,(Math.floor(i/4)-.5)*4]}><Dancer clip={clip} playing={playing} time={time} variant={variant}/><Html position={[0,0,.8]} center><b style={{background:'#fff4dd',padding:6,borderRadius:9}}>{clip}</b></Html></group>)}
      {view==='carry'&&<><group position={[-2,0,0]}><Dancer clip={motion?'CarryRun':'CarryIdle'} playing={playing} time={time}/><group position={[0,.7,.72]}><AdventureModel asset="giant-berry" scale={.7}/></group></group><group position={[2,0,0]}><AdventureModel asset="moss" mood="carry" motion={motion?{current:true}:undefined}/><group position={[0,.7,.72]}><AdventureModel asset="giant-berry" scale={.7}/></group></group></>}
      </Suspense><OrbitControls target={[0,1,0]} minDistance={7} maxDistance={35}/>
    </Canvas>
  </div>;
}
const root=createRoot(document.getElementById('root')!);
root.render(<App/>);
if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());
