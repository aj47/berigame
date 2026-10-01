import { beforeAll, describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import { avatarClipSet, type AvatarClipSet } from '../animation/stance';
import { STICK_SWING_CLIP } from '../animation/stickSwing';
import { LOOK_DEG, ProceduralLayer, type LayerInput } from '../animation/proceduralLayer';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadAdventurerRig, type AdventurerRig } from './adventurerRig';
import { makeAvatar, play, type Timeline, type TimelineCue } from './animationTimeline';

let rig: AdventurerRig;
let set: AvatarClipSet;
beforeAll(async () => {
  rig = await loadAdventurerRig();
  set = avatarClipSet(rig.scene, rig.animations);
});

const DEG = 180 / Math.PI;
/**
 * Rotation angle between two quaternions, accurate near zero. (Quaternion.angleTo
 * takes acos of the dot product, which turns float32 keyframe noise in a
 * quaternion's length into ~1e-3 rad even for identical rotations.)
 */
const angle = (a: Quaternion, b: Quaternion) => {
  const r = a.clone().conjugate().multiply(b);
  return 2 * Math.atan2(Math.hypot(r.x, r.y, r.z), Math.abs(r.w));
};
const worldQuaternion = (bone: Object3D) => bone.getWorldQuaternion(new Quaternion());
/** Yaw (degrees) of a bone's forward axis in the world. */
const yaw = (bone: Object3D) => { const f = new Vector3(0, 0, 1).applyQuaternion(worldQuaternion(bone)); return Math.atan2(f.x, f.z) * DEG; };
/** Sideways tilt (degrees) of a bone in the world. */
const roll = (bone: Object3D) => new Euler().setFromQuaternion(worldQuaternion(bone), 'YXZ').z * DEG;

/** Ten minutes of play: runs, stops, punches, swings, hits, a death and a respawn, then idling. */
function tenMinutes(): Timeline {
  const travels = [], cues: TimelineCue[] = [];
  let seq = 0;
  for (let t = 1000; t < 580_000; t += 12_000) {
    travels.push({ startMs: t, tiles: 1 + (t / 12_000) % 4, msPerTile: 300 });
    cues.push({ clip: 'Strike', durationMs: 500, seq: ++seq, at: t + 3000, role: 'action' });
    cues.push({ clip: 'Strike', durationMs: 500, seq: ++seq, at: t + 3500, role: 'action' });
    cues.push({ clip: STICK_SWING_CLIP, durationMs: 620, seq: ++seq, at: t + 5000, role: 'action' });
    cues.push({ clip: STICK_SWING_CLIP, durationMs: 620, seq: ++seq, at: t + 5620, role: 'action' });
    cues.push({ clip: 'Hit', durationMs: 400, seq: ++seq, at: t + 8000, role: 'reaction', arrive: t + 7700 });
  }
  cues.push({ clip: 'Hit', durationMs: 400, seq: ++seq, at: 585_300, role: 'reaction', arrive: 585_000 });
  return { endMs: 600_000, travels, cues, deadFrom: 585_000, aliveFrom: 590_000 };
}

