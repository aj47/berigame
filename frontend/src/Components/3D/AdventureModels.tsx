import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF, Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { AnimationMixer, Group, LoopRepeat, Vector3, type Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';
import { tileToWorld } from '@sim';
import { approachWorldInteraction } from '../../frontier/worldInteraction';
import { adventureInteractionLabel, openAdventureInteraction } from './adventureInteraction';
import { buildEmoteClip, CARRY_KEYS } from '../../animation/emotes';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { holdState } from './tapAssist';
const sin=Math.sin, cos=Math.cos;

export const ADVENTURE_ASSETS = ['gardener','moss','pip','berry-giant','giant-berry','strange-seed','leaf-cover','scent-bait','market','feast','workshop','workshop-site','handcart'] as const;
export type AdventureAsset = typeof ADVENTURE_ASSETS[number];
export type ActorMood = 'idle' | 'walk' | 'carry' | 'happy' | 'sniff' | 'rest';
export const adventureModelUrl = (asset: AdventureAsset) => `/models/adventure/${asset}.glb`;

/** Geometry/materials stay in the shared GLTF cache. Each actor owns its bones and mixer. */
export function AdventureModel({asset,mood='idle',motion,scale=1}: {asset:AdventureAsset;mood?:ActorMood;motion?:React.MutableRefObject<boolean>;scale?:number}) {
  const {scene,animations}=useGLTF(adventureModelUrl(asset));
  const model=useMemo(()=>{const m=clone(scene);m.traverse((o:any)=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});return m;},[scene]);
  const prop=useMemo(()=>model.getObjectByName('PropR'),[model]);
  const mixer=useMemo(()=>new AnimationMixer(model),[model]);
  const clips=useMemo(()=>{
    const all=[...animations];
    if(asset==='moss')for(const [baseName,name] of [['Idle','CarryIdle'],['Walk','CarryRun']] as const){const base=animations.find(c=>c.name===baseName);if(base){const c=buildEmoteClip(scene,base,name,CARRY_KEYS.map((k,i)=>({...k,t:i*base.duration})));if(c)all.push(c);}}
    return all;
  },[animations,scene,asset]);
  const active=useRef('');
  const parts=useMemo(()=>new Map<string,Object3D>(['PipBody','PipHead','PipTail','PipLegL0','PipLegR0','PipLegL1','PipLegR1','GiantBody','GiantHead','GiantArmL','GiantArmR','GiantLegL','GiantLegR'].flatMap(n=>{const o=model.getObjectByName(n);return o?[[n,o] as [string,Object3D]]:[];})),[model]);
  const rest=useMemo(()=>new Map([...parts].map(([n,o])=>[n,{x:o.position.x,y:o.position.y,z:o.position.z,rx:o.rotation.x,ry:o.rotation.y,rz:o.rotation.z}])),[parts]);
  const time=useRef(0);
  useEffect(()=>()=>{mixer.stopAllAction();mixer.uncacheRoot(model);model.traverse((o:any)=>{if(o.isSkinnedMesh)o.skeleton.dispose();});},[model,mixer]);
  useFrame((_,delta)=>{
    if(!clips.length&&!parts.size)return;
    const t=time.current+=Math.min(delta,.1),walking=motion?.current??mood==='walk';
    const name=mood==='carry'?(walking?'CarryRun':'CarryIdle'):walking?'Walk':'Idle';
    if(clips.length && active.current!==name){
      const next=clips.find(c=>c.name===name)||clips[0], previous=clips.find(c=>c.name===active.current);
      const a=mixer.clipAction(next);a.reset().setLoop(LoopRepeat,Infinity).fadeIn(.2).play();
      if(previous&&previous!==next)mixer.clipAction(previous).fadeOut(.2);active.current=name;
    }
    mixer.update(delta*(walking?.8:1));
    prop?.scale.setScalar(0);
    const swing=sin(t*(asset==='pip'?11:3.3)), breathe=sin(t*2);
    for(const [n,o] of parts){const r=rest.get(n)!;o.position.set(r.x,r.y,r.z);o.rotation.set(r.rx,r.ry,r.rz);}
    if(asset==='pip') {
      const body=parts.get('PipBody')!,head=parts.get('PipHead')!,tail=parts.get('PipTail')!;
      body.position.z+=(walking?Math.abs(swing)*.04:breathe*.008); // authored Z-up object pivots
      head.rotation.x+=(walking?-.08:mood==='sniff'?.20+.08*sin(t*5):.04*breathe);
      head.rotation.z+=walking?0:.10*sin(t*1.4);
      tail.rotation.z+=sin(t*(mood==='happy'?7:3))*.30;
      tail.rotation.x+=.12;
      for(const [i,n] of ['PipLegL0','PipLegR0','PipLegL1','PipLegR1'].entries())parts.get(n)!.rotation.x+=walking?swing*.38*(i===0||i===3?1:-1):0;
    }
    if(asset==='berry-giant') {
      const head=parts.get('GiantHead')!,body=parts.get('GiantBody')!;
      const celebrating=mood==='happy'&&!walking,reduced=useSettingsStore.getState().reduceMotion;
      body.position.y+=walking?Math.abs(swing)*.06:celebrating&&reduced?0:breathe*.025;
      body.rotation.y+=walking?swing*.035:0;
      head.rotation.x+=celebrating?-.12:mood==='rest'?.12+breathe*.025:mood==='sniff'?-.10+.05*sin(t*3):-.03;
      head.rotation.z+=walking||celebrating&&reduced?0:sin(t*.8)*.06;
      for(const [i,n] of ['GiantArmL','GiantArmR','GiantLegL','GiantLegR'].entries()) {
        const part=parts.get(n)!;
        part.rotation.x+=walking?swing*(i<2?.18:.16)*(i%2===0?1:-1):celebrating&&reduced?0:breathe*.025;
        if(celebrating&&i<2) {
          // The exported model is Y-up: lift outwards around the shoulder.
          part.rotation.z+=(i===0?1:-1)*(1.9+(reduced?0:.12*sin(t*2.5+i)));
          part.rotation.x-=.16;
        }
      }
    }
  });
  return <primitive object={model} scale={scale} dispose={null}/>;
}

