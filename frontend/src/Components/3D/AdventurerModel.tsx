import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';
import { PlayerState, HAIR_STYLES, STICK_ITEM_ID, STONE_CLUB_ITEM_ID, FLINT_KNIFE_ITEM_ID, normalizeAppearance, type Appearance } from '@sim';
import { acquirePalette, paletteKey } from '../../appearance/palette';
import type { AnimationCue } from '../../animation/combatPresentation';
import { stickMount } from '../../animation/stickSwing';
import { avatarClipSet } from '../../animation/stance';
import { AvatarAnimator, seedFromIdentity, skipBoneEulerSync, type AnimatorInput } from '../../animation/avatarAnimator';
import { locateAvatar, registerAvatarGroup, unregisterAvatarGroup } from '../../animation/avatarRegistry';
import { useLoadingStore } from '../../store';
import { stickGeometry, stickMaterial } from './stickProp';
import { clubGeometry, clubMaterial } from './clubProp';
import { HEAD_BONE, NECK_BONE, cosmeticGeometry, cosmeticMaterial, knifeGeometry } from './cosmeticProps';
import { AvatarFx } from '../../fx/avatarFx';
import { inHitstop, knockOffset } from '../../fx/hitReaction';
import type { Resource } from '../../../../shared/sim/frontier/model';
import { gatheringMotion, gatheringTool } from '../../frontier/resourcePresentation';
import { gatheringToolGeometry, gatheringToolMaterial } from '../../frontier/gatheringTools';

import { BODY_SCALES, FACE_SCALES, mountAppearanceDetails } from '../../appearance/details';

const knock={x:0,z:0};

export const BASE_MODEL_URL='/models/starter-adventurer.glb';
export const modelUrl=(style:number) => style>=3 ? '/models/starter-adventurer-bald.glb' : style===0 ? BASE_MODEL_URL : `/models/starter-adventurer-${HAIR_STYLES[style]?.id ?? 'tousled'}.glb`;
interface Props {
  url:string;
  appearance:Appearance;
  identity:string;
  isSelf:boolean;
  state:number;
  /** The public player.weapon column: '' for bare fists, 'stick' while one is wielded. */
  weapon:string;
  carrying?:boolean;
  gathering?:Resource;
  motion:React.MutableRefObject<{ moving:boolean; speed?:number; holdMs?:number }>;
  transient:React.MutableRefObject<AnimationCue|null>;
  /** Worn milestone cosmetics (player_cosmetic head / neck: cosmetic id + 1, 0 = none). */
  head?:number;
  neck?:number;
  preview?:boolean;
}
const STICK_MOUNT=stickMount();