describe('procedural layer', () => {
  it('never drifts: after ten minutes on top of every clip, restoring leaves exactly the clip pose', () => {
    const layered = makeAvatar(rig.scene, set, { seed: 21 });
    const reference = makeAvatar(rig.scene, set, { seed: 21, procedural: false });
    const shown = new Set<string>();
    let frames = 0;
    play([layered, reference], tenMinutes(), 60, () => { frames++; shown.add(layered.animator.director.clip); }, false);
    expect(frames).toBe(36_001);
    expect([...shown].sort()).toEqual(['Defeat', 'GetUp', 'Hit', 'Idle', 'Run', STICK_SWING_CLIP, 'Stop', 'Strike'].sort());
    expect(reference.animator.director.clip).toBe('Idle');
    // The layer is on: the pose differs...
    expect(angle(layered.bone('Chest').quaternion, reference.bone('Chest').quaternion) + angle(layered.bone('Head').quaternion, reference.bone('Head').quaternion)).toBeGreaterThan(1e-4);
    // ...and taking it off leaves the clip pose, not an accumulated offset.
    layered.animator.layer!.restore();
    let worst = 0, where = '';
    layered.model.traverse((object) => {
      const other = reference.bone(object.name);
      const error = Math.max(angle(object.quaternion, other.quaternion), object.position.distanceTo(other.position));
      if (error > worst) { worst = error; where = object.name; }
    });
    expect(worst, where).toBeLessThanOrEqual(1e-5);
  }, 60_000);

  it('breathes, shifts its weight and glances around while idle, with the feet planted', () => {
    const avatar = makeAvatar(rig.scene, set, { seed: 7 });
    const chest: Quaternion[] = [], hips: number[] = [], feet: Vector3[][] = [], look: number[] = [];
    play([avatar], { endMs: 9000 }, 60, (ms) => {
      if (ms < 500) return;
      chest.push(worldQuaternion(avatar.bone('Chest')));
      hips.push(avatar.bone('Hips').getWorldPosition(new Vector3()).x);
      feet.push(['FootL', 'FootR'].map((name) => avatar.bone(name).getWorldPosition(new Vector3())));
      look.push(yaw(avatar.bone('Head')) - yaw(avatar.bone('Chest')));
    });
    let chestRange = 0;
    for (let i = 0; i < chest.length; i += 3) for (let j = i + 3; j < chest.length; j += 3) chestRange = Math.max(chestRange, angle(chest[i], chest[j]) * DEG);
    expect(chestRange).toBeGreaterThanOrEqual(2);
    expect(chestRange).toBeLessThan(4);
    const sway = Math.max(...hips) - Math.min(...hips);
    expect(sway).toBeGreaterThan(0.02);
    expect(sway).toBeLessThan(0.035);
    const slip = Math.max(...feet.map((pair) => Math.max(...pair.map((foot, k) => Math.hypot(foot.x - feet[0][k].x, foot.z - feet[0][k].z)))));
    expect(slip).toBeLessThan(0.003);
    const glance = Math.max(...look.map(Math.abs));
    expect(glance).toBeGreaterThan(3);
    expect(glance).toBeLessThanOrEqual(LOOK_DEG + 0.5);
  });

  it('keeps the head out of a stick swing, and steadies it against the chest while running', () => {
    const layered = makeAvatar(rig.scene, set, { seed: 3 });
    const reference = makeAvatar(rig.scene, set, { seed: 3, procedural: false });
    const swingOffsets: number[] = [], chestSway: number[] = [], headSway: number[] = [];
    const timeline: Timeline = { endMs: 4500, travels: [{ startMs: 2000, tiles: 6, msPerTile: 300 }], cues: [
      { clip: STICK_SWING_CLIP, durationMs: 620, seq: 1, at: 600, role: 'action' },
    ] };
    play([layered, reference], timeline, 60, (ms) => {
      // From 150ms into the swing the neck and head carry no procedural offset.
      if (ms >= 750 && ms < 1220) swingOffsets.push(Math.max(...['Neck', 'Head'].map((name) => angle(layered.bone(name).quaternion, reference.bone(name).quaternion) * DEG)));
      if (ms >= 2600 && ms < 3800) { chestSway.push(roll(reference.bone('Chest'))); headSway.push(roll(layered.bone('Head'))); }
    });
    expect(Math.max(...swingOffsets)).toBeLessThan(0.5);
    const range = (values: number[]) => Math.max(...values) - Math.min(...values);
    // Run rocks the chest from side to side; the baked head counter-turn and the layer keep the head steadier.
    expect(range(chestSway)).toBeGreaterThan(8);
    expect(range(headSway)).toBeLessThan(range(chestSway) * 0.6);
  });

  it('swings the robe flaps back when setting off and forward when stopping', () => {
    const layered = makeAvatar(rig.scene, set, { seed: 5 });
    const reference = makeAvatar(rig.scene, set, { seed: 5, procedural: false });
    const flap: [number, number][] = [];
    // A bone points along its local +Y: down the flap.
    const along = new Vector3(0, 1, 0);
    const back = (bone: Object3D) => { const d = along.clone().applyQuaternion(worldQuaternion(bone)); return Math.atan2(-d.z, -d.y) * DEG; };
    play([layered, reference], { endMs: 2500, travels: [{ startMs: 500, tiles: 2, msPerTile: 300 }] }, 60, (ms) => {
      // Positive: the flap hangs further back (-Z, away from travel) than the clip alone puts it.
      flap.push([ms, back(layered.bone('RobeL')) - back(reference.bone('RobeL'))]);
    });
    const peak = (from: number, to: number, sign: number) => Math.max(...flap.filter(([ms]) => ms >= from && ms < to).map(([, v]) => sign * v));
    expect(peak(500, 1100, 1)).toBeGreaterThan(3);
    expect(peak(1100, 2000, -1)).toBeGreaterThan(2);
    // And settles.
    expect(Math.abs(flap.at(-1)![1])).toBeLessThan(0.5);
  });

  it('does not kick the robe flaps after a frame hitch', () => {
    const layer = new ProceduralLayer(SkeletonUtils.clone(rig.scene), 3);
    const input: LayerInput = { dt: 1 / 60, time: 0, idle: 0, run: 1, combat: 0, swing: 0, defeat: 0, x: 0, z: 0, yaw: 0 };
    for (let f = 0; f < 120; f++) { layer.restore(); input.time += input.dt; layer.apply(input); }
    // A hidden tab: 1.2 s pass in one frame and the avatar has moved 4 tiles.
    layer.restore();
    Object.assign(input, { dt: 1.2, time: input.time + 1.2, z: 4 });
    layer.apply(input);
    const angles = (layer as any).robeAngle as number[];
    expect(angles.length).toBeGreaterThan(0);
    for (const a of angles) expect(Math.abs(a)).toBeLessThan(0.05);
  });
});
