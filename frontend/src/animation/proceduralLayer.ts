import { Quaternion, Vector3, type Object3D } from 'three';

/**
 * Small procedural motion on top of the clips, so an adventurer never stands
 * frozen: breathing, a slow weight shift, an occasional glance around, the
 * head steadied against the chest's turn and sway, and robe flaps with inertia.
 *
 * Absolute writes, never accumulation: after pruning (pruneClips.ts) the mixer
 * does not bind Neck, Head, or (in most clips) Chest, and even a bound bone is
 * only rewritten when its clip value changes. Multiplying an offset into the
 * bone in place would therefore compound every frame. Instead the layer keeps
 * each driven bone's clean value (what the clips alone produce):
 *   restore()  before the mixer runs puts the clean values back, so the mixer
 *              saves and blends against clean state;
 *   apply()    after the mixer re-reads the clean values and writes
 *              clean * offset.
 * Cost: a few quaternion products per avatar per frame, no allocation.
 */

export interface LayerInput {
  /** Frame time and a steady clock, seconds. */
  dt: number;
  time: number;
  /** Summed clip weights (ClipDirector). */
  idle: number;
  run: number;
  combat: number;
  swing: number;
  defeat: number;
  /** The avatar's ground position and facing, for the robe's inertia. */
  x: number;
  z: number;
  yaw: number;
}

const DEG = Math.PI / 180;
/** Chest pitch amplitude and period of a breath. */
export const BREATH_DEG = 1.5;
export const BREATH_PERIOD_S = 3.5;
/** Sideways hip sway while idle, and its period. The feet stay planted. */
export const SWAY_M = 0.015;
export const SWAY_PERIOD_S = 5;
/** Largest glance to either side while idle. */
export const LOOK_DEG = 15;
/** Share of the chest's turn (yaw) and sway (roll) the neck takes back out, steadying the head. */
export const STABILIZE = 0.5;
/** Robe flap spring: natural frequency, damping ratio, and response to ground acceleration and speed. */
const ROBE_HZ = 1.8, ROBE_DAMPING = 0.35, ROBE_ACCEL = 0.7, ROBE_DRAG = 0.03, ROBE_LIMIT = 0.35;
/** A ground move bigger than this in one frame is a teleport (respawn, correction), not motion. */
const TELEPORT = 1.5;

const chain = new Quaternion();

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

// Each driven bone is written once per frame as its clean rotation times a
// small turn, expanded inline (no temporary quaternions, no boxed numbers).
/** out = base * R(x, angle): a turn about the bone's own X axis. */
function turnX(out: Quaternion, base: Quaternion, angle: number): void {
  const s = Math.sin(angle / 2), c = Math.cos(angle / 2);
  out.set(base.x * c + base.w * s, base.y * c + base.z * s, base.z * c - base.y * s, base.w * c - base.x * s);
}
/** out = R(x, angle) * base: a turn about the parent's X axis. */
function parentTurnX(out: Quaternion, base: Quaternion, angle: number): void {
  const s = Math.sin(angle / 2), c = Math.cos(angle / 2);
  out.set(c * base.x + s * base.w, c * base.y - s * base.z, c * base.z + s * base.y, c * base.w - s * base.x);
}
/** out = R(z, angle) * base: a turn about the parent's Z axis. */
function parentTurnZ(out: Quaternion, base: Quaternion, angle: number): void {
  const s = Math.sin(angle / 2), c = Math.cos(angle / 2);
  out.set(c * base.x - s * base.y, c * base.y + s * base.x, c * base.z + s * base.w, c * base.w - s * base.z);
}
/** out = base * R(y, yaw) * R(z, roll): a turn and a tilt about the bone's own axes. */
function turnYZ(out: Quaternion, base: Quaternion, yaw: number, roll: number): void {
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sz = Math.sin(roll / 2), cz = Math.cos(roll / 2);
  // R(y) * R(z)
  const rx = sy * sz, ry = sy * cz, rz = cy * sz, rw = cy * cz;
  const x = base.x, y = base.y, z = base.z, w = base.w;
  out.set(w * rx + x * rw + y * rz - z * ry, w * ry - x * rz + y * rw + z * rx, w * rz + x * ry - y * rx + z * rw, w * rw - x * rx - y * ry - z * rz);
}

/** A bone the layer writes, and its clean rotation (from the clips alone). */
interface Driven { bone: Object3D; base: Quaternion }

