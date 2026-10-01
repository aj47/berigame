/**
 * Test helper: drive real adventurer rigs through scripted timelines at a
 * fixed frame rate with the game's own animation code (AvatarAnimator), and
 * root motion that follows useTileMotion's rules for straight travel.
 */
import { Group, type Object3D } from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimationCue } from '../animation/combatPresentation';
import { MOVEMENT_ANIMATION_GRACE_MS, START_EASE_MS, easedElapsed, easedSpeedFactor } from '../animation/locomotion';
import { AvatarAnimator, skipBoneEulerSync, type AnimatorInput, type AnimatorOptions } from '../animation/avatarAnimator';
import type { AvatarClipSet } from '../animation/stance';

/** Straight confirmed travel along +Z, starting from rest. */
export interface Travel { startMs: number; tiles: number; msPerTile: number }
/** A cue as the combat store holds it; `arrive` is when its event reaches the client (a reaction starts later, at impact). */
export type TimelineCue = AnimationCue & { arrive?: number };
export interface Timeline {
  endMs: number;
  travels?: Travel[];
  cues?: TimelineCue[];
  /** Dead from this time (until `aliveFrom`, if set). */
  deadFrom?: number;
  aliveFrom?: number;
  /** player.weapon from this time on: [ms, weapon] pairs in time order. */
  weapon?: [number, string][];
}

export interface Avatar {
  root: Group;
  model: Object3D;
  animator: AvatarAnimator;
  bone: (name: string) => Object3D;
}

export function makeAvatar(scene: Object3D, set: AvatarClipSet, options: AnimatorOptions = {}): Avatar {
  const model = SkeletonUtils.clone(scene);
  skipBoneEulerSync(model);
  const root = new Group();
  root.add(model);
  const bones = new Map<string, Object3D>();
  model.traverse((object) => { if (!bones.has(object.name)) bones.set(object.name, object); });
  return { root, model, animator: new AvatarAnimator(model, set, options), bone: (name) => bones.get(name)! };
}

/**
 * Root z and the motion fields useTileMotion would report at `now`. A route
 * that starts while the previous one is still travelling or holding continues
 * at full speed; one that starts from a standstill eases in.
 */
export function travelAt(travels: Travel[] | undefined, now: number) {
  let z = 0;
  const list = travels ?? [];
  for (let i = 0; i < list.length; i++) {
    const travel = list[i], next = list[i + 1], previous = list[i - 1];
    if (now < travel.startMs) break;
    const duration = travel.tiles * travel.msPerTile, elapsed = now - travel.startMs;
    if ((next && now >= next.startMs) || elapsed >= duration + MOVEMENT_ANIMATION_GRACE_MS) { z += travel.tiles; continue; }
    const fromRest = !previous || travel.startMs >= previous.startMs + previous.tiles * previous.msPerTile + MOVEMENT_ANIMATION_GRACE_MS;
    const ease = fromRest ? Math.min(START_EASE_MS, duration) : 0;
    const alpha = Math.min(1, easedElapsed(elapsed, ease) / duration);
    const speed = 1000 / travel.msPerTile;
    if (alpha < 1) return { z: z + alpha * travel.tiles, moving: true, speed: speed * easedSpeedFactor(elapsed, ease), holdMs: 0 };
    return { z: z + travel.tiles, moving: true, speed, holdMs: elapsed - duration };
  }
  return { z, moving: false, speed: 0, holdMs: 0 };
}

/** The cue the combat store would hold at `now`: the latest to arrive, cleared 1400ms after its event. */
export function cueAt(cues: TimelineCue[] | undefined, now: number): AnimationCue | null {
  let chosen: TimelineCue | null = null;
  for (const cue of cues ?? []) if ((cue.arrive ?? cue.at) <= now) chosen = cue;
  return chosen && now <= (chosen.arrive ?? chosen.at) + 1400 ? chosen : null;
}

/**
 * Step every avatar through the timeline; `onFrame` runs after each frame with
 * world matrices up to date (unless `matrices` is false, for long runs).
 */
export function play(avatars: Avatar[], timeline: Timeline, fps = 60, onFrame?: (ms: number, frame: number) => void, matrices = true): void {
  const dtMs = 1000 / fps;
  const input: AnimatorInput = { now: 0, dt: 0, dead: false, cue: null, moving: false, speed: 0, holdMs: 0, x: 0, z: 0, yaw: 0 };
  for (let frame = 0; frame * dtMs <= timeline.endMs + 1e-6; frame++) {
    const now = frame * dtMs;
    const travel = travelAt(timeline.travels, now);
    input.now = now;
    input.dead = timeline.deadFrom !== undefined && now >= timeline.deadFrom && !(timeline.aliveFrom !== undefined && now >= timeline.aliveFrom);
    input.cue = cueAt(timeline.cues, now);
    input.moving = travel.moving; input.speed = travel.speed; input.holdMs = travel.holdMs;
    input.dt = frame === 0 ? 0 : dtMs / 1000; input.z = travel.z;
    input.weapon = '';
    for (const [at, weapon] of timeline.weapon ?? []) if (now >= at) input.weapon = weapon;
    for (const avatar of avatars) {
      avatar.root.position.z = travel.z;
      avatar.animator.update(input);
      if (matrices) avatar.root.updateMatrixWorld(true);
    }
    onFrame?.(now, frame);
  }
}

/** Sum of the effective weights of the mixer's playing actions (1 means no bind-pose fill). */
export function playingWeight(animator: AvatarAnimator): number {
  const mixer = animator.mixer as any;
  let sum = 0;
  for (let i = 0; i < mixer._nActiveActions; i++) sum += mixer._actions[i].getEffectiveWeight();
  return sum;
}
