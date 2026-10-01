import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EMOTE_LIST, Emote } from '@sim';
import { EMOTE_CLIPS, buildEmoteClip, emoteCue, withEmotes } from '../animation/emotes';
import { CLIPS } from '../animation/combatPresentation';
import { avatarClips } from '../animation/pruneClips';
import { loadAdventurerRig, type AdventurerRig } from './adventurerRig';
import { avatarClipSet } from '../animation/stance';
import { makeAvatar } from './animationTimeline';
import type { AnimatorInput } from '../animation/avatarAnimator';

let rig: AdventurerRig;
beforeAll(async () => { rig = await loadAdventurerRig(); }, 30000);
const at = (name: string) => rig.node(name).getWorldPosition(new Vector3());

describe('emote clips', () => {
  it('every shared emote maps to a synthesized clip the director knows', () => {
    for (const def of EMOTE_LIST) {
      const cue = emoteCue(def.id)!;
      expect(EMOTE_CLIPS).toContain(cue.clip);
      expect(CLIPS).toContain(cue.clip);
    }
    expect(emoteCue(99)).toBeNull();
  });

  it('are added once per GLB and survive pruning', () => {
    const clips = avatarClips(rig.scene, rig.animations);
    for (const name of EMOTE_CLIPS) expect(clips.some((c) => c.name === name)).toBe(true);
    expect(withEmotes(rig.scene, rig.animations)).toBe(withEmotes(rig.scene, rig.animations));
  });

  it('wave lifts the right hand above the head and returns to rest', () => {
    const clip = buildEmoteClip(rig.scene, rig.clip('Idle'), 'Wave')!;
    rig.pose(clip, 0.8);
    expect(at('HandR').y).toBeGreaterThan(at('Head').y);
    expect(at('HandL').y).toBeLessThan(at('Chest').y);
    rig.pose(clip, clip.duration);
    expect(at('HandR').y).toBeLessThan(at('Chest').y);
  });

  it('cheer raises both hands; point reaches forward', () => {
    const cheer = buildEmoteClip(rig.scene, rig.clip('Idle'), 'Cheer')!;
    rig.pose(cheer, 0.62);
    expect(at('HandR').y).toBeGreaterThan(at('Head').y);
    expect(at('HandL').y).toBeGreaterThan(at('Head').y);
    const point = buildEmoteClip(rig.scene, rig.clip('Idle'), 'Point')!;
    rig.pose(point, 0.7);
    expect(at('HandR').z).toBeGreaterThan(0.45);
  });

  it('sit lowers the hips near the ground and holds (a cue clamps the last frame)', () => {
    const clip = buildEmoteClip(rig.scene, rig.clip('Idle'), 'Sit')!;
    rig.pose(clip, clip.duration);
    expect(at('Hips').y).toBeLessThan(0.5);
    expect(at('FootL').z).toBeGreaterThan(0.3);
    // The knees rise above the hips when seated.
    expect(at('ShinL').y).toBeGreaterThan(at('Hips').y - 0.05);
    expect(emoteCue(Emote.Sit)!.durationMs).toBeGreaterThan(10000);
  });
  it('new expressions have distinct full-body poses and finite joints throughout', () => {
    for (const name of ['Dance','Laugh','Bow','Shrug'] as const) {
      const c=buildEmoteClip(rig.scene,rig.clip('Idle'),name)!;
      for(let t=0;t<=c.duration;t+=.1){rig.pose(c,t);for(const joint of ['HandR','HandL','Head','FootR','FootL'])expect(at(joint).toArray().every(Number.isFinite)).toBe(true);expect(at('FootL').y).toBeGreaterThan(-.03);}
    }
    rig.pose(buildEmoteClip(rig.scene,rig.clip('Idle'),'Bow')!,.8);expect(at('Head').z).toBeGreaterThan(.25);
    rig.pose(buildEmoteClip(rig.scene,rig.clip('Idle'),'Shrug')!,.8);expect(at('HandL').x-at('HandR').x).toBeGreaterThan(.85);
    const dance=buildEmoteClip(rig.scene,rig.clip('Idle'),'Dance')!;rig.pose(dance,.3);const hip=at('Hips').x;rig.pose(dance,.6);expect(Math.abs(at('Hips').x-hip)).toBeGreaterThan(.08);
  });
  it('carrying preserves locomotion while both hands cradle the fruit', () => {
    const clips=avatarClips(rig.scene,rig.animations),run=clips.find(c=>c.name==='CarryRun')!;
    rig.pose(run,.1);const foot=at('FootL').z;expect(at('HandR').z).toBeGreaterThan(.4);expect(at('HandL').z).toBeGreaterThan(.4);
    rig.pose(run,.3);expect(Math.abs(at('FootL').z-foot)).toBeGreaterThan(.10);expect(at('HandR').z).toBeGreaterThan(.4);
  });
  it('switches between weapon and carrying poses without losing the walking cycle', () => {
    const avatar = makeAvatar(rig.scene, avatarClipSet(rig.scene, rig.animations), { procedural: false });
    const input: AnimatorInput = { now: 0, dt: 1/60, dead: false, cue: null, moving: true, speed: 2, x: 0, z: 0, yaw: 0, weapon: 'stick', carrying: false };
    const advance = () => { for (let i=0;i<30;i++) { input.now+=1000/60; avatar.animator.update(input); } };
    const playing = () => avatar.animator.director.layers.slice(0,avatar.animator.director.count).filter(l=>l.weight>.9).map(l=>(l.handle as any).getClip().name);
    advance(); expect(playing()).toContain('StickRun');
    input.carrying=true; advance(); expect(playing()).toContain('CarryRun');
    avatar.root.updateMatrixWorld(true);
    expect(avatar.bone('HandR').getWorldPosition(new Vector3()).z).toBeGreaterThan(.4);
    input.carrying=false; advance(); expect(playing()).toContain('StickRun');
    avatar.animator.dispose();
  });
});
