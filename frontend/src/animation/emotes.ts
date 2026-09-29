import {
  AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack,
  type Interpolant, type KeyframeTrack, type Object3D,
} from 'three';
import { EMOTES, type EmoteId } from '@sim';

/**
 * Emote clips (wave, cheer, sit, point). The adventurer GLB bakes none, so
 * they are synthesized once per rig like StickSwing: the body comes from the
 * baked Idle, the hips shift, and the arms (and for Sit the legs) are
 * re-solved every sample with the same analytic two-bone IK as the swing.
 *
 * Model space: +Y up, +Z is where the adventurer faces, -X is its right.
 */
export const EMOTE_CLIPS = ['Wave', 'Cheer', 'Sit', 'Point'] as const;
export type EmoteClip = (typeof EMOTE_CLIPS)[number];

type V3 = readonly [number, number, number];
export interface EmoteKey {
  t: number;
  /** Hips offset from Idle, model space. */
  hips?: V3;
  /** Forward lean of the spine, radians. */
  lean?: number;
  handR?: V3; poleR?: V3;
  handL?: V3; poleL?: V3;
  footR?: V3; kneeR?: V3;
  footL?: V3; kneeL?: V3;
}

// Idle's rest hands and elbows: every standing emote starts and ends here.
const R_HAND: V3 = [-0.37, 1.18, 0.16], R_POLE: V3 = [-0.7, 1.12, -0.05];
const L_HAND: V3 = [0.37, 1.18, 0.16], L_POLE: V3 = [0.7, 1.12, -0.05];
const REST = { handR: R_HAND, poleR: R_POLE, handL: L_HAND, poleL: L_POLE, hips: [0, 0, 0] as V3, lean: 0 };

const waveKeys = (): EmoteKey[] => {
  const keys: EmoteKey[] = [{ t: 0, ...REST }];
  const up = (x: number): Partial<EmoteKey> => ({ handR: [x, 1.88, 0.12], poleR: [-0.85, 1.35, -0.15] });
  keys.push({ t: 0.28, ...REST, ...up(-0.42) });
  let t = 0.28;
  for (let i = 0; i < 6; i++) { t += 0.22; keys.push({ t, ...REST, ...up(i % 2 === 0 ? -0.66 : -0.4) }); }
  keys.push({ t: t + 0.3, ...REST });
  return keys;
};

const cheerKeys = (): EmoteKey[] => {
  const up = (h: number, y: number): EmoteKey => ({
    t: 0, lean: -0.06, hips: [0, y, 0],
    handR: [-0.32, 1.9 + h, 0.08], poleR: [-0.8, 1.55, -0.1],
    handL: [0.32, 1.9 + h, 0.08], poleL: [0.8, 1.55, -0.1],
  });
  const keys: EmoteKey[] = [{ t: 0, ...REST }];
  const times = [0.22, 0.42, 0.62, 0.82, 1.02, 1.22];
  times.forEach((t, i) => keys.push({ ...up(i % 2 ? 0 : 0.06, i % 2 ? 0 : 0.07), t }));
  keys.push({ t: 1.55, ...REST });
  return keys;
};

const pointKeys = (): EmoteKey[] => [
  { t: 0, ...REST },
  { t: 0.25, ...REST, handR: [-0.2, 1.46, 0.62], poleR: [-0.7, 1.3, 0.05], lean: 0.04 },
  { t: 1.1, ...REST, handR: [-0.2, 1.48, 0.63], poleR: [-0.7, 1.3, 0.05], lean: 0.04 },
  { t: 1.4, ...REST },
];

/** Sits down cross-legged-ish (knees up, hands on the knees) and holds the last frame. */
const SIT_REST_LEGS = {
  footR: [-0.23, 0.17, 0.09] as V3, kneeR: [-0.2, 0.55, 0.9] as V3,
  footL: [0.23, 0.17, -0.09] as V3, kneeL: [0.2, 0.55, 0.9] as V3,
};
const sitKeys = (): EmoteKey[] => [
  { t: 0, ...REST, ...SIT_REST_LEGS },
  { t: 0.3, ...REST, hips: [0, -0.3, -0.05], lean: 0.12, footR: [-0.24, 0.15, 0.3], kneeR: [-0.25, 0.9, 1.0], footL: [0.24, 0.15, 0.3], kneeL: [0.25, 0.9, 1.0] },
  {
    t: 0.7, hips: [0, -0.55, -0.12], lean: 0.18,
    handR: [-0.28, 0.66, 0.34], poleR: [-0.7, 0.9, -0.3], handL: [0.28, 0.66, 0.34], poleL: [0.7, 0.9, -0.3],
    footR: [-0.2, 0.1, 0.46], kneeR: [-0.3, 1.0, 1.0], footL: [0.2, 0.1, 0.46], kneeL: [0.3, 1.0, 1.0],
  },
];

export const EMOTE_KEYS: Record<EmoteClip, EmoteKey[]> = {
  Wave: waveKeys(), Cheer: cheerKeys(), Sit: sitKeys(), Point: pointKeys(),
};