/** Deterministic per-identity randomness (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ProceduralLayer {
  private readonly driven: Driven[] = [];
  private readonly chest: Driven | null;
  private readonly neck: Driven | null;
  private readonly head: Driven | null;
  private readonly thighL: Driven | null;
  private readonly thighR: Driven | null;
  private readonly robes: Driven[] = [];
  private readonly spine: Object3D | null;
  private readonly hips: Object3D | null;
  private readonly hipsBase = new Vector3();
  private readonly legLength: number;

  private readonly rand: () => number;
  private readonly breathPeriod: number;
  private readonly breathPhase: number;
  private readonly swayPeriod: number;
  private readonly swayPhase: number;

  private headGain = 1;
  private lookTarget = 0;
  private look = 0;
  private nextLookAt = -1;
  private readonly robeAngle: number[] = [];
  private readonly robeSpeed: number[] = [];
  private readonly robeFrequency: number[] = [];
  private hasGround = false;
  private groundX = 0;
  private groundZ = 0;
  private forward = 0;
  /**
   * This frame's step and gains, shared by the terms below through fields
   * rather than arguments: V8 boxes a double passed to a call it does not
   * inline, and the layer runs for every avatar every frame.
   */
  private h = 0;
  private time = 0;
  private idle = 0;
  private combat = 0;
  private dead = 0;

  constructor(model: Object3D, seed: number) {
    const drive = (name: string): Driven | null => {
      const bone = model.getObjectByName(name);
      if (!bone) return null;
      const driven = { bone, base: bone.quaternion.clone() };
      this.driven.push(driven);
      return driven;
    };
    this.chest = drive('Chest');
    this.neck = drive('Neck');
    this.head = drive('Head');
    this.hips = model.getObjectByName('Hips') ?? null;
    this.spine = model.getObjectByName('Spine') ?? null;
    if (this.hips) this.hipsBase.copy(this.hips.position);
    const shin = model.getObjectByName('ShinL'), foot = model.getObjectByName('FootL');
    this.legLength = shin && foot ? shin.position.length() + foot.position.length() : 0;
    // Only sway the hips when both legs can be turned back to keep the feet planted.
    this.thighL = this.legLength > 0 ? drive('ThighL') : null;
    this.thighR = this.legLength > 0 ? drive('ThighR') : null;
    for (const name of ['RobeL', 'RobeR']) {
      const robe = drive(name);
      if (robe) this.robes.push(robe);
    }
    this.rand = random(seed ^ 0x9e3779b9);
    this.breathPeriod = BREATH_PERIOD_S * (0.9 + 0.2 * this.rand());
    this.breathPhase = 2 * Math.PI * this.rand();
    this.swayPeriod = SWAY_PERIOD_S * (0.85 + 0.3 * this.rand());
    this.swayPhase = 2 * Math.PI * this.rand();
    for (let i = 0; i < this.robes.length; i++) {
      this.robeAngle.push(0); this.robeSpeed.push(0);
      // The two flaps ring at slightly different rates so they don't move as one.
      this.robeFrequency.push(2 * Math.PI * ROBE_HZ * (i % 2 ? 1.08 : 0.93));
    }
  }

  /** Put the clean (clip-only) values back on the driven bones. Call before the mixer updates. */
  restore(): void {
    for (let i = 0; i < this.driven.length; i++) this.driven[i].bone.quaternion.copy(this.driven[i].base);
    if (this.hips) this.hips.position.copy(this.hipsBase);
  }

  /** Layer the procedural motion over what the mixer just wrote. */
  apply(input: LayerInput): void {
    for (let i = 0; i < this.driven.length; i++) this.driven[i].base.copy(this.driven[i].bone.quaternion);
    if (this.hips) this.hipsBase.copy(this.hips.position);
    this.h = input.dt > 0 ? Math.min(input.dt, 0.1) : 0;
    this.time = input.time;
    this.combat = clamp01(input.combat);
    this.dead = clamp01(input.defeat);
    // Idle-only motion (sway, glances) fades with the Idle clip and stops in a fight.
    this.idle = clamp01(input.idle) * (1 - this.combat);
    // The head terms stay off while a stick swing (or a fall) has any weight.
    this.headGain += ((input.swing > 0 || this.dead > 0 ? 0 : 1) - this.headGain) * (1 - Math.exp(-25 * this.h));
    this.breathe();
    this.shiftWeight();
    this.steadyHead();
    this.flapRobes(input);
  }

  /** Breathing never stops, but is shallow in a fight and gone once defeated. */
  private breathe(): void {
    if (!this.chest) return;
    const breath = BREATH_DEG * DEG * (1 - this.dead) * (1 - 0.7 * this.combat) * Math.sin((2 * Math.PI * this.time) / this.breathPeriod + this.breathPhase);
    turnX(this.chest.bone.quaternion, this.chest.base, -breath);
  }

  /** A slow sideways sway of the hips while idle, the legs turned back under them so the feet stay put. */
  private shiftWeight(): void {
    if (!this.hips || !this.thighL || !this.thighR) return;
    const sway = SWAY_M * this.idle * Math.sin((2 * Math.PI * this.time) / this.swayPeriod + this.swayPhase);
    this.hips.position.x = this.hipsBase.x + sway;
    // About the hips' forward axis.
    const legs = -Math.asin(Math.max(-1, Math.min(1, sway / this.legLength)));
    parentTurnZ(this.thighL.bone.quaternion, this.thighL.base, legs);
    parentTurnZ(this.thighR.bone.quaternion, this.thighR.base, legs);
  }

  /** Occasional glances while idle, and the head held steadier than the chest's turn and sway. */
  private steadyHead(): void {
    if (!this.neck && !this.head) return;
    const time = this.time;
    if (this.nextLookAt < 0 || this.nextLookAt - time > 60) this.nextLookAt = time + 1.5 + 3.5 * this.rand();
    if (time >= this.nextLookAt) {
      if (this.lookTarget !== 0) {
        this.lookTarget = 0;
        this.nextLookAt = time + 2.5 + 3.5 * this.rand();
      } else {
        this.lookTarget = (this.rand() < 0.5 ? -1 : 1) * (0.4 + 0.6 * this.rand()) * LOOK_DEG * DEG;
        this.nextLookAt = time + 0.8 + 1.4 * this.rand();
      }
    }
    this.look += (this.lookTarget * this.idle * this.headGain - this.look) * (1 - Math.exp(-4 * this.h));
    // The chest's turn (yaw) and sway (roll) relative to the hips' parent, from
    // the clean local rotations (YXZ Euler angles of the chain). Pitch is left
    // alone: a hit's recoil and a fall carry the head with them.
    let turn = 0, sway = 0;
    if (this.chest) {
      chain.copy(this.chest.base);
      if (this.spine) chain.premultiply(this.spine.quaternion);
      if (this.hips) chain.premultiply(this.hips.quaternion);
      const x = chain.x, y = chain.y, z = chain.z, w = chain.w;
      turn = Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y));
      sway = Math.atan2(2 * (x * y + z * w), 1 - 2 * (x * x + z * z));
    }
    const steady = -STABILIZE * this.headGain;
    if (this.neck) turnYZ(this.neck.bone.quaternion, this.neck.base, steady * turn + 0.4 * this.look, steady * sway);
    if (this.head) turnYZ(this.head.bone.quaternion, this.head.base, (this.neck ? 0.6 : 1) * this.look, 0);
  }

  /** Robe flaps on damped springs: a change of ground speed kicks them back (setting off) or forward (stopping). */
  private flapRobes(input: LayerInput): void {
    if (!this.robes.length) return;
    const h = this.h;
    let accel = 0;
    if (h > 0) {
      const dx = input.x - this.groundX, dz = input.z - this.groundZ;
      if (!this.hasGround || dx * dx + dz * dz > TELEPORT * TELEPORT) {
        this.hasGround = true;
        this.forward = 0;
        for (let i = 0; i < this.robes.length; i++) this.robeAngle[i] = this.robeSpeed[i] = 0;
      } else {
        // Ground speed along the facing.
        const forward = (dx * Math.sin(input.yaw) + dz * Math.cos(input.yaw)) / h;
        accel = (forward - this.forward) / h;
        this.forward = forward;
      }
      this.groundX = input.x; this.groundZ = input.z;
    }
    for (let i = 0; i < this.robes.length; i++) {
      const w = this.robeFrequency[i];
      let angle = this.robeAngle[i], speed = this.robeSpeed[i];
      speed += (-w * w * (angle - ROBE_DRAG * this.forward) - 2 * ROBE_DAMPING * w * speed + ROBE_ACCEL * accel) * h;
      angle += speed * h;
      if (angle > ROBE_LIMIT) { angle = ROBE_LIMIT; speed = 0; } else if (angle < -ROBE_LIMIT) { angle = -ROBE_LIMIT; speed = 0; }
      this.robeAngle[i] = angle; this.robeSpeed[i] = speed;
      // About the hips' left-right axis: positive swings the flap backwards.
      parentTurnX(this.robes[i].bone.quaternion, this.robes[i].base, angle);
    }
  }
}
