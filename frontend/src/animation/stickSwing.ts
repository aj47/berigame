import {
  AnimationClip, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack,
  type Interpolant, type KeyframeTrack, type Object3D,
} from 'three';

/**
 * The stick attack. The adventurer GLB only bakes a bare-handed jab
 * ('Strike'), so the chop is synthesized once per rig when the model loads:
 * the body (lean, twist, planted feet, raised left fist) comes from Strike,
 * time-warped so its peak lands on the stick's impact, and the right arm is
 * re-solved at every sample with the same analytic two-bone IK that authored
 * the baked clips (docs/art/characters/blender-v4/build_character.py `limb`).
 * A baked Blender clip named 'StickSwing' can replace it later unchanged.
 *
 * Everything is in the GLB's model space: +Y up, +Z is where the adventurer
 * faces, and -X is the adventurer's right. One tile is one unit.
 */
export const STICK_SWING_CLIP = 'StickSwing';
/** Wind-up, chop, follow-through and recovery back to the ready pose. */
export const STICK_SWING_MS = 620;
/** When the stick meets an opponent one tile ahead: the defender's Hit reaction and the damage float start here. */
export const STICK_SWING_IMPACT_MS = 300;

/** Samples per second of the synthesized clip (the baked clips use 30; the chop is faster). */
const FPS = 60;
/** Strike's baked punch peaks at 0.16s; its body motion is warped so that peak lands on the stick's impact. */
const STRIKE_PEAK_S = 0.16;

// ---- the stick prop ---------------------------------------------------------
// HandR's local frame (sampled from the GLB): +Y runs from the wrist to the
// knuckles, the fingers curl towards -Z (the palm) and the thumb sits on -X.
/** Inside the curled fist. */
const GRIP = new Vector3(0, 0.105, -0.035);
/**
 * Out of the thumb side, leaning towards the knuckles and the back of the
 * hand. With this lean the baked Idle, Run, Walk, Hit and Defeat clips keep
 * the stick clear of the head, body and ground (see stickSwing.test.ts).
 */
const AXIS = new Vector3(-0.74, 0.57, 0.65).normalize();
/** Butt to tip, in world units (a tile is 1). */
export const STICK_LENGTH = 0.7;
/** How far the butt end pokes out below the fist, measured back from the grip point. */
export const STICK_BUTT = 0.12;
/** Radius at the butt; the branch tapers to STICK_TIP_RADIUS. */
export const STICK_RADIUS = 0.036;
export const STICK_TIP_RADIUS = 0.02;

/**
 * Local transform, under the HandR bone, of a stick mesh modelled along +Y
 * with its butt at y=0 and its tip at y=STICK_LENGTH.
 */
export function stickMount(): { position: [number, number, number]; quaternion: [number, number, number, number] } {
  const position = GRIP.clone().addScaledVector(AXIS, -STICK_BUTT);
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), AXIS);
  return { position: position.toArray() as [number, number, number], quaternion: quaternion.toArray() as [number, number, number, number] };
}

/** Butt and tip of the held stick for a HandR world matrix. */
export function stickSegment(handMatrixWorld: Matrix4): [Vector3, Vector3] {
  return [
    GRIP.clone().addScaledVector(AXIS, -STICK_BUTT).applyMatrix4(handMatrixWorld),
    GRIP.clone().addScaledVector(AXIS, STICK_LENGTH - STICK_BUTT).applyMatrix4(handMatrixWorld),
  ];
}

// ---- the chop ---------------------------------------------------------------
type V3 = readonly [number, number, number];
export interface SwingKey {
  /** Seconds from the start of the swing. */
  t: number;
  /** Wrist (HandR head) target. */
  hand: V3;
  /** Elbow pole: the elbow bends towards this point. */
  pole: V3;
  /** Direction the stick points, butt to tip. */
  stick: V3;
  /** Extra chest turn on top of Strike, radians about +Y (negative pulls the right shoulder back). */
  twist: number;
  /** Extra spine lean on top of Strike, radians (positive leans into the blow). */
  lean: number;
  /** Zero velocity through this key (the top of the wind-up, the ends). */
  hold?: boolean;
}

