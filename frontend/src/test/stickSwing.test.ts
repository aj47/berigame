import { beforeAll, describe, expect, it } from 'vitest';
import { AnimationClip, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import {
  STICK_BUTT, STICK_LENGTH, STICK_RADIUS, STICK_SWING_CLIP, STICK_SWING_IMPACT_MS, STICK_SWING_KEYS, STICK_SWING_MS,
  buildStickSwing, stickMount, stickSegment, withStickSwing,
} from '../animation/stickSwing';
import { stickGeometry } from '../Components/3D/stickProp';
import { loadAdventurerRig, type AdventurerRig } from './adventurerRig';

let rig: AdventurerRig;
/** The runtime-synthesized chop (the fallback for rigs without a baked StickSwing). */
let swing: AnimationClip;
/** The clip the game plays: the GLB's baked StickSwing. */
let baked: AnimationClip;
beforeAll(async () => {
  rig = await loadAdventurerRig();
  swing = buildStickSwing(rig.scene, rig.clip('Strike'))!;
  baked = rig.clip(STICK_SWING_CLIP);
});

/** Butt, tip and pointing direction of the held stick in the current pose. */
function held() {
  const [butt, tip] = stickSegment(rig.node('HandR').matrixWorld);
  return { butt, tip, direction: tip.clone().sub(butt).normalize(), wrist: rig.node('HandR').getWorldPosition(new Vector3()) };
}
const at = (clip: AnimationClip, t: number) => { rig.pose(clip, t); return held(); };
const samples = (clip: AnimationClip, step: number) => Array.from({ length: Math.floor(clip.duration / step + 1e-6) + 1 }, (_, i) => i * step);

describe('StickSwing clip', () => {
  it('is synthesized from the rig with the same tracks as the baked clips', () => {
    const strike = rig.clip('Strike');
    expect(swing.name).toBe(STICK_SWING_CLIP);
    expect(swing.duration).toBeCloseTo(STICK_SWING_MS / 1000);
    expect(swing.tracks.map((track) => track.name).sort()).toEqual(strike.tracks.map((track) => track.name).sort());
    expect(swing.validate()).toBe(true);
    for (const track of swing.tracks) expect(track.times.length).toBeGreaterThanOrEqual(STICK_SWING_MS / 1000 * 30);
  });

  it('passes through every key: the wrist reaches its target and the stick points along the key', () => {
    for (const key of STICK_SWING_KEYS) {
      const pose = at(swing, key.t);
      expect(pose.wrist.distanceTo(new Vector3(...key.hand)), `wrist at ${key.t}s`).toBeLessThan(0.02);
      expect(pose.direction.angleTo(new Vector3(...key.stick).normalize()), `stick at ${key.t}s`).toBeLessThan(0.05);
    }
  });

  it('starts and ends on the baked Idle grip, so the crossfades in and out are seamless', () => {
    const idle = at(rig.clip('Idle'), 0);
    for (const t of [0, swing.duration]) {
      const pose = at(swing, t);
      expect(pose.wrist.distanceTo(idle.wrist)).toBeLessThan(0.01);
      expect(pose.direction.angleTo(idle.direction)).toBeLessThan(0.02);
    }
  });

  it('winds up over the shoulder, lands on an opponent one tile ahead at impact, then follows through low', () => {
    const windUp = at(swing, 0.18);
    expect(windUp.tip.y).toBeGreaterThan(2.2);
    expect(windUp.tip.z).toBeLessThan(0);
    expect(windUp.tip.x).toBeLessThan(-0.4); // Cocked beside the head, on the right.
    const impact = at(swing, STICK_SWING_IMPACT_MS / 1000);
    expect(impact.tip.z).toBeGreaterThan(0.9); // An adjacent opponent stands one unit ahead.
    expect(impact.tip.y).toBeGreaterThan(1.4);
    expect(impact.tip.y).toBeLessThan(2.0);
    const through = at(swing, 0.46);
    expect(through.tip.y).toBeLessThan(0.8);
    expect(through.tip.x).toBeGreaterThan(0); // Diagonal: ends across to the left.
    expect(windUp.direction.angleTo(through.direction)).toBeGreaterThan((150 * Math.PI) / 180);
    // Before impact the stick is still coming down from above.
    expect(at(swing, 0.25).tip.y).toBeGreaterThan(impact.tip.y + 0.3);
  });

  it('measures clearance against the posed body (a stick through the head reads as touching it)', () => {
    rig.pose(rig.clip('Idle'), 0);
    const head = rig.node('Head').getWorldPosition(new Vector3()).add(new Vector3(0, 0.19, 0));
    expect(rig.clearance(head.clone().add(new Vector3(0, 0, -0.5)), head.clone().add(new Vector3(0, 0, 0.5))).distance).toBe(0);
    const beside = head.clone().add(new Vector3(-0.45, 0, 0));
    const near = rig.clearance(beside.clone().add(new Vector3(0, 0, -0.3)), beside.clone().add(new Vector3(0, 0, 0.3)));
    expect(near.distance).toBeGreaterThan(0.05);
    expect(near.distance).toBeLessThan(0.2);
    expect(near.bone).toBe('Head');
  });

  it('is baked into the GLB with the same length and impact timing as the runtime chop', () => {
    expect(baked).toBeDefined();
    expect(baked.duration * 1000).toBeGreaterThan(STICK_SWING_MS - 10);
    expect(baked.duration * 1000).toBeLessThanOrEqual(STICK_SWING_MS);
    // Wind-up: the stick is raised high over the right shoulder.
    const windUp = at(baked, 0.18);
    expect(windUp.tip.y).toBeGreaterThan(2.1);
    expect(windUp.butt.x).toBeLessThan(-0.2);
    // Impact: the tip meets an opponent one tile ahead at head/shoulder height.
    const impact = at(baked, STICK_SWING_IMPACT_MS / 1000);
    expect(impact.tip.z).toBeGreaterThan(0.8);
    expect(impact.tip.y).toBeGreaterThan(1.1);
    expect(impact.tip.y).toBeLessThan(1.9);
    // Follow-through: low and across to the left.
    const through = at(baked, 0.42);
    expect(through.tip.y).toBeLessThan(impact.tip.y);
    expect(through.tip.x).toBeGreaterThan(impact.tip.x);
    // The stick sweeps fastest just before impact: the tip moves more over the last 50 ms than over the first 50 ms.
    const early = at(baked, 0.05).tip.distanceTo(at(baked, 0).tip), late = at(baked, 0.3).tip.distanceTo(at(baked, 0.25).tip);
    expect(late).toBeGreaterThan(3 * early);
    // It ends on the StickIdle grip, so the crossfade back is seamless.
    const idle = at(rig.clip('StickIdle'), 0), end = at(baked, baked.duration);
    expect(end.wrist.distanceTo(idle.wrist)).toBeLessThan(0.02);
    expect(end.direction.angleTo(idle.direction)).toBeLessThan(0.05);
  });

  it('keeps the stick out of the head, body and ground in the swing and every clip it is carried in', () => {
    const grip = (pose: ReturnType<typeof held>, s: number) => pose.butt.clone().addScaledVector(pose.direction, STICK_BUTT + s);
    // While wielded the game plays StickIdle/StickRun in place of Idle/Run.
    const clips = [baked, swing, rig.clip('StickIdle'), rig.clip('StickRun'), rig.clip('Hit'), rig.clip('HitHeavy'), rig.clip('Defeat')];
    for (const clip of clips) {
      for (const t of samples(clip, clip.duration > 1 ? 0.05 : 1 / 60)) {
        const pose = at(clip, t);
        // The shaft above the fist, and the butt below it (which may rest against its own forearm).
        const shaft = rig.clearance(grip(pose, 0.06), pose.tip);
        const butt = rig.clearance(pose.butt, grip(pose, -0.04), ['ForearmR']);
        expect(shaft.distance, `${clip.name}@${t.toFixed(2)} shaft near ${shaft.bone}`).toBeGreaterThan(STICK_RADIUS);
        expect(butt.distance, `${clip.name}@${t.toFixed(2)} butt near ${butt.bone}`).toBeGreaterThan(STICK_RADIUS);
        expect(Math.min(pose.tip.y, pose.butt.y)).toBeGreaterThan(0.2);
      }
    }
  }, 30_000);

  it.each(['starter-adventurer-topknot.glb', 'starter-adventurer-cropped.glb'])('clears the %s hair too', async (file) => {
    const variant = await loadAdventurerRig(file);
    for (const clip of [variant.clip(STICK_SWING_CLIP), variant.clip('StickIdle'), variant.clip('StickRun'), variant.clip('Hit')]) {
      for (const t of samples(clip, clip.duration > 1 ? 0.1 : 1 / 60)) {
        variant.pose(clip, t);
        const [butt, tip] = stickSegment(variant.node('HandR').matrixWorld);
        const direction = tip.clone().sub(butt).normalize();
        const shaft = variant.clearance(butt.clone().addScaledVector(direction, STICK_BUTT + 0.06), tip);
        expect(shaft.distance, `${file} ${clip.name}@${t.toFixed(2)} near ${shaft.bone}`).toBeGreaterThan(STICK_RADIUS);
      }
    }
  }, 30_000);
});

describe('withStickSwing', () => {
  it('appends StickSwing once and hands back the same array for the same GLB', () => {
    const unbaked = rig.animations.filter((clip) => clip.name !== STICK_SWING_CLIP);
    const clips = withStickSwing(rig.scene, unbaked);
    expect(withStickSwing(rig.scene, unbaked)).toBe(clips);
    expect(clips).toHaveLength(unbaked.length + 1);
    expect(clips.slice(0, -1)).toEqual(unbaked);
    expect(clips.at(-1)!.name).toBe(STICK_SWING_CLIP);
  });

  it('keeps a baked StickSwing instead of synthesizing one', () => {
    expect(withStickSwing(rig.scene, rig.animations)).toBe(rig.animations);
  });

  it('leaves a rig without the adventurer arm untouched', () => {
    const strike = new AnimationClip('Strike', 0.5, []);
    expect(buildStickSwing(new Object3D(), strike)).toBeNull();
    const clips = [strike];
    expect(withStickSwing(new Object3D(), clips)).toBe(clips);
  });
});

describe('held stick prop', () => {
  it('mounts the modelled stick exactly on the grip segment', () => {
    const { position, quaternion } = stickMount();
    const mount = new Matrix4().compose(new Vector3(...position), new Quaternion(...quaternion), new Vector3(1, 1, 1));
    const [butt, tip] = stickSegment(new Matrix4());
    expect(new Vector3(0, 0, 0).applyMatrix4(mount).distanceTo(butt)).toBeLessThan(1e-6);
    expect(new Vector3(0, STICK_LENGTH, 0).applyMatrix4(mount).distanceTo(tip)).toBeLessThan(1e-6);
  });

  it('is one small, low-poly, vertex-coloured branch from butt (y=0) to tip', () => {
    const geometry = stickGeometry();
    expect(stickGeometry()).toBe(geometry);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeGreaterThan(STICK_LENGTH - 0.01);
    expect(box.max.y).toBeLessThan(STICK_LENGTH + 0.03);
    expect(Math.max(-box.min.x, -box.min.z, box.max.z)).toBeLessThan(STICK_RADIUS + 0.02);
    expect(geometry.attributes.position.count / 3).toBeLessThan(120);
    expect(geometry.attributes.color.count).toBe(geometry.attributes.position.count);
  });
});
