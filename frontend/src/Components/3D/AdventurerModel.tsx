import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { LoopOnce, LoopRepeat, Mesh, type MeshStandardMaterial } from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';
import { PlayerState, HAIR_STYLES, STICK_ITEM_ID, type Appearance } from '@sim';
import { acquirePalette, paletteKey } from '../../appearance/palette';
import { CLIPS, cuePose, type Clip, type AnimationCue } from '../../animation/combatPresentation';
import { STICK_SWING_CLIP, stickMount, withStickSwing } from '../../animation/stickSwing';
import { useLoadingStore } from '../../store';
import { stickGeometry, stickMaterial } from './stickProp';

export const BASE_MODEL_URL='/models/starter-adventurer.glb';
export const modelUrl=(style:number) => style===0 ? BASE_MODEL_URL : `/models/starter-adventurer-${HAIR_STYLES[style]?.id ?? 'tousled'}.glb`;
interface Props {
  url:string;
  appearance:Appearance;
  identity:string;
  isSelf:boolean;
  state:number;
  /** The public player.weapon column: '' for bare fists, 'stick' while one is wielded. */
  weapon:string;
  motion:React.MutableRefObject<{ moving:boolean; speed?:number }>;
  transient:React.MutableRefObject<AnimationCue|null>;
}
const LOOPING=new Set<Clip>(['Idle','Run']);
/** A rig without a synthesized swing (should never happen) still attacks with the baked jab. */
const FALLBACK:Partial<Record<Clip,Clip>>={[STICK_SWING_CLIP]:'Strike'};
// The baked Run cycle's feet travel ~1.92 units/s at native cadence. Match them to ground speed.
const runScale=(speed?:number)=>Math.max(.85,Math.min(2.5,(speed??3.33)/1.92));
const STICK_MOUNT=stickMount();

const AdventurerModel=({url,appearance,identity,isSelf,state,weapon,motion,transient}:Props) => {
  const {scene,animations}=useGLTF(url) as any;
  // The GLB's clips plus the synthesized StickSwing: built once per GLB, and a stable array for useAnimations.
  const clips=useMemo(()=>withStickSwing(scene,animations),[scene,animations]);
  const model=useMemo(()=>SkeletonUtils.clone(scene),[scene]);
  const base=useMemo(()=>{let material:MeshStandardMaterial;scene.traverse((o:any)=>{if(o.isSkinnedMesh)material=o.material;});return material!;},[scene]);
  const {actions}=useAnimations(clips,model);
  const current=useRef('');
  const colors=paletteKey(appearance);
  useLayoutEffect(()=>{
    const palette=acquirePalette(base,appearance);
    // Only the skinned body takes the palette; a held stick keeps its own material.
    model.traverse((object:any)=>{if(object.isSkinnedMesh)object.material=palette.material;});
    model.userData.berigameAvatar={...model.userData.berigameAvatar,identity,appearance:{...appearance},modelUrl:url};
    return palette.release;
  },[model,base,colors,appearance.hairStyle,identity,url]);
  useLayoutEffect(()=>{
    model.userData.berigameAvatar={...model.userData.berigameAvatar,weapon};
    const hand=model.getObjectByName('HandR');
    if(weapon!==STICK_ITEM_ID||!hand)return;
    // Shared geometry and material, so nothing is disposed when the stick is put away.
    const stick=new Mesh(stickGeometry(),stickMaterial());
    stick.name='HeldStick';
    stick.position.fromArray(STICK_MOUNT.position);
    stick.quaternion.fromArray(STICK_MOUNT.quaternion);
    hand.add(stick);
    return ()=>{hand.remove(stick);};
  },[model,weapon]);
  useEffect(()=>{
    current.current='';
    // This key represents the required local character, including its chosen hair variant.
    if (isSelf) useLoadingStore.getState().addLoadedAsset(BASE_MODEL_URL);
    return ()=>{model.traverse((object:any)=>{if(object.isSkinnedMesh)object.skeleton.dispose();});};
  },[model,isSelf]);
  useFrame(()=>{
    const pose=cuePose(transient.current,performance.now()),dead=state===PlayerState.Dead;
    const wanted:Clip=dead?'Defeat':pose?pose.clip:motion.current.moving?'Run':'Idle';
    const desired:Clip=actions[wanted]?wanted:FALLBACK[wanted]??wanted;
    const key=desired+(pose&&!dead?pose.key:'');
    const next=actions[desired];
    if(desired==='Run'&&next)next.timeScale=runScale(motion.current.speed);
    if(key===current.current)return;
    // Resume the gait where it was if travel restarts during its fade-out; never restart each server tick.
    const run=actions.Run;
    const phase=run?.isRunning()?run.time/run.getClip().duration:0;
    const fade=pose?.05:.09;
    // Only the clips we play: touching every action would instantiate one per GLB clip.
    for(const clip of CLIPS)actions[clip]?.fadeOut(fade);
    if(next){
      const once=!LOOPING.has(desired);
      next.reset().setLoop(once?LoopOnce:LoopRepeat,once?1:Infinity);next.clampWhenFinished=once;
      next.timeScale=desired==='Run'?runScale(motion.current.speed):1;
      if(pose&&!dead)next.time=Math.min(pose.elapsedSeconds,next.getClip().duration);
      else if(desired==='Run')next.time=(phase%1)*next.getClip().duration;
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
