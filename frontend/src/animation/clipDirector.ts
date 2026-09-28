import type { AnimationCue, Clip } from './combatPresentation';
import { STICK_SWING_CLIP } from './stickSwing';
import { holdCadence, runScale } from './locomotion';
import type { Stance } from './stance';

/**
 * Which clips an adventurer shows and how they blend, as pure data: no
 * three.js, so node tests and the offline harness drive the same logic the
 * game runs. avatarAnimator.ts applies the result to an AnimationMixer.
 *
 * One crossfade runs at a time: the incoming clip's weight rises linearly to
 * 1 while every other layer falls in proportion from wherever it was, so the
 * weights always sum to exactly 1. The mixer therefore never fills a missing
 * share with the bind pose (the old arms-out flash when a clip restarted), and
 * pruned rest-pose tracks stay equivalent (see pruneClips.ts).
 *
 * update() allocates nothing on a steady frame; transitions allocate at most
 * the debug cue key string.
 */

export interface DirectorInput {
  /** performance.now() clock, ms. Cue times use the same clock. */
  now: number;
  dead: boolean;
  /** This avatar's current combat cue (combatFxStore), or null. */
  cue: AnimationCue | null;
  /** Travelling, or holding the gait at the destination through the arrival grace. */
  moving: boolean;
  /** Ground speed, world units per second. */
  speed: number;
  /** How long the body has waited at its destination with the gait held; 0 while travelling. */
  holdMs: number;
}

export interface BlendLayer {
  clip: Clip;
  /** Play the clip with its lower body mirrored (left foot forward; stance.ts). */
  mirror: boolean;
  /** 0 is the clip's own action; 1 an alias of it, so a clip can crossfade into a fresh copy of itself. */
  slot: 0 | 1;
  weight: number;
  /** Weight when the current crossfade began. */
  from: number;
  timeScale: number;
  loop: boolean;
  /** Clip time (seconds) to restart the action at on this frame; -1 once started. */
  start: number;
  /** The applier's action for this layer (opaque here). */
  handle: unknown;
}

/** Crossfade durations in seconds, by transition: snappy into combat, slower back to rest. */
export const FADE = {
  /** Run -> Idle (a run too short to need Stop). */
  locomotion: 0.18,
  /**
   * Idle or Stop -> Run. As quick as the body's start ease (locomotion.ts
   * START_EASE_MS): a longer blend keeps the standing feet half-weighted while
   * the body moves off, dragging them (0.18s drags ~1 unit over the first
   * 150ms; 0.09s leaves only the Run cycle's own slip).
   */
  start: 0.09,
  /** Back into Run after an attack or a hit. */
  resume: 0.15,
  /** Run -> Stop on a real stop. */
  stop: 0.1,
  /** Into Strike or StickSwing. */
  attack: 0.07,
  /** Into the Hit reaction. */
  hit: 0.04,
  /** Into Defeat. */
  defeat: 0.12,
  /** Back to Idle after an attack, a hit, a stop or a respawn. */
  settle: 0.2,
} as const;

/** A killing blow shows its Hit for this long after impact before the avatar falls. */
export const HIT_BEFORE_DEFEAT_MS = 150;
/** ...but a dead avatar is never shown standing for longer than this after the death arrives. */
export const DEFEAT_DELAY_CAP_MS = 500;
/**
 * Defeat entered from a playing Hit starts this far in, where the fall is
 * under way, so it continues the recoil instead of first standing back up.
 */
export const DEFEAT_AFTER_HIT_S = 0.25;

const COMBAT: ReadonlySet<Clip> = new Set<Clip>(['Strike', STICK_SWING_CLIP, 'Hit', 'Defeat']);

export function fadeSeconds(from: Clip, to: Clip): number {
  switch (to) {
    case 'Hit': return FADE.hit;
    case 'Strike': case STICK_SWING_CLIP: return FADE.attack;
    case 'Defeat': return FADE.defeat;
    case 'Stop': return FADE.stop;
    case 'Run': return from === 'Idle' || from === 'Stop' ? FADE.start : FADE.resume;
    case 'Idle': return from === 'Run' ? FADE.locomotion : FADE.settle;
  }
  return FADE.settle;
}