/** The baked Idle wrist and elbow, and where Idle points the held stick: the swing starts and ends here. */
const READY = { hand: [-0.37, 1.18, 0.16], pole: [-0.70, 1.12, -0.05], stick: [-0.19, 0.976, 0.106], twist: 0, lean: 0 } as const;
/**
 * A diagonal overhead chop: the stick is cocked back over the right shoulder,
 * swings up over the top beside the head, comes down on an opponent one tile
 * ahead at STICK_SWING_IMPACT_MS and follows through low to the left, then
 * returns to the ready pose. Interpolated with C1 Hermite splines, so the
 * swing accelerates into the impact instead of stopping at every key.
 */
export const STICK_SWING_KEYS: readonly SwingKey[] = [
  { t: 0.00, ...READY, hold: true },
  { t: 0.08, hand: [-0.50, 1.40, 0.08], pole: [-0.90, 1.20, 0.00], stick: [-0.30, 0.95, 0.05], twist: -0.15, lean: -0.02 },
  { t: 0.18, hand: [-0.52, 1.80, -0.08], pole: [-0.95, 1.60, 0.15], stick: [-0.30, 0.80, -0.52], twist: -0.35, lean: -0.06, hold: true },
  { t: 0.25, hand: [-0.51, 1.84, 0.20], pole: [-0.95, 1.60, 0.30], stick: [-0.12, 0.92, 0.38], twist: -0.1, lean: 0 },
  { t: 0.30, hand: [-0.34, 1.72, 0.44], pole: [-0.85, 1.40, 0.30], stick: [0.10, -0.20, 0.97], twist: 0.15, lean: 0.06 },
  { t: 0.36, hand: [-0.20, 1.30, 0.48], pole: [-0.70, 1.05, 0.20], stick: [0.30, -0.75, 0.60], twist: 0.2, lean: 0.08 },
  { t: 0.46, hand: [-0.08, 1.02, 0.36], pole: [-0.70, 0.95, 0.15], stick: [0.45, -0.80, 0.40], twist: 0.15, lean: 0.05, hold: true },
  { t: 0.54, hand: [-0.24, 1.08, 0.32], pole: [-0.70, 1.00, 0.05], stick: [0.05, 0.55, 0.83], twist: 0.05, lean: 0.02 },
  { t: 0.62, ...READY, hold: true },
];

type Field = 'hand' | 'pole' | 'stick' | 'twist' | 'lean';
const component = (key: SwingKey, field: Field, axis: number): number => {
  const value = key[field];
  return typeof value === 'number' ? value : value[axis];
};
/** C1 Hermite spline through the keys, with finite-difference tangents (zero at holds and ends). */
function hermite(keys: readonly SwingKey[], field: Field, t: number, axis: number): number {
  const last = keys.length - 1;
  if (t <= keys[0].t) return component(keys[0], field, axis);
  if (t >= keys[last].t) return component(keys[last], field, axis);
  let k = 0;
  while (k < last - 1 && keys[k + 1].t <= t) k++;
  const tangent = (i: number) => keys[i].hold || i === 0 || i === last ? 0
    : (component(keys[i + 1], field, axis) - component(keys[i - 1], field, axis)) / (keys[i + 1].t - keys[i - 1].t);
  const h = keys[k + 1].t - keys[k].t, u = (t - keys[k].t) / h;
  return (2 * u ** 3 - 3 * u ** 2 + 1) * component(keys[k], field, axis) + (u ** 3 - 2 * u ** 2 + u) * h * tangent(k)
    + (-2 * u ** 3 + 3 * u ** 2) * component(keys[k + 1], field, axis) + (u ** 3 - u ** 2) * h * tangent(k + 1);
}
const hermite3 = (keys: readonly SwingKey[], field: 'hand' | 'pole' | 'stick', t: number, out: Vector3) =>
  out.set(hermite(keys, field, t, 0), hermite(keys, field, t, 1), hermite(keys, field, t, 2));

