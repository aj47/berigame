import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EMOTE_LIST, Emote } from '@sim';
import { EMOTE_CLIPS, buildEmoteClip, emoteCue, withEmotes } from '../animation/emotes';
import { CLIPS } from '../animation/combatPresentation';
import { avatarClips } from '../animation/pruneClips';
import { loadAdventurerRig, type AdventurerRig } from './adventurerRig';

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
});