const AdventurerModel=({url,appearance,identity,isSelf,state,weapon,carrying=false,gathering,motion,transient,head=0,neck=0,preview=false}:Props) => {
  const {scene,animations}=useGLTF(url) as any;
  // Every clip (the GLB's, the synthesized StickSwing, rest-pose channels pruned, both stances): built once per GLB.
  const clipSet=useMemo(()=>avatarClipSet(scene,animations),[scene,animations]);
  const model=useMemo(()=>{const clone=SkeletonUtils.clone(scene);skipBoneEulerSync(clone);return clone;},[scene]);
  const base=useMemo(()=>{let material:MeshStandardMaterial;scene.traverse((o:any)=>{if(o.isSkinnedMesh)material=o.material;});return material!;},[scene]);
  const seed=useMemo(()=>seedFromIdentity(identity),[identity]);
  const animator=useMemo(()=>new AvatarAnimator(model,clipSet,{seed,locate:locateAvatar}),[model,clipSet,seed]);
  useEffect(()=>()=>animator.dispose(),[animator]);
  // Hit flash, footsteps, respawn chime and the harvest reach (fx/avatarFx.ts).
  const fx=useMemo(()=>new AvatarFx(model,identity,isSelf),[model,identity,isSelf]);
  // Reused every frame: nothing is allocated per avatar per frame.
  const input=useRef<AnimatorInput>({now:0,dt:0,dead:false,cue:null,moving:false,speed:0,holdMs:0,x:0,z:0,yaw:0,weapon:''});
  const revision=useRef(-1);
  const gatherKind = gathering ? gatheringMotion(gathering.item) : null;
  const gatherTool = gatheringTool(gathering);
  const gatherCue = useRef<AnimationCue>({ clip:'StickSwing',durationMs:620,at:0,seq:0,role:'action' });
  // This avatar's ground group, registered so defenders can tell a blow from behind (HitBack).
  const registered=useRef<Object3D|null>(null);
  useEffect(()=>()=>{if(registered.current)unregisterAvatarGroup(identity,registered.current);registered.current=null;},[identity]);
  const complete=normalizeAppearance(appearance);
  const appearanceKey=JSON.stringify(complete);
  const headBone=useMemo(()=>model.getObjectByName('Head'),[model]);
  useLayoutEffect(()=>{
    model.scale.fromArray(BODY_SCALES[complete.bodyType]);
    model.userData.berigameAvatar={...model.userData.berigameAvatar,appearance:complete};
    return mountAppearanceDetails(model,complete);
  },[model,appearanceKey]);
  const colors=paletteKey(appearance);
  useLayoutEffect(()=>{
    const palette=acquirePalette(base,appearance);
    // Only the skinned body takes the palette; a held stick keeps its own material.
    model.traverse((object:any)=>{if(object.isSkinnedMesh)object.material=palette.material;});
    fx.setPalette(palette.material);
    model.userData.berigameAvatar={...model.userData.berigameAvatar,identity,appearance:{...appearance},modelUrl:url};
    return palette.release;
  },[model,base,colors,appearance.hairStyle,identity,url,fx]);
  useLayoutEffect(()=>{
    model.userData.berigameAvatar={...model.userData.berigameAvatar,weapon};
    const armed=!carrying&&!gathering&&weapon===STICK_ITEM_ID;
    const club=!carrying&&!gathering&&(weapon===STONE_CLUB_ITEM_ID||weapon===FLINT_KNIFE_ITEM_ID);
    // Baked rigs skin the stick into the body on the PropR bone (rest scale 0): show it by
    // scaling the bone, with no extra mesh or draw call. No clip keys PropR.
    // The club is never baked: the PropR stick stays hidden and the club mounts under HandR.
    const prop=model.getObjectByName('PropR');
    if(prop&&!club){prop.scale.setScalar(armed?1:0);return ()=>{prop.scale.setScalar(0);};}
    if(prop)prop.scale.setScalar(0);
    // Older rigs (stick) and the club: a separate mesh in the right hand.
    const hand=model.getObjectByName('HandR');
    if(!(armed||club)||!hand)return;
    // Shared geometry and material, so nothing is disposed when the weapon is put away.
    const knife=weapon===FLINT_KNIFE_ITEM_ID;
    const held=knife?new Mesh(knifeGeometry(),clubMaterial()):club?new Mesh(clubGeometry(),clubMaterial()):new Mesh(stickGeometry(),stickMaterial());
    held.name=knife?'HeldKnife':club?'HeldClub':'HeldStick';
    held.position.fromArray(STICK_MOUNT.position);
    held.quaternion.fromArray(STICK_MOUNT.quaternion);
    hand.add(held);
    return ()=>{hand.remove(held);};
  },[model,weapon,carrying,!!gathering]);
  useLayoutEffect(() => {
    const hand = model.getObjectByName('HandR');
    if (!hand || !gatherTool) return;
    const tool = new Mesh(gatheringToolGeometry[gatherTool], gatheringToolMaterial);
    tool.name = gatherTool === 'axe' ? 'GatheringAxe' : gatherTool === 'hatchet' ? 'StarterHatchet' : 'GatheringPick';
    tool.position.fromArray(STICK_MOUNT.position);
    tool.quaternion.fromArray(STICK_MOUNT.quaternion);
    hand.add(tool);
    return () => { hand.remove(tool); };
  }, [model,gatherTool]);
  // Milestone cosmetics: one shared low-poly mesh per worn item on the Head / Neck bone.
  useLayoutEffect(()=>cosmeticMount(model,HEAD_BONE,head),[model,head]);
  useLayoutEffect(()=>cosmeticMount(model,NECK_BONE,neck),[model,neck]);
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
    const harvest = gathering?.harvest, epoch = Date.now();
    const working = !!harvest && epoch < harvest.completesAt && !frame.dead && !frame.moving;
    if (working && gatherKind !== 'pluck' && !frame.cue) {
      const cycle = Math.floor(Math.max(0,epoch - harvest!.startedAt) / 780);
      const cue = gatherCue.current;
      cue.at = frame.now - (epoch - harvest!.startedAt - cycle * 780);
      cue.seq = harvest!.startedAt + cycle;
      frame.cue = cue;
    }
    // Hitstop: a heavy blow freezes this avatar's clips for a few frames.
    frame.dt=inHitstop(identity,frame.now)?0:delta;
    frame.weapon=weapon;
    frame.carrying=carrying;
    // The avatar's group (PlayerAvatar) carries its ground position and facing.
    const group=model.parent;
    if(group){
      frame.x=group.position.x;frame.z=group.position.z;frame.yaw=group.rotation.y;
      if(!preview&&registered.current!==group){if(registered.current)unregisterAvatarGroup(identity,registered.current);registered.current=group;registerAvatarGroup(identity,group);}
    }
    // Knockback rides on the model inside the group (group = tile motion), in the group's local frame.
    if(knockOffset(identity,frame.now,knock)||model.position.x!==0||model.position.z!==0){
      const c=Math.cos(frame.yaw),s=Math.sin(frame.yaw);
      model.position.x=knock.x*c-knock.z*s;model.position.z=knock.x*s+knock.z*c;
    }
    if(!preview)fx.beforeAnimate();
    animator.update(frame);
    headBone?.scale.fromArray(FACE_SCALES[complete.faceShape]);
    const director=animator.director;
    if(!preview)fx.afterAnimate(frame.now,delta,frame.x,frame.z,frame.moving,frame.speed,frame.dead,director.clip==='Idle'||director.clip==='Stop',working && gatherKind === 'pluck');
    if(director.revision!==revision.current){
      revision.current=director.revision;
      model.userData.berigameAvatar.clip=director.clip;
      model.userData.berigameAvatar.cue=director.cueKey;
    }
  });
  return <primitive object={model} dispose={null} />;
};
/** Mounts worn cosmetic `worn` (id + 1) under `boneName`; returns the cleanup. */
function cosmeticMount(model:Object3D,boneName:string,worn:number):(()=>void)|undefined{
  const geometry=worn>0?cosmeticGeometry(worn-1):null;
  const bone=model.getObjectByName(boneName);
  if(!geometry||!bone)return;
  const mesh=new Mesh(geometry,cosmeticMaterial());
  mesh.name=`Cosmetic${worn-1}`;
  mesh.castShadow=false;
  bone.add(mesh);
  model.userData.berigameAvatar={...model.userData.berigameAvatar,[boneName==='Head'?'head':'neck']:worn};
  return ()=>{bone.remove(mesh);};
}
useGLTF.preload(BASE_MODEL_URL);
// Memoized: its props only change with appearance, life state or weapon; motion and cues arrive through refs.
export default React.memo(AdventurerModel);