export interface DirectorOptions {
  /** Whether the rig has this clip. */
  has: (clip: Clip) => boolean;
  /** Clip length in seconds. */
  duration: (clip: Clip) => number;
  /** Per-identity seed: looping clips start at different phases so crowds don't move in unison. */
  seed?: number;
  /** Clips that also come with the lower body mirrored. */
  mirrorable?: (clip: Clip) => boolean;
  /** Which stance's lead foot matches the pose right now; asked when a run ends. */
  leadStance?: () => Stance;
  /** Run start phase (fraction of the cycle) that plants each stance's lead foot. */
  runStart?: readonly [number, number];
}

const MAX_LAYERS = 6;

export class ClipDirector {
  /** The layers with weight this frame: `layers[0 .. count)`. */
  readonly layers: BlendLayer[] = [];
  count = 0;
  /** Handles of layers that left the blend on this frame: `ended[0 .. endedCount)`. Their actions stop. */
  readonly ended: unknown[] = [];
  endedCount = 0;
  /** The clip being shown (faded in or fading in), after fallbacks. */
  clip: Clip = 'Idle';
  /** `${seq}:${role}` of the cue being shown, or null. */
  cueKey: string | null = null;
  /** Bumped whenever `clip` or `cueKey` changes. */
  revision = 0;
  /** Summed weights this frame, for the procedural layer. */
  idleWeight = 0;
  runWeight = 0;
  combatWeight = 0;
  swingWeight = 0;
  defeatWeight = 0;

  private readonly options: DirectorOptions;
  private readonly idlePhase: number;
  private readonly runPhase: number;
  private readonly pool: BlendLayer[] = [];
  private incoming: BlendLayer | null = null;
  private fadeStart = 0;
  private fadeMs = 0;
  /** Identity of the current target: its clip plus the cue it came from. */
  private targetClip: Clip | '' = '';
  private targetSeq = -1;
  private targetRole = '';
  private deadSince = -1;
  /** While Stop plays: when it hands over to Idle. */
  private stopUntil = 0;
  /** Which foot the standing clips put forward: 0 as authored (right), 1 mirrored (left). */
  stance: Stance = 0;

  constructor(options: DirectorOptions) {
    this.options = options;
    const seed = (options.seed ?? 0) >>> 0;
    // Where Idle starts, as a fraction of its cycle (a hash of the seed).
    this.idlePhase = ((Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 8) & 0xffffff) / 16777216;
    // Which foot leads when a run starts from rest.
    this.runPhase = seed & 1 ? 0.5 : 0;
    for (let i = 0; i < MAX_LAYERS; i++) this.pool.push({ clip: 'Idle', mirror: false, slot: 0, weight: 0, from: 0, timeScale: 1, loop: true, start: -1, handle: null });
  }

  /** A clip the rig can play: the synthesized swing falls back to the baked jab, anything else missing to Idle. */
  private resolve(clip: Clip): Clip {
    const { has } = this.options;
    if (has(clip)) return clip;
    if (clip === STICK_SWING_CLIP && has('Strike')) return 'Strike';
    return 'Idle';
  }

