import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { STANCE_CLIPS, avatarClipSet, mirrorLowerBody, type AvatarClipSet } from '../animation/stance';
import { loadAdventurerRig, type AdventurerRig } from './adventurerRig';

let rig: AdventurerRig;
let set: AvatarClipSet;
beforeAll(async () => {
  rig = await loadAdventurerRig();
  set = avatarClipSet(rig.scene, rig.animations);
});
const at = (name: string) => rig.node(name).getWorldPosition(new Vector3());
const mirrored = (v: Vector3) => new Vector3(-v.x, v.y, v.z);

describe('stances', () => {
  it('mirrors only the lower body: the left foot steps forward, the arms and the grip stay as authored', () => {
    for (const name of ['Idle', 'Strike', 'Hit']) {
      const clip = set.clips.find((c) => c.name === name)!, flipped = set.mirrored.get(name)!;
      expect(flipped.name).toBe(name);
      for (const t of [0, clip.duration / 2, clip.duration]) {
        rig.pose(clip, t);
        const footL = at('FootL'), footR = at('FootR'), hand = at('HandR'), head = at('Head'), hips = at('Hips');
        rig.pose(flipped, t);
        expect(at('FootR').distanceTo(mirrored(footL)), `${name} FootR`).toBeLessThan(1e-4);
        expect(at('FootL').distanceTo(mirrored(footR)), `${name} FootL`).toBeLessThan(1e-4);
        expect(at('Hips').distanceTo(mirrored(hips))).toBeLessThan(1e-4);
        // Hips move sideways only if the clip moves them; arms keep their authored path relative to the hips.
        expect(at('HandR').sub(at('Hips')).distanceTo(hand.clone().sub(hips))).toBeLessThan(1e-4);
        expect(at('Head').sub(at('Hips')).distanceTo(head.clone().sub(hips))).toBeLessThan(1e-4);
      }
    }
    // In the authored stance the right foot leads; mirrored, the left.
    rig.pose(set.clips.find((c) => c.name === 'Idle')!, 0);
    expect(at('FootR').z).toBeGreaterThan(at('FootL').z + 0.1);
    rig.pose(set.mirrored.get('Idle')!, 0);
    expect(at('FootL').z).toBeGreaterThan(at('FootR').z + 0.1);
    expect([...set.mirrored.keys()].sort()).toEqual([...STANCE_CLIPS].sort());
    expect(mirrorLowerBody(set.clips[0])).toBe(mirrorLowerBody(set.clips[0]));
  });

  it("starts Run on the stance's lead foot, planted where it already stands", () => {
    const run = set.clips.find((c) => c.name === 'Run')!;
    rig.pose(set.clips.find((c) => c.name === 'Idle')!, 0);
    const leadR = at('FootR');
    rig.pose(run, set.runStart[0] * run.duration);
    const r = at('FootR'), l = at('FootL');
    expect(r.y).toBeLessThan(l.y - 0.05); // planted, the other foot swinging
    expect(Math.hypot(r.x - leadR.x, r.z - leadR.z)).toBeLessThan(0.06);
    rig.pose(run, set.runStart[1] * run.duration);
    const l2 = at('FootL'), r2 = at('FootR');
    expect(l2.y).toBeLessThan(r2.y - 0.05);
    expect(Math.hypot(l2.x - -leadR.x, l2.z - leadR.z)).toBeLessThan(0.06);
    // Half a stride apart.
    expect(Math.abs(Math.abs(set.runStart[1] - set.runStart[0]) - 0.5)).toBeLessThan(0.05);
  });
});