class AssetBoundary extends React.Component<{children:React.ReactNode}, {failed:boolean}> {
  state={failed:false};static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<Html center style={{pointerEvents:'none'}}><span className="adventure-world-label">Adventure · artwork unavailable</span></Html>:this.props.children;}
}
export function AdventureAssetView(props:React.ComponentProps<typeof AdventureModel>){return <AssetBoundary><Suspense fallback={null}><AdventureModel {...props}/></Suspense></AssetBoundary>;}

/** NPCs interpolate the server's 1.8-second steps; models never move authoritative state. */
export function AdventureActor({asset,x,z,label,speech,mood='idle',height=2.7,registryKey,onInteract,approachFirst=false,hoverAction,showLabel=true,showSpeech=true}: {asset:'gardener'|'moss'|'pip'|'berry-giant';x:number;z:number;label:string;speech?:string;mood?:ActorMood;height?:number;registryKey?:string;onInteract?:(event:{clientX:number;clientY:number})=>void;approachFirst?:boolean;hoverAction?:string;showLabel?:boolean;showSpeech?:boolean}) {
  const group=useRef<Group>(null), moving=useRef(false);
  const current=useRef({x,z,label,onInteract,approachFirst}),mounted=useRef(true);
  current.current={x,z,label,onInteract,approachFirst};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const showWorldLabels=useSettingsStore(state=>state.showWorldLabels);
  const initial=useRef(tileToWorld({x,z}));
  const move=useRef({from:new Vector3(...tileToWorld({x,z})),to:new Vector3(...tileToWorld({x,z})),elapsed:2,duration:1.8,yaw:Math.PI*.2});
  useEffect(()=>{
    const m=move.current;m.from.copy(group.current?.position??m.to);m.to.set(...tileToWorld({x,z}));m.elapsed=0;
    m.duration=m.from.distanceTo(m.to)>5?.55:1.8;
    if(m.from.distanceTo(m.to)>.01)m.yaw=Math.atan2(m.to.x-m.from.x,m.to.z-m.from.z);
  },[x,z]);
  useEffect(()=>{if(registryKey&&group.current)actors.set(registryKey,group.current);return()=>{if(registryKey)actors.delete(registryKey);};},[registryKey]);
  useFrame((_,dt)=>{const g=group.current;if(!g)return;const m=move.current;m.elapsed+=dt;const a=Math.min(1,m.elapsed/m.duration);g.position.lerpVectors(m.from,m.to,a);moving.current=a<1&&m.from.distanceToSquared(m.to)>.0001;const turn=Math.atan2(sin(m.yaw-g.rotation.y),cos(m.yaw-g.rotation.y));g.rotation.y+=turn*Math.min(1,dt*8);});
  return <group ref={group} position={initial.current} onClick={e=>{
    if(e.delta>5)return;e.stopPropagation();
    if(holdState.active||performance.now()<holdState.suppressClickUntil)return;
    const event={clientX:e.clientX,clientY:e.clientY,ray:e.ray?.clone()};
    // Actors wander during the walk: follow them until you arrive.
    const follow=(perform:()=>void)=>{
      const target={x:current.current.x,z:current.current.z};
      approachWorldInteraction({region:'bramblewild',...target},()=>{
        if(!mounted.current)return;
        const latest=current.current;
        if(latest.x!==target.x||latest.z!==target.z){follow(perform);return;}
        perform();
      });
    };
    const {onInteract,approachFirst,label}=current.current;
    if(!onInteract)openAdventureInteraction(label.split(' · ')[0],event,'expedition',follow);
    else if(approachFirst)follow(()=>current.current.onInteract?.(event));
    else onInteract(event);
  }} userData={{hoverTarget:{title:label.split(' · ')[0],action:hoverAction??adventureInteractionLabel('expedition'),click:'panel',detail:label.split(' · ').slice(1).join(' · '),radius:asset==='berry-giant'?1.8:.65}}}>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.017,0]} scale={asset==='berry-giant'?[1.8,1.25,1]:asset==='pip'?[.65,.9,1]:[.65,.45,1]} raycast={()=>null}>
      <circleGeometry args={[1,16]}/><meshBasicMaterial color="#233c2a" transparent opacity={.18} depthWrite={false}/>
    </mesh>
    <AdventureAssetView asset={asset} mood={mood} motion={moving}/>
    {showWorldLabels&&showLabel&&<Html position={[0,height,0]} center zIndexRange={[3,0]} style={{pointerEvents:'none',textAlign:'center'}}>
      {speech&&showSpeech&&<div className="adventure-world-label adventure-world-speech">
        {asset==='berry-giant'&&mood==='happy'&&<span className="adventure-world-hearts" aria-hidden="true">♥ ♥ ♥</span>}
        {speech}
      </div>}
      <span className="adventure-world-label" title={label}>{label.split(' · ')[0]}</span>
    </Html>}
  </group>;
}
const actors=new Map<string,Group>();
export const adventureActor=(key:string)=>actors.get(key);
