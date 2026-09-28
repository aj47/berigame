import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Mesh, type MeshStandardMaterial } from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';
import { PlayerState, HAIR_STYLES, STICK_ITEM_ID, type Appearance } from '@sim';
import { acquirePalette, paletteKey } from '../../appearance/palette';
import type { AnimationCue } from '../../animation/combatPresentation';
import { stickMount } from '../../animation/stickSwing';
import { avatarClipSet } from '../../animation/stance';
import { AvatarAnimator, seedFromIdentity, skipBoneEulerSync, type AnimatorInput } from '../../animation/avatarAnimator';
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
  motion:React.MutableRefObject<{ moving:boolean; speed?:number; holdMs?:number }>;
  transient:React.MutableRefObject<AnimationCue|null>;
}
const STICK_MOUNT=stickMount();

const AdventurerModel=({url,appearance,identity,isSelf,state,weapon,motion,transient}:Props) => {
  const {scene,animations}=useGLTF(url) as any;
  // Every clip (the GLB's, the synthesized StickSwing, rest-pose channels pruned, both stances): built once per GLB.
  const clipSet=useMemo(()=>avatarClipSet(scene,animations),[scene,animations]);
  const model=useMemo(()=>{const clone=SkeletonUtils.clone(scene);skipBoneEulerSync(clone);return clone;},[scene]);
  const base=useMemo(()=>{let material:MeshStandardMaterial;scene.traverse((o:any)=>{if(o.isSkinnedMesh)material=o.material;});return material!;},[scene]);
  const seed=useMemo(()=>seedFromIdentity(identity),[identity]);
  const animator=useMemo(()=>new AvatarAnimator(model,clipSet,{seed}),[model,clipSet,seed]);
  useEffect(()=>()=>animator.dispose(),[animator]);
  // Reused every frame: nothing is allocated per avatar per frame.
  const input=useRef<AnimatorInput>({now:0,dt:0,dead:false,cue:null,moving:false,speed:0,holdMs:0,x:0,z:0,yaw:0});
  const revision=useRef(-1);
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
    revision.current=-1;
    // This key represents the required local character, including its chosen hair variant.
    if (isSelf) useLoadingStore.getState().addLoadedAsset(BASE_MODEL_URL);
    return ()=>{model.traverse((object:any)=>{if(object.isSkinnedMesh)object.skeleton.dispose();});};
  },[model,isSelf]);
  useFrame((_,delta)=>{
    const frame=input.current, travel=motion.current;
    frame.now=performance.now();
    frame.dead=state===PlayerState.Dead;
    frame.cue=transient.current;
    frame.moving=travel.moving;
    frame.speed=travel.speed??0;
    frame.holdMs=travel.holdMs??0;
    frame.dt=delta;
    // The avatar's group (PlayerAvatar) carries its ground position and facing.
    const group=model.parent;
    if(group){frame.x=group.position.x;frame.z=group.position.z;frame.yaw=group.rotation.y;}
    animator.update(frame);
    const director=animator.director;
    if(director.revision!==revision.current){
      revision.current=director.revision;
      model.userData.berigameAvatar.clip=director.clip;
      model.userData.berigameAvatar.cue=director.cueKey;
    }
  });
  return <primitive object={model} dispose={null} />;
};
useGLTF.preload(BASE_MODEL_URL);
export default AdventurerModel;
