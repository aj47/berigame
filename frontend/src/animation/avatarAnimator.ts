import { AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, Sphere, Vector3, type AnimationAction, type Bone, type Frustum, type Object3D } from 'three';
import { ARMED_VARIANT, type Clip } from './combatPresentation';
import { ClipDirector, type DirectorInput } from './clipDirector';
import { ProceduralLayer, type LayerInput } from './proceduralLayer';
import type { AvatarClipSet, Stance } from './stance';

const noEulerSync = () => {};
const CARRY_VARIANT: Partial<Record<Clip, Clip>> = { Idle: 'CarryIdle', Run: 'CarryRun', Stop: 'CarryIdle' };
/**
 * three.js rebuilds `rotation` (an Euler: a matrix plus asin/atan2) whenever a
 * `quaternion` is written, i.e. for every animated bone on every frame. Nothing
 * reads a bone's Euler: the mixer, skinning and the procedural layer all use
 * `bone.quaternion` (the only `rotation` reads are the avatar group's yaw in
 * useTileMotion and DebugBridge, and groups are not bones). Call once per
 * cloned model. From then on a bone's `rotation` is stale: read and write bone
 * rotations through `quaternion` only.
 */
export function skipBoneEulerSync(model: Object3D): void {
  model.traverse((object) => { if ((object as Bone).isBone) object.quaternion._onChange(noEulerSync); });
}