  update(input: DirectorInput): void {
    const { now } = input;
    this.endedCount = 0;

    // ---- what should play --------------------------------------------------
    let clip: Clip = 'Idle', seq = -1, role = '', start = 0;
    const cue = input.cue;
    if (!input.dead) this.deadSince = -1;
    else if (this.deadSince < 0) this.deadSince = now;
    // A killing blow: the row says dead as soon as it arrives, before the
    // attacker's swing lands. Let the pending Hit play first (capped).
    const hitFirst = input.dead && cue !== null && cue.role === 'reaction'
      && now < cue.at + HIT_BEFORE_DEFEAT_MS && now < this.deadSince + DEFEAT_DELAY_CAP_MS;
    if (input.dead && !hitFirst) {
      clip = 'Defeat';
    } else if (cue !== null && now >= cue.at && now < cue.at + cue.durationMs) {
      clip = cue.clip; seq = cue.seq; role = cue.role; start = (now - cue.at) / 1000;
    } else if (input.moving) {
      clip = 'Run';
    } else if (this.targetClip === 'Run' && this.weightOf('Run') >= 0.5 && this.options.has('Stop')) {
      clip = 'Stop';
    } else if (this.targetClip === 'Stop' && now < this.stopUntil) {
      clip = 'Stop';
    }
    clip = this.resolve(clip);

    if (clip !== this.targetClip || seq !== this.targetSeq || role !== this.targetRole) {
      const previous = this.targetClip === '' ? null : this.targetClip;
      if (clip === 'Defeat' && previous === 'Hit') start = DEFEAT_AFTER_HIT_S;
      if (clip === 'Stop') this.stopUntil = now + Math.max(0, this.options.duration('Stop') - FADE.settle) * 1000;
      // Leaving a stride: stand on whichever foot is already forward.
      if (previous === 'Run' && clip !== 'Run') this.stance = this.options.leadStance?.() ?? 0;
      const mirror = clip !== 'Run' && this.stance === 1 && (this.options.mirrorable?.(clip) ?? false);
      this.transition(now, clip, mirror, previous, start);
      this.targetClip = clip; this.targetSeq = seq; this.targetRole = role;
      const cueKey = seq >= 0 ? `${seq}:${role}` : null;
      if (clip !== this.clip || cueKey !== this.cueKey) { this.clip = clip; this.cueKey = cueKey; this.revision++; }
    }

    // ---- weights ------------------------------------------------------------
    const s = this.fadeMs > 0 ? Math.min(1, Math.max(0, (now - this.fadeStart) / this.fadeMs)) : 1;
    const incoming = this.incoming;
    let kept = 0;
    for (let i = 0; i < this.count; i++) {
      const layer = this.layers[i];
      if (layer === incoming) layer.weight = layer.from + (1 - layer.from) * s;
      else layer.weight = layer.from * (1 - s);
      if (layer !== incoming && s >= 1) this.end(layer);
      else this.layers[kept++] = layer;
    }
    this.count = kept;

    // ---- cadence and summed weights ----------------------------------------
    const running = this.targetClip === 'Run', falling = this.targetClip === 'Defeat';
    const cadence = running ? runScale(input.speed) * holdCadence(input.holdMs) : 0;
    this.idleWeight = this.runWeight = this.combatWeight = this.swingWeight = this.defeatWeight = 0;
    for (let i = 0; i < this.count; i++) {
      const layer = this.layers[i];
      // A fading-out Run keeps its last cadence.
      if (layer.clip === 'Run' && running) layer.timeScale = cadence;
      // The killing blow's recoil holds while the fall takes over, instead of recovering towards upright.
      else if (layer.clip === 'Hit' && falling) layer.timeScale = 0;
      if (layer.clip === 'Idle') this.idleWeight += layer.weight;
      else if (layer.clip === 'Run') this.runWeight += layer.weight;
      if (COMBAT.has(layer.clip)) this.combatWeight += layer.weight;
      if (layer.clip === STICK_SWING_CLIP) this.swingWeight += layer.weight;
      else if (layer.clip === 'Defeat') this.defeatWeight += layer.weight;
    }
  }

  /** Forget every layer (their actions are already released); the next update starts at full weight. */
  reset(): void {
    for (let i = 0; i < this.count; i++) { this.layers[i].handle = null; this.layers[i].weight = 0; }
    this.count = 0;
    this.endedCount = 0;
    this.incoming = null;
    this.targetClip = '';
    this.targetSeq = -1;
    this.targetRole = '';
    this.fadeMs = 0;
  }

  /** Summed weight of a clip's layers. */
  weightOf(clip: Clip): number {
    let weight = 0;
    for (let i = 0; i < this.count; i++) if (this.layers[i].clip === clip) weight += this.layers[i].weight;
    return weight;
  }

