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
    const allFrozen = () => bones.every((bone) => !bone.matrixWorldAutoUpdate && !bone.matrixAutoUpdate);
    let frozen = false, hidden = false, thawed = false, shown = false;
    play([avatar], { endMs: 1000 }, 60, (ms) => {
      if (ms > 300 && ms < 600) { frozen ||= allFrozen(); hidden ||= !avatar.model.visible; }
      if (ms > 700) { thawed = !anyFrozen(); shown = avatar.model.visible; }
      animationView.frustum = ms >= 250 && ms < 600 ? nowhere() : null;
    });
    expect(frozen).toBe(true);
    // A frozen skeleton stays where the avatar was: none of it may draw while frozen.
    expect(hidden).toBe(true);
    expect(thawed).toBe(true);
    expect(shown).toBe(true);
  });

  it('never culls an avatar that opts out (a preview in its own canvas)', () => {
    const avatar = makeAvatar(rig.scene, set, { seed: 5, cull: false });
    const skippedBefore = animationView.skipped;
    let hidden = false;
    play([avatar], { endMs: 600 }, 60, () => { animationView.frustum = nowhere(); hidden ||= !avatar.model.visible; });
    expect(animationView.skipped - skippedBefore).toBe(0);
    expect(hidden).toBe(false);
  });

  it('pins the body bounds to the rest pose, so culling never depends on the first rendered pose', () => {
    const avatar = makeAvatar(rig.scene, set, { seed: 2 });
    const bodies: any[] = [];
    avatar.model.traverse((object: any) => { if (object.isSkinnedMesh) bodies.push(object); });
    expect(bodies.length).toBeGreaterThan(0);
    const pinned = bodies.map((mesh) => mesh.boundingSphere?.clone());
    for (const sphere of pinned) {
      expect(sphere).toBeTruthy();
      // Around the body (feet at the origin), roomy enough for raised arms.
      expect(sphere.center.y).toBeGreaterThan(0.5);
      expect(sphere.radius).toBeGreaterThan(1.2);
    }
    play([avatar], timeline, 60);
    bodies.forEach((mesh, i) => expect(mesh.boundingSphere.equals(pinned[i])).toBe(true));
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