/** Emote id (shared/sim EMOTES) -> the clip that plays it and how long the cue lasts. Sit holds until you move. */
export function emoteCue(emote: number): { clip: EmoteClip; durationMs: number } | null {
  const def = EMOTES[emote as EmoteId];
  if (!def) return null;
  return { clip: def.clip as EmoteClip, durationMs: def.durationMs };
}

// ---- synthesis ---------------------------------------------------------------
type Field = Exclude<keyof EmoteKey, 't'>;
const ease = (u: number) => u * u * (3 - 2 * u);
/** Eased piecewise interpolation between keys that define `field`. Undefined when no key does. */
function sample(keys: readonly EmoteKey[], field: Field, t: number, out: number[]): boolean {
  const defined = keys.filter((k) => k[field] !== undefined);
  if (defined.length === 0) return false;
  const value = (k: EmoteKey) => { const v = k[field]!; return typeof v === 'number' ? [v] : [...v]; };
  if (t <= defined[0].t) { out.splice(0, out.length, ...value(defined[0])); return true; }
  const last = defined[defined.length - 1];
  if (t >= last.t) { out.splice(0, out.length, ...value(last)); return true; }
  let k = 0;
  while (defined[k + 1].t <= t) k++;
  const a = value(defined[k]), b = value(defined[k + 1]);
  const u = ease((t - defined[k].t) / (defined[k + 1].t - defined[k].t));
  out.splice(0, out.length, ...a.map((v, i) => v + (b[i] - v) * u));
  return true;
}

const Y = new Vector3(0, 1, 0), X = new Vector3(1, 0, 0);
interface Limb { upper: Object3D; lower: Object3D; end: Object3D; upperRest: Quaternion; lowerRest: Quaternion; endRest: Quaternion; a: number; b: number; keepEnd: boolean }

