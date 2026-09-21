import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { LoopOnce, LoopRepeat, type MeshStandardMaterial } from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';
import { PlayerState, Stance, HAIR_STYLES, type Appearance } from '@sim';
import { acquirePalette, paletteKey } from '../../appearance/palette';
import { cuePose, type Clip, type AnimationCue } from '../../animation/combatPresentation';
import { useLoadingStore } from '../../store';

export const BASE_MODEL_URL='/models/starter-adventurer.glb';
export const modelUrl=(style:number) => style===0 ? BASE_MODEL_URL : `/models/starter-adventurer-${HAIR_STYLES[style]?.id ?? 'tousled'}.glb`;
interface Props {
  url:string;
  appearance:Appearance;
  identity:string;
  isSelf:boolean;
  state:number;
  stance:number;
  motion:React.MutableRefObject<{ moving:boolean; speed?:number }>;
  transient:React.MutableRefObject<AnimationCue|null>;
}
const AdventurerModel=({url,appearance,identity,isSelf,state,stance,motion,transient}:Props) => {
  const {scene,animations}=useGLTF(url) as any;
  const model=useMemo(()=>SkeletonUtils.clone(scene),[scene]);
  const base=useMemo(()=>{let material:MeshStandardMaterial;scene.traverse((o:any)=>{if(o.isMesh)material=o.material;});return material!;},[scene]);
  const {actions}=useAnimations(animations,model);
  const current=useRef('');
  const colors=paletteKey(appearance);
  useLayoutEffect(()=>{
    const palette=acquirePalette(base,appearance);
    model.traverse((object:any)=>{if(object.isMesh)object.material=palette.material;});
    model.userData.berigameAvatar={identity,appearance:{...appearance},modelUrl:url};
    return palette.release;
  },[model,base,colors,appearance.hairStyle,identity,url]);
  useEffect(()=>{
    current.current='';
    // This key represents the required local character, including its chosen hair variant.
    if (isSelf) useLoadingStore.getState().addLoadedAsset(BASE_MODEL_URL);
    return ()=>{model.traverse((object:any)=>{if(object.isSkinnedMesh)object.skeleton.dispose();});};
  },[model,isSelf]);
  useFrame(()=>{
    const pose=cuePose(transient.current,performance.now()),dead=state===PlayerState.Dead;
    const locomotion:Clip=stance===Stance.Guard?'RunGuard':stance===Stance.Grab?'RunGrab':'Run';
    const desired:Clip=dead?'Defeat':pose?pose.clip:motion.current.moving?locomotion:stance===Stance.Guard?'Guard':stance===Stance.Grab?'GrabReady':'Idle';
    const key=desired+(pose&&!dead?pose.key:'');
    const next=actions[desired];
    // Exported stance-foot travel is ~1.92 units/s at native cadence. Match feet to ground speed.
    if(desired.startsWith('Run')&&next)next.timeScale=Math.max(.85,Math.min(2.5,(motion.current.speed??3.33)/1.92));
    if(key===current.current)return;
    // Preserve gait phase when changing stance during travel; never restart each server tick.
    const previous=Object.values(actions).find(a=>a?.isRunning()&&a.getClip().name.startsWith('Run'));
    const phase=previous?previous.time/previous.getClip().duration:0;
    const fade=pose?.05:.09;
    for(const action of Object.values(actions))action?.fadeOut(fade);
    if(next){
      const once=!['Idle','Walk','Run','RunGrab','RunGuard','GrabReady','Guard'].includes(desired);
      next.reset().setLoop(once?LoopOnce:LoopRepeat,once?1:Infinity);next.clampWhenFinished=once;
      next.timeScale=desired.startsWith('Run')?Math.max(.85,Math.min(2.5,(motion.current.speed??3.33)/1.92)):1;
      if(pose&&!dead)next.time=Math.min(pose.elapsedSeconds,next.getClip().duration);
      else if(desired.startsWith('Run'))next.time=(phase%1)*next.getClip().duration;
      next.fadeIn(fade).play();
    }
    model.userData.berigameAvatar.clip=desired;
    model.userData.berigameAvatar.cue=pose?.key??null;
    current.current=key;
  });
  return <primitive object={model} dispose={null} />;
};
useGLTF.preload(BASE_MODEL_URL);
export default AdventurerModel;
