import { BufferGeometry, Vector3 } from 'three';
import { Cosmetic } from '@sim';
import { STICK_RADIUS, STICK_TIP_RADIUS } from '../../animation/stickSwing';
import { LowPolyBuilder, coastMaterial, linear, seeded } from './nodes/lowPoly';

/**
 * Milestone cosmetics (shared/sim/skills.ts COSMETICS) and the flint knife as
 * tiny flat-shaded vertex-colour meshes on the avatar rig: one shared geometry
 * per cosmetic and the Coast's shared material, so a worn cosmetic is one
 * extra draw call and nothing is disposed per avatar (render with dispose={null}).
 *
 * Head cosmetics are modelled in the `Head` bone's frame (y up from the base
 * of the skull), neck cosmetics in the `Neck` bone's frame.
 */
export const HEAD_BONE = 'Head';
export const NECK_BONE = 'Neck';
/** Crown of the head above the Head bone, and the brim height a hat sits at (rig units). */
const HEAD_TOP = 0.3;
const BRIM_Y = 0.22;

const STRAW = 0xe2c27a, STRAW_DARK = 0xc29a52, STRAW_BAND = 0xb4533f;
const SCARF = 0x3f8fa8, SCARF_DARK = 0x2e6c80, SCARF_STRIPE = 0xe9dcc0;
const PETAL = [0xf2a0b8, 0xf7e27c, 0xffffff, 0xc8a0f0], LEAF = 0x5d9a4a;
const SHELL = [0xf5e6d3, 0xf0c9b0, 0xe8d8c0], CORD = 0x8a6a45;
const DRIFT = 0xc9b594, DRIFT_DARK = 0x9d8a6c, FLINT = 0x4a5870, FLINT_LIGHT = 0x7d8da6;
const SASH = [0xc9934e, 0x9c6b3a, 0xe0c080];

function ringPoints(radius: number, count: number, y: number, phase = 0): Vector3[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count + phase;
    return new Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
  });
}

function strawHat(): BufferGeometry {
  const b = new LowPolyBuilder();
  // Wide flat brim, a band and a squat crown.
  b.log(new Vector3(0, BRIM_Y, 0), new Vector3(0, BRIM_Y + 0.02, 0), 0.36, 0.34, { sides: 10, rings: 2, bark: [linear(STRAW), linear(STRAW_DARK)], cap: linear(STRAW) });
  b.log(new Vector3(0, BRIM_Y + 0.02, 0), new Vector3(0, BRIM_Y + 0.07, 0), 0.19, 0.185, { sides: 8, rings: 2, bark: [linear(STRAW_BAND)], cap: linear(STRAW_BAND), capStart: false });
  b.log(new Vector3(0, BRIM_Y + 0.07, 0), new Vector3(0, BRIM_Y + 0.16, 0), 0.185, 0.14, { sides: 8, rings: 2, bark: [linear(STRAW), linear(STRAW_DARK)], cap: linear(STRAW), capStart: false });
  return b.build();
}

function flowerCrown(): BufferGeometry {
  const b = new LowPolyBuilder();
  const y = HEAD_TOP - 0.06;
  // A thin leafy ring with a flower (a small faceted blob) every 45 degrees.
  b.log(new Vector3(0, y, 0), new Vector3(0, y + 0.025, 0), 0.22, 0.22, { sides: 10, rings: 2, bark: [linear(LEAF)], cap: linear(LEAF), capStart: false, capEnd: false });
  ringPoints(0.225, 8, y + 0.02).forEach((p, i) => b.rock(p, 0.045, new Vector3(1, 0.7, 1), { segments: 5, jitter: 0.2, seed: 30 + i, colors: [linear(PETAL[i % PETAL.length])], top: linear(0xf6c945) }));
  return b.build();
}

function driftwoodCrown(): BufferGeometry {
  const b = new LowPolyBuilder();
  const y = HEAD_TOP - 0.07;
  b.log(new Vector3(0, y, 0), new Vector3(0, y + 0.05, 0), 0.215, 0.21, { sides: 8, rings: 2, bark: [linear(DRIFT), linear(DRIFT_DARK)], cap: linear(DRIFT), capStart: false, capEnd: false });
  // Five driftwood points, the front one tipped with flint.
  const rand = seeded(5);
  ringPoints(0.205, 5, y + 0.04, Math.PI / 2).forEach((p, i) => {
    const tip = p.clone().multiplyScalar(1.08).setY(y + 0.13 + rand() * 0.04);
    b.log(p, tip, 0.035, 0.008, { sides: 4, rings: 2, bark: [linear(DRIFT), linear(DRIFT_DARK)], cap: linear(DRIFT) });
    if (i === 0) b.rock(tip, 0.035, new Vector3(0.8, 1.3, 0.6), { segments: 4, jitter: 0.2, seed: 9, colors: [linear(FLINT), linear(FLINT_LIGHT)] });
  });
  return b.build();
}

