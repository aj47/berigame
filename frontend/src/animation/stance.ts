import {
  AnimationClip, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack,
  type Interpolant, type KeyframeTrack, type Object3D,
} from 'three';
import { avatarClips } from './pruneClips';

/**
 * Both feet stances. Every standing clip in the adventurer GLB (Idle, Stop,
 * Strike, Hit, Defeat...) plants the right foot forward. A run that stops, or
 * turns into an attack, with the left foot forward would have to slide both
 * feet past each other to reach that stance. So each standing clip also gets a
 * mirrored lower body (left foot forward), and the director picks the stance
 * whose lead foot matches the stride it is leaving.
 *
 * Only the hips, legs and robe flaps are mirrored: the arms, and so the stick
 * grip and every swing, stay exactly as authored.
 */
export type Stance = 0 | 1;

const PAIRS: readonly [string, string][] = [['ThighL', 'ThighR'], ['ShinL', 'ShinR'], ['FootL', 'FootR'], ['RobeL', 'RobeR']];
const SWAP = new Map<string, string>(PAIRS.flatMap(([l, r]) => [[l, r], [r, l]] as [string, string][]));
const CENTER = 'Hips';

/** Mirror across the body's left-right (X) plane. The rig's left/right bone frames are mirror images, so this holds for local values too. */
function mirrorValues(track: KeyframeTrack, channel: string): Float32Array {
  const values = Float32Array.from(track.values);
  const size = track.getValueSize();
  if (channel === 'quaternion') for (let i = 0; i < values.length; i += size) { values[i + 1] = -values[i + 1]; values[i + 2] = -values[i + 2]; }
  else if (channel === 'position') for (let i = 0; i < values.length; i += size) values[i] = -values[i];
  return values;
}

const mirrors = new WeakMap<AnimationClip, AnimationClip>();
/** The clip with its lower body mirrored (left foot forward). Tracks are shared where nothing changes. */
export function mirrorLowerBody(clip: AnimationClip): AnimationClip {
  let mirrored = mirrors.get(clip);
  if (mirrored) return mirrored;
  const tracks = clip.tracks.map((track): KeyframeTrack => {
    const dot = track.name.lastIndexOf('.');
    const bone = track.name.slice(0, dot), channel = track.name.slice(dot + 1);
    const swapped = SWAP.get(bone);
    if (!swapped && bone !== CENTER) return track;
    const name = `${swapped ?? bone}.${channel}`;
    if (channel !== 'quaternion' && channel !== 'position') {
      if (!swapped) return track;
      const renamed = track.clone();
      renamed.name = name;
      return renamed;
    }
    const values = mirrorValues(track, channel);
    const out = channel === 'quaternion' ? new QuaternionKeyframeTrack(name, track.times, values) : new VectorKeyframeTrack(name, track.times, values);
    out.setInterpolation(track.getInterpolation());
    return out;
  });
  mirrored = new AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
  mirrors.set(clip, mirrored);
  return mirrored;
}

/** Standing clips that get a mirrored stance. Run keeps its own stride; the director starts it on the stance's lead foot. */
export const STANCE_CLIPS: ReadonlySet<string> = new Set(['Idle', 'StickIdle', 'Stop', 'Strike', 'StickSwing', 'Hit', 'HitHeavy', 'Defeat']);

/**
 * Where to start Run from each stance: the phase (0..1) whose planted foot is
 * the stance's lead foot, closest to where that foot already stands, so the
 * first stride leaves the planted foot in place and lifts the other one.
 * Samples the rig once per GLB.
 */
export function runStartPhases(root: Object3D, run: AnimationClip, idle: AnimationClip, samples = 64): [number, number] {
  const rig = root.clone(true);
  rig.position.set(0, 0, 0); rig.quaternion.identity(); rig.scale.set(1, 1, 1);
  const nodes = new Map<string, Object3D>();
  rig.traverse((object) => { if (!nodes.has(object.name)) nodes.set(object.name, object); });
  const rest = new Map<Object3D, [number[], number[], number[]]>();
  rig.traverse((object) => rest.set(object, [object.position.toArray(), object.quaternion.toArray(), object.scale.toArray()]));
  const footL = nodes.get('FootL'), footR = nodes.get('FootR');
  if (!footL || !footR) return [0, 0.5];
  const samplers = (clip: AnimationClip) => clip.tracks.flatMap((track) => {
    const dot = track.name.lastIndexOf('.');
    const node = nodes.get(track.name.slice(0, dot)), channel = track.name.slice(dot + 1);
    if (!node || (channel !== 'position' && channel !== 'quaternion' && channel !== 'scale')) return [];
    return [{ node, channel: channel as 'position' | 'quaternion' | 'scale', interpolant: track.createInterpolant() as Interpolant }];
  });
  const runSamplers = samplers(run), idleSamplers = samplers(idle);
  const pose = (list: ReturnType<typeof samplers>, t: number) => {
    for (const [object, [p, q, s]] of rest) { object.position.fromArray(p); object.quaternion.fromArray(q); object.scale.fromArray(s); }
    for (const { node, channel, interpolant } of list) node[channel].fromArray(interpolant.evaluate(t) as unknown as number[]);
    rig.updateMatrixWorld(true);
    return [footL.getWorldPosition(new Vector3()), footR.getWorldPosition(new Vector3())];
  };
  const [, idleR] = pose(idleSamplers, 0);
  const strides = Array.from({ length: samples }, (_, i) => pose(runSamplers, (i / samples) * run.duration));
  const ground = Math.min(...strides.map(([l, r]) => Math.min(l.y, r.y)));
  const best = (lead: 0 | 1, target: Vector3) => {
    let phase = lead ? 0.5 : 0, cost = Infinity;
    strides.forEach((feet, i) => {
      const foot = feet[lead];
      if (foot.y > ground + 0.01) return; // the lead foot must be the planted one
      const d = Math.hypot(foot.x - target.x, foot.z - target.z);
      if (d < cost) { cost = d; phase = i / samples; }
    });
    return phase;
  };
  // Stance 0 (as authored) has the right foot forward; stance 1 mirrors it.
  const mirroredLead = new Vector3(-idleR.x, idleR.y, idleR.z);
  return [best(1, idleR), best(0, mirroredLead)];
}

export interface AvatarClipSet {
  /** Every clip, rest-pose channels pruned (pruneClips.ts). */
  clips: AnimationClip[];
  /** Standing clips with the lower body mirrored, by name. */
  mirrored: Map<string, AnimationClip>;
  /** Run start phase for stance 0 and stance 1. */
  runStart: [number, number];
}

const sets = new WeakMap<readonly AnimationClip[], AvatarClipSet>();
/** The adventurer's clips for a loaded GLB, built once per GLB. */
export function avatarClipSet(root: Object3D, glbClips: AnimationClip[]): AvatarClipSet {
  let set = sets.get(glbClips);
  if (!set) {
    const clips = avatarClips(root, glbClips);
    set = stanceSet(root, clips);
    sets.set(glbClips, set);
  }
  return set;
}

/** Mirrored stances and run start phases for an already prepared clip list. */
export function stanceSet(root: Object3D, clips: AnimationClip[]): AvatarClipSet {
  const mirrored = new Map<string, AnimationClip>();
  for (const clip of clips) if (STANCE_CLIPS.has(clip.name)) mirrored.set(clip.name, mirrorLowerBody(clip));
  const run = clips.find((clip) => clip.name === 'Run'), idle = clips.find((clip) => clip.name === 'Idle');
  const runStart: [number, number] = run && idle ? runStartPhases(root, run, idle) : [0, 0.5];
  return { clips, mirrored, runStart };
}
