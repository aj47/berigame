import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Frustum, Plane, Quaternion, Vector3 } from 'three';
import { animationView } from '../animation/avatarAnimator';
import { avatarClipSet, type AvatarClipSet } from '../animation/stance';
import { loadAdventurerRig, type AdventurerRig } from './adventurerRig';
import { makeAvatar, play, type Timeline } from './animationTimeline';

let rig: AdventurerRig;
let set: AvatarClipSet;
beforeAll(async () => {
  rig = await loadAdventurerRig();
  set = avatarClipSet(rig.scene, rig.animations);
});
afterEach(() => { animationView.frustum = null; });

/** A view that contains nothing (every plane faces away, far above the island). */
const nowhere = () => { const p = () => new Plane(new Vector3(0, 1, 0), -1000); return new Frustum(p(), p(), p(), p(), p(), p()); };
const BONES = ['Hips', 'Spine', 'Chest', 'Head', 'UpperArmL', 'UpperArmR', 'ForearmR', 'ThighL', 'ShinR', 'FootL'];
const timeline: Timeline = { endMs: 3200, travels: [{ startMs: 200, tiles: 5, msPerTile: 500 }] };

function finalPose(offscreen: [number, number] | null) {
  const avatar = makeAvatar(rig.scene, set, { seed: 7, procedural: false });
  const skippedBefore = animationView.skipped;
  play([avatar], timeline, 60, (ms) => {
    animationView.frustum = offscreen && ms >= offscreen[0] && ms < offscreen[1] ? nowhere() : null;
  });
  const pose = BONES.map((name) => avatar.bone(name).quaternion.clone());
  const time = (avatar.animator.mixer as any)._actions.filter((a: any) => a.isRunning()).map((a: any) => a.time);
  return { pose, time, skipped: animationView.skipped - skippedBefore, avatar };
}

describe('off-screen avatars', () => {
  it('skip posing while out of view, keep clip time, and come back in the same pose', () => {
    const seen = finalPose(null);
    const culled = finalPose([900, 2000]);
    expect(seen.skipped).toBe(0);
    expect(culled.skipped).toBeGreaterThan(60);
    expect(culled.time.length).toBe(seen.time.length);
    culled.time.forEach((t: number, i: number) => expect(t).toBeCloseTo(seen.time[i], 4));
    culled.pose.forEach((q: Quaternion, i: number) => expect(q.angleTo(seen.pose[i]), BONES[i]).toBeLessThan(1e-4));
  });

  it('freezes bone world matrices only while off screen', () => {
    const avatar = makeAvatar(rig.scene, set, { seed: 3 });
    const bones: any[] = [];
    avatar.model.traverse((object: any) => { if (object.isBone) bones.push(object); });
    const anyFrozen = () => bones.some((bone) => bone.matrixWorldAutoUpdate === false);
    let frozen = false, thawed = false;
    play([avatar], { endMs: 1000 }, 60, (ms) => {
      if (ms > 300 && ms < 600) frozen ||= anyFrozen();
      if (ms > 700) thawed = !anyFrozen();
      animationView.frustum = ms >= 250 && ms < 600 ? nowhere() : null;
    });
    expect(frozen).toBe(true);
    expect(thawed).toBe(true);
  });

  it('costs much less per update than posing (node bench, logged)', () => {
    const crowd = Array.from({ length: 32 }, (_, i) => makeAvatar(rig.scene, set, { seed: i }));
    const run = (view: Frustum | null) => {
      animationView.frustum = view;
      const started = performance.now();
      play(crowd, { endMs: 2000, travels: [{ startMs: 100, tiles: 3, msPerTile: 500 }] }, 60, undefined, false);
      return (performance.now() - started) / 121;
    };
    run(null);
    const posed = run(null), culled = run(nowhere());
    console.log(`animation bench, 32 avatars: ${posed.toFixed(3)} ms/frame posed, ${culled.toFixed(3)} ms/frame off screen`);
    expect(culled).toBeLessThan(posed);
  });
});