/** Build one emote clip for a loaded rig (`root` is cloned, never posed). Null for a rig without the adventurer's limbs. */
export function buildEmoteClip(root: Object3D, idle: AnimationClip, name: EmoteClip, keys: readonly EmoteKey[] = EMOTE_KEYS[name]): AnimationClip | null {
  const rig = root.clone(true);
  rig.position.set(0, 0, 0); rig.quaternion.identity(); rig.scale.set(1, 1, 1);
  const nodes = new Map<string, Object3D>();
  rig.traverse((o) => { if (!nodes.has(o.name)) nodes.set(o.name, o); });
  const hips = nodes.get('Hips'), spine = nodes.get('Spine');
  if (!hips || !spine) return null;
  rig.updateMatrixWorld(true);
  const limb = (u: string, l: string, e: string, keepEnd: boolean): Limb | null => {
    const upper = nodes.get(u), lower = nodes.get(l), end = nodes.get(e);
    if (!upper?.parent || !lower || !end) return null;
    return {
      upper, lower, end, keepEnd,
      upperRest: upper.getWorldQuaternion(new Quaternion()), lowerRest: lower.getWorldQuaternion(new Quaternion()), endRest: end.getWorldQuaternion(new Quaternion()),
      a: lower.position.length(), b: end.position.length(),
    };
  };
  const limbs: Partial<Record<'R' | 'L' | 'FR' | 'FL', Limb | null>> = {
    R: limb('UpperArmR', 'ForearmR', 'HandR', false), L: limb('UpperArmL', 'ForearmL', 'HandL', false),
    FR: limb('ThighR', 'ShinR', 'FootR', true), FL: limb('ThighL', 'ShinL', 'FootL', true),
  };
  if (!limbs.R || !limbs.L) return null;

  const samplers = idle.tracks.flatMap((track) => {
    const dot = track.name.lastIndexOf('.');
    const node = nodes.get(track.name.slice(0, dot)), property = track.name.slice(dot + 1);
    if (!node || (property !== 'position' && property !== 'quaternion' && property !== 'scale')) return [];
    return [{ node, property: property as 'position' | 'quaternion' | 'scale', interpolant: track.createInterpolant() as Interpolant }];
  });
  const rest = new Map<Object3D, [number[], number[]]>();
  rig.traverse((o) => rest.set(o, [o.position.toArray(), o.quaternion.toArray()]));

  const shoulder = new Vector3(), target = new Vector3(), pole = new Vector3(), reach = new Vector3(), bend = new Vector3();
  const elbow = new Vector3(), wrist = new Vector3(), parentQ = new Quaternion(), upperW = new Quaternion(), lowerW = new Quaternion(), endW = new Quaternion(), inv = new Quaternion();
  const orient = (restQ: Quaternion, dir: Vector3, out: Quaternion) => out.setFromUnitVectors(Y.clone().applyQuaternion(restQ), dir.clone().normalize()).multiply(restQ);
  const solve = (L: Limb, tgt: number[], pl: number[]) => {
    const keptEnd = L.end.getWorldQuaternion(new Quaternion());
    target.fromArray(tgt); pole.fromArray(pl);
    L.upper.parent!.getWorldQuaternion(parentQ);
    L.upper.getWorldPosition(shoulder);
    reach.subVectors(target, shoulder);
    const distance = Math.max(0.02, Math.min(reach.length(), L.a + L.b - 0.002));
    reach.normalize();
    bend.subVectors(pole, shoulder).addScaledVector(reach, -pole.clone().sub(shoulder).dot(reach));
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1);
    bend.normalize();
    const along = (L.a ** 2 - L.b ** 2 + distance ** 2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, L.a ** 2 - along ** 2));
    elbow.copy(shoulder).addScaledVector(reach, along).addScaledVector(bend, height);
    wrist.copy(shoulder).addScaledVector(reach, distance);
    orient(L.upperRest, elbow.clone().sub(shoulder), upperW);
    orient(L.lowerRest, wrist.clone().sub(elbow), lowerW);
    // Hands follow the forearm; feet keep Idle's world orientation (flat on the ground).
    if (L.keepEnd) endW.copy(keptEnd); else orient(L.endRest, wrist.clone().sub(elbow), endW);
    L.upper.quaternion.copy(inv.copy(parentQ).invert().multiply(upperW));
    L.lower.quaternion.copy(inv.copy(upperW).invert().multiply(lowerW));
    L.end.quaternion.copy(inv.copy(lowerW).invert().multiply(endW));
  };

  const recorded: { node: Object3D; property: 'position' | 'quaternion' }[] = [];
  const seen = new Set<string>();
  const record = (node: Object3D | undefined, property: 'position' | 'quaternion') => {
    if (!node || seen.has(`${node.name}.${property}`)) return;
    seen.add(`${node.name}.${property}`); recorded.push({ node, property });
  };
  for (const s of samplers) if (s.property !== 'scale') record(s.node, s.property);
  record(hips, 'position'); record(spine, 'quaternion');
  for (const L of Object.values(limbs)) if (L) { record(L.upper, 'quaternion'); record(L.lower, 'quaternion'); record(L.end, 'quaternion'); }

  const end = keys[keys.length - 1].t;
  const times: number[] = [];
  for (let i = 0; i / 30 < end - 1e-6; i++) times.push(i / 30);
  times.push(end);
  const values = recorded.map(() => [] as number[]);
  const v: number[] = [], w: number[] = [];
  const hipsBase = new Vector3(), hipsWorld = new Vector3(), q = new Quaternion();
  for (const t of times) {
    for (const [o, [p, r]] of rest) { o.position.fromArray(p); o.quaternion.fromArray(r); }
    const bodyTime = t % idle.duration;
    for (const s of samplers) s.node[s.property].fromArray(s.interpolant.evaluate(bodyTime) as unknown as number[]);
    rig.updateMatrixWorld(true);
    if (sample(keys, 'hips', t, v)) {
      hips.getWorldPosition(hipsBase);
      hipsWorld.set(hipsBase.x + v[0], hipsBase.y + v[1], hipsBase.z + v[2]);
      hips.position.copy(hips.parent ? hips.parent.worldToLocal(hipsWorld) : hipsWorld);
    }
    if (sample(keys, 'lean', t, v)) spine.quaternion.multiply(q.setFromAxisAngle(X, v[0]));
    rig.updateMatrixWorld(true);
    const pairs: [Limb | null | undefined, Field, Field][] = [[limbs.FR, 'footR', 'kneeR'], [limbs.FL, 'footL', 'kneeL'], [limbs.R, 'handR', 'poleR'], [limbs.L, 'handL', 'poleL']];
    for (const [L, tf, pf] of pairs) {
      if (L && sample(keys, tf, t, v) && sample(keys, pf, t, w)) { solve(L, v, w); rig.updateMatrixWorld(true); }
    }
    recorded.forEach((r, i) => {
      const value = r.node[r.property].toArray() as number[];
      const list = values[i];
      if (r.property === 'quaternion' && list.length >= 4) {
        const n = list.length;
        if (list[n - 4] * value[0] + list[n - 3] * value[1] + list[n - 2] * value[2] + list[n - 1] * value[3] < 0) value.forEach((x, j) => { value[j] = -x; });
      }
      list.push(...value);
    });
  }
  const tracks: KeyframeTrack[] = recorded.map((r, i) => {
    const trackName = `${r.node.name}.${r.property}`;
    return r.property === 'quaternion' ? new QuaternionKeyframeTrack(trackName, times, values[i]) : new VectorKeyframeTrack(trackName, times, values[i]);
  });
  return new AnimationClip(name, end, tracks);
}

const withEmotesCache = new WeakMap<readonly AnimationClip[], AnimationClip[]>();
/** The clips plus every emote clip the GLB does not bake, built once per clip list (referentially stable). */
export function withEmotes(root: Object3D, clips: AnimationClip[]): AnimationClip[] {
  let cached = withEmotesCache.get(clips);
  if (!cached) {
    const idle = clips.find((c) => c.name === 'Idle');
    const extra = idle ? EMOTE_CLIPS.filter((n) => !clips.some((c) => c.name === n)).map((n) => buildEmoteClip(root, idle, n)).filter((c): c is AnimationClip => !!c) : [];
    cached = extra.length ? [...clips, ...extra] : clips;
    withEmotesCache.set(clips, cached);
  }
  return cached;
}