/** A stable 32-bit seed from a player identity (FNV-1a), for per-player phases and idle timing. */
export function seedFromIdentity(identity: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/**
 * The camera view animators cull against, refreshed every rendered frame by
 * <AnimationCulling />. null (tests, node): every avatar counts as on screen.
 * `skipped` counts updates spent off screen (diagnostics).
 */
export const animationView: { frustum: Frustum | null; skipped: number } = { frustum: null, skipped: 0 };
/** Bounds of a posed adventurer around its feet: generous, so a limb or a fast camera never pops. */
const CULL_CENTER_Y = 1, CULL_RADIUS = 2.5;

const aliases = new WeakMap<AnimationClip, AnimationClip>();
/**
 * A second clip over the same tracks (no copy). The mixer caches actions by
 * clip, so its action is independent: a clip can crossfade into a fresh start
 * of itself instead of resetting the action it is fading out of.
 */
function aliasOf(clip: AnimationClip): AnimationClip {
  let alias = aliases.get(clip);
  if (!alias) {
    alias = new AnimationClip(clip.name, clip.duration, clip.tracks, clip.blendMode);
    aliases.set(clip, alias);
  }
  return alias;
}

/** One frame's input, filled into a reused object by the caller (nothing is allocated per frame). */
export interface AnimatorInput extends DirectorInput {
  /** Frame time, seconds. */
  dt: number;
  /** The avatar's ground position and facing (its group), for the robe's inertia. */
  x: number;
  z: number;
  yaw: number;
  /** player.weapon: 'stick' plays StickIdle/StickRun in place of Idle/Run when the rig has them. */
  weapon?: string;
  carrying?: boolean;
}

export interface AnimatorOptions {
  /** Per-identity seed for loop phases and idle motion. */
  seed?: number;
  /** Layer procedural idle and secondary motion over the clips (default true). */
  procedural?: boolean;
  /** Where another avatar stands (identity hex), so a blow from behind plays HitBack. */
  locate?: (identity: string) => { x: number; z: number } | null;
}

/**
 * One adventurer's animation: its own mixer, the clip director and the
 * procedural layer, stepped in the only safe order once per frame.
 */
export class AvatarAnimator {
  readonly mixer: AnimationMixer;
  readonly director: ClipDirector;
  readonly layer: ProceduralLayer | null;
  private readonly model: Object3D;
  private readonly clips = new Map<string, AnimationClip>();
  private readonly mirrored: Map<string, AnimationClip>;
  private readonly feet: [Object3D | undefined, Object3D | undefined];
  /** A stick or club is wielded: Idle and Run play their armed variants. */
  private armed = false;
  private carrying = false;
  /** Posed last frame (inside the view); off screen only clip time advances. */
  private onScreen = true;
  private readonly bounds = new Sphere(new Vector3(), CULL_RADIUS);
  /** Topmost bones: their subtrees' world matrices stay frozen while off screen. */
  private readonly boneRoots: Object3D[] = [];
  private readonly layerInput: LayerInput = { dt: 0, time: 0, idle: 0, run: 0, combat: 0, swing: 0, defeat: 0, x: 0, z: 0, yaw: 0 };

  constructor(model: Object3D, set: AvatarClipSet, options: AnimatorOptions = {}) {
    this.model = model;
    for (const clip of set.clips) this.clips.set(clip.name, clip);
    this.mirrored = set.mirrored;
    this.feet = [model.getObjectByName('FootL'), model.getObjectByName('FootR')];
    this.mixer = new AnimationMixer(model);
    const seed = options.seed ?? 0;
    this.director = new ClipDirector({
      has: (clip) => this.clips.has(clip),
      duration: (clip) => this.clips.get(clip)?.duration ?? 0,
      seed,
      mirrorable: (clip) => this.mirrored.has(clip),
      leadStance: () => this.leadStance(),
      runStart: set.runStart,
      locate: options.locate,
    });
    this.layer = options.procedural === false ? null : new ProceduralLayer(model, seed);
    model.traverse((object) => { if ((object as Bone).isBone && !(object.parent as Bone | null)?.isBone) this.boneRoots.push(object); });
  }

  /** Whether the avatar (at its group's position this frame) is inside the last rendered view. */
  private inView(input: AnimatorInput): boolean {
    const frustum = animationView.frustum;
    if (!frustum) return true;
    this.bounds.center.set(input.x, this.model.matrixWorld.elements[13] + CULL_CENTER_Y, input.z);
    return frustum.intersectsSphere(this.bounds);
  }

  /** Off screen: stop recomputing bone world matrices (skinning then reuses the last pose). */
  private freezeBones(frozen: boolean): void {
    for (let i = 0; i < this.boneRoots.length; i++) this.boneRoots[i].matrixWorldAutoUpdate = !frozen;
  }

  /**
   * Off screen: advance each playing action's time as mixer.update would, without
   * sampling or applying a single track, so the pose is right when it comes back.
   */
  private advance(dt: number): void {
    this.mixer.time += dt;
    const director = this.director;
    for (let i = 0; i < director.count; i++) {
      const action = director.layers[i].handle as AnimationAction | null;
      if (!action || !action.enabled || action.paused || !action.isScheduled()) continue;
      const duration = action.getClip().duration;
      let time = action.time + dt * action.getEffectiveTimeScale();
      if (action.loop === LoopOnce) {
        if (time >= duration) { time = duration; if (action.clampWhenFinished) action.paused = true; else action.enabled = false; }
        else if (time < 0) time = 0;
      } else if (duration > 0) time = ((time % duration) + duration) % duration;
      action.time = time;
    }
  }

  /**
   * Stance 1 (mirrored) when the left foot is ahead of the right along the
   * model's facing (+Z). Reads the world matrices of the last rendered frame.
   */
  private leadStance(): Stance {
    const left = this.feet[0], right = this.feet[1];
    if (!left || !right) return 0;
    const m = this.model.matrixWorld.elements, l = left.matrixWorld.elements, r = right.matrixWorld.elements;
    // The model's +Z axis in the world is its matrix's third column.
    return (l[12] - r[12]) * m[8] + (l[13] - r[13]) * m[9] + (l[14] - r[14]) * m[10] > 0 ? 1 : 0;
  }

  private action(clip: Clip, mirror: boolean, slot: 0 | 1): AnimationAction | null {
    const variant = this.carrying ? CARRY_VARIANT[clip] : this.armed ? ARMED_VARIANT[clip] : undefined;
    const name = variant && this.clips.has(variant) ? variant : clip;
    const source = (mirror && this.mirrored.get(name)) || this.clips.get(name);
    return source ? this.mixer.clipAction(slot === 0 ? source : aliasOf(source)) : null;
  }

  /** Advance one frame. */
  update(input: AnimatorInput): void {
    // 1. Clean bones, so actions that start or stop below save and restore clip-only state.
    this.layer?.restore();
    // 2. Blend: start, weigh and stop actions.
    const director = this.director;
    director.update(input);
    // Any wielded weapon (stick or stone club) uses the armed Idle/Run.
    const armed = input.weapon === 'stick' || input.weapon === 'stone_club' || input.weapon === 'flint_knife';
    if (armed !== this.armed || !!input.carrying !== this.carrying) {
      this.armed = armed;
      this.carrying = !!input.carrying;
      // Change the arm pose for a weapon or cargo while keeping phase and weight.
      for (let i = 0; i < director.count; i++) {
        const layer = director.layers[i];
        const old = layer.handle as AnimationAction | null;
        if (!old || !ARMED_VARIANT[layer.clip]) continue;
        const next = this.action(layer.clip, layer.mirror, layer.slot);
        if (!next || next === old) continue;
        next.reset();
        next.setLoop(layer.loop ? LoopRepeat : LoopOnce, layer.loop ? Infinity : 1);
        next.clampWhenFinished = !layer.loop;
        next.time = old.time % next.getClip().duration;
        next.play();
        old.stop();
        layer.handle = next;
      }
    }
    for (let i = 0; i < director.endedCount; i++) (director.ended[i] as AnimationAction).stop();
    for (let i = 0; i < director.count; i++) {
      const layer = director.layers[i];
      let action = layer.handle as AnimationAction | null;
      if (!action) {
        action = this.action(layer.clip, layer.mirror, layer.slot);
        if (!action) continue;
        layer.handle = action;
      }
      if (layer.start >= 0) {
        action.reset();
        action.setLoop(layer.loop ? LoopRepeat : LoopOnce, layer.loop ? Infinity : 1);
        action.clampWhenFinished = !layer.loop;
        action.time = layer.start;
        action.play();
        layer.start = -1;
      }
      action.weight = layer.weight;
      action.timeScale = layer.timeScale;
    }
    // Off screen: keep clip time, skip sampling, the procedural layer and bone matrices.
    const visible = this.inView(input);
    if (visible !== this.onScreen) { this.onScreen = visible; this.freezeBones(!visible); if (visible) this.layer?.resetGround(); }
    if (!visible) { this.advance(input.dt); animationView.skipped++; return; }
    // 3. Clips.
    this.mixer.update(input.dt);
    // 4. Procedural motion on top.
    if (this.layer) {
      const l = this.layerInput;
      l.dt = input.dt; l.time = input.now / 1000;
      l.idle = director.idleWeight; l.run = director.runWeight; l.combat = director.combatWeight;
      l.swing = director.swingWeight; l.defeat = director.defeatWeight;
      l.x = input.x; l.z = input.z; l.yaw = input.yaw;
      this.layer.apply(l);
    }
  }

  /**
   * Stop and release every action (the clips themselves are shared per GLB and
   * stay). Stepping the animator again afterwards starts over from a clean pose.
   */
  dispose(): void {
    if (!this.onScreen) { this.onScreen = true; this.freezeBones(false); }
    this.layer?.restore();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.director.reset();
  }
}