/** Swing time -> Strike time: Strike's punch peak (the lean and chest twist) lands on the stick's impact. */
function strikeTime(t: number, strikeDuration: number): number {
  const impact = STICK_SWING_IMPACT_MS / 1000, end = STICK_SWING_MS / 1000;
  if (t <= impact) return (t / impact) * STRIKE_PEAK_S;
  return Math.min(strikeDuration, STRIKE_PEAK_S + ((t - impact) / (end - impact)) * (strikeDuration - STRIKE_PEAK_S));
}

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0);
/** Rotation whose columns are an orthonormal frame with x along `a` and y as close to `b` as possible. */
function frame(a: Vector3, b: Vector3): Matrix4 {
  const x = a.clone().normalize();
  const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
  return new Matrix4().makeBasis(x, y, new Vector3().crossVectors(x, y));
}

interface Sampler { node: Object3D; property: 'position' | 'quaternion' | 'scale'; interpolant: Interpolant }

/**
 * Build the StickSwing clip for a loaded adventurer rig. `root` is the GLTF
 * scene (it is cloned, never posed) and `strike` its baked 'Strike' clip.
 * Returns null for a rig without the adventurer's right arm.
 */
export function buildStickSwing(root: Object3D, strike: AnimationClip, keys: readonly SwingKey[] = STICK_SWING_KEYS): AnimationClip | null {
  const rig = root.clone(true);
  rig.position.set(0, 0, 0); rig.quaternion.identity(); rig.scale.set(1, 1, 1);
  const nodes = new Map<string, Object3D>();
  rig.traverse((object) => { if (!nodes.has(object.name)) nodes.set(object.name, object); });
  const upper = nodes.get('UpperArmR'), fore = nodes.get('ForearmR'), hand = nodes.get('HandR');
  const spine = nodes.get('Spine'), chestBone = nodes.get('Chest');
  if (!upper?.parent || !fore || !hand || !spine || !chestBone) return null;
  rig.updateMatrixWorld(true);
  // Bind-pose orientations: `orient` turns a bone from its rest direction.
  const upperRest = upper.getWorldQuaternion(new Quaternion());
  const foreRest = fore.getWorldQuaternion(new Quaternion());
  const upperLength = fore.position.length(), foreLength = hand.position.length();

  const samplers: Sampler[] = [];
  for (const track of strike.tracks) {
    const dot = track.name.lastIndexOf('.');
    const node = nodes.get(track.name.slice(0, dot));
    const property = track.name.slice(dot + 1);
    if (!node || (property !== 'position' && property !== 'quaternion' && property !== 'scale')) continue;
    samplers.push({ node, property, interpolant: track.createInterpolant() });
  }

  const shoulder = new Vector3(), target = new Vector3(), pole = new Vector3(), stick = new Vector3();
  const reach = new Vector3(), bend = new Vector3(), elbow = new Vector3(), wrist = new Vector3();
  const chest = new Quaternion(), upperWorld = new Quaternion(), foreWorld = new Quaternion(), handWorld = new Quaternion();
  const turn = new Quaternion(), inverse = new Quaternion();
  const orient = (rest: Quaternion, direction: Vector3, out: Quaternion) =>
    out.setFromUnitVectors(Y.clone().applyQuaternion(rest), direction.clone().normalize()).multiply(rest);
  const localFrame = frame(AXIS, Y).transpose();

  const solveArm = (t: number) => {
    hermite3(keys, 'hand', t, target); hermite3(keys, 'pole', t, pole); hermite3(keys, 'stick', t, stick).normalize();
    upper.parent!.getWorldQuaternion(chest);
    upper.getWorldPosition(shoulder);
    // Two-bone IK (build_character.py `limb`): place the elbow in the pole plane.
    reach.subVectors(target, shoulder);
    const distance = Math.max(0.02, Math.min(reach.length(), upperLength + foreLength - 0.002));
    reach.normalize();
    bend.subVectors(pole, shoulder).addScaledVector(reach, -pole.clone().sub(shoulder).dot(reach));
    if (bend.lengthSq() < 1e-8) bend.set(-1, 0, 0).addScaledVector(reach, reach.x);
    bend.normalize();
    const along = (upperLength ** 2 - foreLength ** 2 + distance ** 2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
    elbow.copy(shoulder).addScaledVector(reach, along).addScaledVector(bend, height);
    wrist.copy(shoulder).addScaledVector(reach, distance);
    orient(upperRest, elbow.clone().sub(shoulder), upperWorld);
    orient(foreRest, wrist.clone().sub(elbow), foreWorld);
    // Aim the stick; the knuckles follow the forearm as closely as that allows,
    // so the wrist only bends as much as the stick direction demands.
    const forearmDirection = wrist.clone().sub(elbow).normalize();
    handWorld.setFromRotationMatrix(frame(stick, forearmDirection).multiply(localFrame));
    upper.quaternion.copy(inverse.copy(chest).invert().multiply(upperWorld));
    fore.quaternion.copy(inverse.copy(upperWorld).invert().multiply(foreWorld));
    hand.quaternion.copy(inverse.copy(foreWorld).invert().multiply(handWorld));
  };

  const end = STICK_SWING_MS / 1000;
  const times: number[] = [];
  for (let frameIndex = 0; frameIndex / FPS < end - 1e-6; frameIndex++) times.push(frameIndex / FPS);
  times.push(end);
  const values = samplers.map(() => [] as number[]);
  for (const t of times) {
    const bodyTime = strikeTime(t, strike.duration);
    for (const sampler of samplers) sampler.node[sampler.property].fromArray(sampler.interpolant.evaluate(bodyTime) as unknown as number[]);
    // Spine and Chest rest aligned with the model axes, so these are a lean and a turn.
    spine.quaternion.multiply(turn.setFromAxisAngle(X, hermite(keys, 'lean', t, 0)));
    chestBone.quaternion.multiply(turn.setFromAxisAngle(Y, hermite(keys, 'twist', t, 0)));
    rig.updateMatrixWorld(true);
    solveArm(t);
    samplers.forEach((sampler, i) => {
      const value = sampler.node[sampler.property].toArray() as number[];
      const list = values[i];
      // Keep consecutive quaternions in one hemisphere so blending never takes the long way round.
      if (sampler.property === 'quaternion' && list.length >= 4) {
        const n = list.length;
        if (list[n - 4] * value[0] + list[n - 3] * value[1] + list[n - 2] * value[2] + list[n - 1] * value[3] < 0) value.forEach((v, j) => { value[j] = -v; });
      }
      list.push(...value);
    });
  }
  const tracks: KeyframeTrack[] = samplers.map((sampler, i) => {
    const name = `${sampler.node.name}.${sampler.property}`;
    return sampler.property === 'quaternion' ? new QuaternionKeyframeTrack(name, times, values[i]) : new VectorKeyframeTrack(name, times, values[i]);
  });
  return new AnimationClip(STICK_SWING_CLIP, end, tracks);
}

const withSwing = new WeakMap<readonly AnimationClip[], AnimationClip[]>();
/**
 * The GLB's clips plus StickSwing, built once per loaded GLB. The returned
 * array is referentially stable: drei's useAnimations only learns clip names
 * on its first render and uncaches every action when the array changes.
 */
export function withStickSwing(root: Object3D, clips: AnimationClip[]): AnimationClip[] {
  let cached = withSwing.get(clips);
  if (!cached) {
    const strike = clips.find((clip) => clip.name === 'Strike');
    const swing = strike && !clips.some((clip) => clip.name === STICK_SWING_CLIP) ? buildStickSwing(root, strike) : null;
    cached = swing ? [...clips, swing] : clips;
    withSwing.set(clips, cached);
  }
  return cached;
}