function coastScarf(): BufferGeometry {
  const b = new LowPolyBuilder();
  // A chunky knitted collar around the neck and a tail hanging down the back-left.
  b.log(new Vector3(0, -0.04, 0), new Vector3(0, 0.07, 0), 0.19, 0.16, { sides: 8, rings: 3, wobble: 0.01, seed: 4, bark: [linear(SCARF), linear(SCARF_DARK), linear(SCARF_STRIPE)], cap: linear(SCARF_DARK), capStart: false, capEnd: false });
  b.log(new Vector3(0.09, 0.0, -0.14), new Vector3(0.13, -0.24, -0.17), 0.05, 0.04, { sides: 4, rings: 3, bark: [linear(SCARF), linear(SCARF_STRIPE), linear(SCARF_DARK)], cap: linear(SCARF_STRIPE) });
  return b.build();
}

function shellNecklace(): BufferGeometry {
  const b = new LowPolyBuilder();
  b.log(new Vector3(0, 0.0, 0), new Vector3(0, 0.015, 0), 0.175, 0.175, { sides: 10, rings: 2, bark: [linear(CORD)], cap: linear(CORD), capStart: false, capEnd: false });
  // Shells across the front (+z faces forward on the rig).
  [-0.9, -0.45, 0, 0.45, 0.9].forEach((a, i) => {
    const p = new Vector3(Math.sin(a) * 0.18, -0.02 - (i === 2 ? 0.02 : 0), Math.cos(a) * 0.18);
    b.rock(p, i === 2 ? 0.05 : 0.035, new Vector3(1, 1.1, 0.5), { segments: 5, jitter: 0.25, seed: 50 + i, colors: SHELL.map(linear) });
  });
  return b.build();
}

function wovenSash(): BufferGeometry {
  const b = new LowPolyBuilder();
  // A braided cord collar and a short woven bib in front.
  b.log(new Vector3(0, -0.02, 0), new Vector3(0, 0.03, 0), 0.18, 0.17, { sides: 8, rings: 2, bark: SASH.map(linear), cap: linear(SASH[1]), capStart: false, capEnd: false });
  b.log(new Vector3(0, -0.02, 0.16), new Vector3(0, -0.2, 0.19), 0.07, 0.05, { sides: 4, rings: 3, bark: SASH.map(linear), cap: linear(SASH[2]) });
  return b.build();
}

const BUILDERS: Record<number, () => BufferGeometry> = {
  [Cosmetic.StrawHat]: strawHat,
  [Cosmetic.CoastScarf]: coastScarf,
  [Cosmetic.FlowerCrown]: flowerCrown,
  [Cosmetic.ShellNecklace]: shellNecklace,
  [Cosmetic.DriftwoodCrown]: driftwoodCrown,
  [Cosmetic.WovenSash]: wovenSash,
};
const geometries = new Map<number, BufferGeometry>();

/** Shared geometry for cosmetic `id` (created on first use), or null for an unknown id. */
export function cosmeticGeometry(id: number): BufferGeometry | null {
  const build = BUILDERS[id];
  if (!build) return null;
  let g = geometries.get(id);
  if (!g) { g = build(); geometries.set(id, g); }
  return g;
}

export const cosmeticMaterial = coastMaterial;

// ---- The flint knife (F2 recipe), in stickProp's frame -------------------------
let knife: BufferGeometry | null = null;
export function knifeGeometry(): BufferGeometry {
  if (knife) return knife;
  const b = new LowPolyBuilder();
  b.log(new Vector3(0, 0, 0), new Vector3(0, 0.26, 0), STICK_RADIUS * 1.1, STICK_TIP_RADIUS * 1.6, { rings: 2, bark: [linear(DRIFT), linear(DRIFT_DARK)], cap: linear(0xe6d8bb) });
  b.log(new Vector3(0, 0.2, 0), new Vector3(0, 0.27, 0), STICK_TIP_RADIUS * 2, STICK_TIP_RADIUS * 2, { rings: 2, bark: [linear(CORD), linear(0xa8743a)], cap: linear(CORD) });
  // A long knapped blade.
  b.rock(new Vector3(0, 0.42, 0), 0.16, new Vector3(0.28, 1.1, 0.12), { segments: 5, jitter: 0.25, seed: 21, colors: [linear(FLINT), linear(FLINT_LIGHT), linear(0x36404f)], top: linear(FLINT_LIGHT) });
  return knife = b.build();
}
