import { AnimationClip, type KeyframeTrack, type Object3D } from 'three';
import { withStickSwing } from './stickSwing';

/**
 * Keyframe values are float32: a channel that never moves differs from its
 * first key, and from the node's rest value, by float noise (<= 1.5e-6 in the
 * shipped adventurer GLBs). Anything larger is real animation and is kept.
 */
const CONSTANT_EPSILON = 1e-5;
const REST_EPSILON = 1e-5;

type Channel = 'position' | 'quaternion' | 'scale';

function isConstant(track: KeyframeTrack): boolean {
  const size = track.getValueSize(), values = track.values;
  for (let i = size; i < values.length; i++) if (Math.abs(values[i] - values[i % size]) > CONSTANT_EPSILON) return false;
  return true;
}

function equalsRest(track: KeyframeTrack, rest: number[], channel: Channel): boolean {
  const values = track.values;
  let same = true, negated = channel === 'quaternion';
  for (let i = 0; i < rest.length; i++) {
    if (Math.abs(values[i] - rest[i]) > REST_EPSILON) same = false;
    // q and -q are the same rotation.
    if (Math.abs(values[i] + rest[i]) > REST_EPSILON) negated = false;
  }
  return same || negated;
}

/**
 * The clips without their rest-pose channels: tracks that hold one value for
 * the whole clip and that value is the node's rest (bind) transform.
 *
 * The mixer never binds a dropped track, so it neither evaluates nor applies
 * it every frame (the adventurer keeps ~21 of 78 tracks per clip). The pose is
 * unchanged: an unbound bone keeps its rest transform, and a bone that only
 * some playing clips animate is blended against the mixer's saved original
 * state, which is that same rest value, for the missing weight. That holds
 * while the playing weights sum to at most 1, which the clip director keeps.
 *
 * `root` must be the unposed GLTF scene (its nodes hold the rest transforms).
 */
export function pruneRestTracks(root: Object3D, clips: readonly AnimationClip[]): AnimationClip[] {
  const nodes = new Map<string, Object3D>();
  root.traverse((object) => { if (!nodes.has(object.name)) nodes.set(object.name, object); });
  return clips.map((clip) => {
    const tracks = clip.tracks.filter((track) => {
      const dot = track.name.lastIndexOf('.');
      const node = nodes.get(track.name.slice(0, dot));
      const channel = track.name.slice(dot + 1);
      if (!node || (channel !== 'position' && channel !== 'quaternion' && channel !== 'scale')) return true;
      const rest = channel === 'quaternion' ? node.quaternion.toArray() : node[channel].toArray();
      return !(isConstant(track) && equalsRest(track, rest, channel));
    });
    return tracks.length === clip.tracks.length ? clip : new AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
  });
}

const pruned = new WeakMap<readonly AnimationClip[], AnimationClip[]>();
/**
 * Every clip an adventurer can play: the GLB's clips plus the synthesized
 * StickSwing (withStickSwing), with rest-pose channels pruned. Built once per
 * loaded GLB, after the swing is synthesized from the unpruned Strike, and
 * referentially stable like withStickSwing's array.
 */
export function avatarClips(root: Object3D, clips: AnimationClip[]): AnimationClip[] {
  let cached = pruned.get(clips);
  if (!cached) {
    cached = pruneRestTracks(root, withStickSwing(root, clips));
    pruned.set(clips, cached);
  }
  return cached;
}