  private transition(now: number, clip: Clip, mirror: boolean, previous: Clip | null, cueStart: number): void {
    const looping = clip === 'Idle' || clip === 'Run';
    for (let i = 0; i < this.count; i++) this.layers[i].from = this.layers[i].weight;

    // A looping clip that still has weight picks up where it is (Run keeps its
    // stride when travel resumes during its fade-out). Anything else restarts,
    // on a slot of that clip with no weight, so an attack that repeats
    // crossfades from the old swing into a fresh one.
    let target: BlendLayer | null = null;
    if (looping) for (let i = 0; i < this.count; i++) {
      const layer = this.layers[i];
      if (layer.clip === clip && layer.mirror === mirror && (!target || layer.weight > target.weight)) target = layer;
    }
    if (!target) {
      let used0: BlendLayer | null = null, used1: BlendLayer | null = null;
      for (let i = 0; i < this.count; i++) {
        const layer = this.layers[i];
        if (layer.clip === clip && layer.mirror === mirror) { if (layer.slot === 0) used0 = layer; else used1 = layer; }
      }
      let slot: 0 | 1 = 0;
      if (used0 && !used1) slot = 1;
      else if (used0 && used1) {
        // Both copies are blending (two restarts within one fade): recycle the fainter one.
        const faint = used1.weight < used0.weight ? used1 : used0;
        slot = faint.slot;
        this.removeLive(faint);
      }
      const duration = this.options.duration(clip);
      const start = clip === 'Idle' ? this.idlePhase * duration
        : clip === 'Run' ? (this.options.runStart?.[this.stance] ?? this.runPhase) * duration
        : Math.min(Math.max(0, cueStart), duration);
      target = this.add(clip, mirror, slot, looping, start);
    }
    this.incoming = target;
    this.fadeStart = now;
    let others = 0;
    for (let i = 0; i < this.count; i++) if (this.layers[i] !== target) others += this.layers[i].from;
    if (previous === null || others + target.from <= 1e-6) {
      // Nothing has played yet (spawn, a new hair model): start at full weight.
      for (let i = 0; i < this.count; i++) this.layers[i].from = this.layers[i] === target ? 1 : 0;
      this.fadeMs = 0;
      return;
    }
    // Every other layer fades out in proportion. If a dropped or restarted
    // layer took some weight with it, the others make it up so the sum stays 1.
    if (others > 1e-9 && Math.abs(others + target.from - 1) > 1e-9) {
      const scale = (1 - target.from) / others;
      for (let i = 0; i < this.count; i++) if (this.layers[i] !== target) this.layers[i].from *= scale;
    }
    this.fadeMs = fadeSeconds(previous, clip) * 1000;
  }

  private add(clip: Clip, mirror: boolean, slot: 0 | 1, loop: boolean, start: number): BlendLayer {
    let layer: BlendLayer | null = null;
    for (let p = 0; p < this.pool.length && !layer; p++) {
      const candidate = this.pool[p];
      let busy = false;
      for (let i = 0; i < this.count && !busy; i++) busy = this.layers[i] === candidate;
      if (!busy) layer = candidate;
    }
    if (!layer) {
      // Every pooled layer is blending (several transitions within one fade): drop the faintest.
      let faint = this.layers[0];
      for (let i = 1; i < this.count; i++) if (this.layers[i].weight < faint.weight) faint = this.layers[i];
      this.removeLive(faint);
      layer = faint;
    }
    layer.clip = clip; layer.mirror = mirror; layer.slot = slot; layer.weight = 0; layer.from = 0;
    layer.timeScale = 1; layer.loop = loop; layer.start = start; layer.handle = null;
    this.layers[this.count++] = layer;
    return layer;
  }

  /** Hand a layer's action to the applier to stop, and free the layer. */
  private end(layer: BlendLayer): void {
    if (layer.handle !== null) this.ended[this.endedCount++] = layer.handle;
    layer.handle = null;
    layer.weight = 0;
  }

  /** Take a live layer out of the blend now. */
  private removeLive(layer: BlendLayer): void {
    let index = -1;
    for (let i = 0; i < this.count; i++) if (this.layers[i] === layer) index = i;
    if (index < 0) return;
    for (let i = index; i < this.count - 1; i++) this.layers[i] = this.layers[i + 1];
    this.count--;
    this.end(layer);
  }
}
