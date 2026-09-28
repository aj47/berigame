import { beforeAll, describe, expect, it } from 'vitest';
import type { AnimationAction } from 'three';
import { avatarClipSet, type AvatarClipSet } from '../animation/stance';
import { loadAdventurerRig, type AdventurerRig } from './adventurerRig';
import { makeAvatar, play } from './animationTimeline';

let rig: AdventurerRig;
let set: AvatarClipSet;
beforeAll(async () => {
  rig = await loadAdventurerRig();
  set = avatarClipSet(rig.scene, rig.animations);
});

/** Names of the clips the mixer is playing with weight. */
const playing = (avatar: ReturnType<typeof makeAvatar>) => {
  const mixer = avatar.animator.mixer as any;
  const names: string[] = [];
  for (let i = 0; i < mixer._nActiveActions; i++) {
    const action: AnimationAction = mixer._actions[i];
    if (action.getEffectiveWeight() > 0.01) names.push(action.getClip().name);
  }
  return names;
};

describe('wielded stick', () => {
  it('is baked into the body on PropR, hidden (scale 0) until wielded, and no clip animates it', () => {
    expect(rig.node('PropR').parent!.name).toBe('HandR');
    expect(rig.node('PropR').scale.toArray()).toEqual([0, 0, 0]);
    for (const clip of rig.animations) expect(clip.tracks.some((track) => track.name.startsWith('PropR.')), clip.name).toBe(false);
  });

  it('plays StickIdle and StickRun in place of Idle and Run, and swaps them live when the weapon changes', () => {
    const avatar = makeAvatar(rig.scene, set, { seed: 9 });
    const seen: Record<number, string[]> = {};
    play([avatar], { endMs: 3400, weapon: [[0, ''], [500, 'stick'], [2800, '']], travels: [{ startMs: 1000, tiles: 3, msPerTile: 300 }] }, 60, (ms) => {
      if ([400, 700, 1300, 2700, 3300].some((t) => Math.abs(ms - t) < 8)) seen[Math.round(ms / 100) * 100] = playing(avatar);
    });
    expect(seen[400]).toEqual(['Idle']);
    expect(seen[700]).toEqual(['StickIdle']);
    expect(seen[1300]).toEqual(['StickRun']);
    expect(seen[2700]).toEqual(['StickIdle']);
    expect(seen[3300]).toEqual(['Idle']);
    // The director still reports the logical clip.
    expect(avatar.animator.director.clip).toBe('Idle');
  });
});
