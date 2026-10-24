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
const HEAD_TOP = 0.42;
const BRIM_Y = 0.34;

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

/** Welcomed Ribbon: a headband with a bow on the right side. */
function welcomedRibbon(): BufferGeometry {
  const b = new LowPolyBuilder();
  const y = HEAD_TOP - 0.12;
  const RIB = linear(0xe0566f), RIB_DARK = linear(0xb23a52);
  b.log(new Vector3(0, y, 0), new Vector3(0, y + 0.035, 0), 0.215, 0.215, { sides: 10, rings: 2, bark: [RIB, RIB_DARK], cap: RIB, capStart: false, capEnd: false });
  const knot = new Vector3(0.2, y + 0.04, 0.06);
  b.rock(knot, 0.03, new Vector3(1, 1, 1), { segments: 4, seed: 61, colors: [RIB_DARK] });
  b.rock(knot.clone().add(new Vector3(0.02, 0.05, 0.05)), 0.05, new Vector3(0.5, 1, 1.2), { segments: 4, jitter: 0.15, seed: 62, colors: [RIB, RIB_DARK] });
  b.rock(knot.clone().add(new Vector3(0.02, 0.05, -0.05)), 0.05, new Vector3(0.5, 1, 1.2), { segments: 4, jitter: 0.15, seed: 63, colors: [RIB, RIB_DARK] });
  return b.build();
}

/** Mentor's Pin: a cord with a round pin in front; bronze, silver or gold by tier. */
function mentorPin(metal: number, shine: number): () => BufferGeometry {
  return () => {
    const b = new LowPolyBuilder();
    b.log(new Vector3(0, 0.0, 0), new Vector3(0, 0.015, 0), 0.175, 0.175, { sides: 10, rings: 2, bark: [linear(0x3d5a80)], cap: linear(0x3d5a80), capStart: false, capEnd: false });
    b.log(new Vector3(0, -0.07, 0.17), new Vector3(0, -0.07, 0.205), 0.06, 0.06, { sides: 8, rings: 2, bark: [linear(metal)], cap: linear(shine) });
    b.rock(new Vector3(0, -0.07, 0.21), 0.025, new Vector3(1, 1, 0.4), { segments: 4, seed: 71, colors: [linear(0x3d5a80)] });
    return b.build();
  };
}

/** Giant's Tooth: a leather cord with a big pale stone tooth hanging in front. */
function giantsTooth(): BufferGeometry {
  const b = new LowPolyBuilder();
  b.log(new Vector3(0, 0.0, 0), new Vector3(0, 0.015, 0), 0.175, 0.175, { sides: 10, rings: 2, bark: [linear(CORD)], cap: linear(CORD), capStart: false, capEnd: false });
  b.log(new Vector3(0, -0.03, 0.18), new Vector3(0.01, -0.2, 0.2), 0.045, 0.006, { sides: 5, rings: 3, wobble: 0.004, seed: 81, bark: [linear(0xefe6d2), linear(0xd6cbb2)], cap: linear(0xf6efe0) });
  return b.build();
}

/** Berry Heart: the Giant's thank-you, a berry-red heart with a little leaf. */
function berryHeart(): BufferGeometry {
  const b = new LowPolyBuilder();
  b.log(new Vector3(0, 0, 0), new Vector3(0, .015, 0), .175, .175, { sides: 10, rings: 2, bark: [linear(CORD)], cap: linear(CORD), capStart: false, capEnd: false });
  b.log(new Vector3(0, 0, .175), new Vector3(0, -.07, .2), .012, .012, { sides: 5, rings: 2, bark: [linear(CORD)], cap: linear(CORD) });
  const outline = [[0, -.072], [-.05, -.042], [-.09, -.07], [-.085, -.12], [0, -.21], [.085, -.12], [.09, -.07], [.05, -.042]];
  const front = outline.map(([x, y]) => new Vector3(x, y, .224));
  const back = outline.map(([x, y]) => new Vector3(x, y, .19));
  const centre = new Vector3(0, -.12, .242), rear = new Vector3(0, -.12, .19);
  const berry = [linear(0xd85478), linear(0xe97892), linear(0xc33d66)];
  for (let i = 0; i < front.length; i++) {
    const next = (i + 1) % front.length;
    b.triangle(centre, front[i], front[next], berry[i % berry.length]);
    b.triangle(rear, back[next], back[i], berry[2]);
    b.triangle(front[i], back[i], back[next], berry[2]);
    b.triangle(front[i], back[next], front[next], berry[0]);
  }
  b.rock(new Vector3(.035, -.048, .222), .029, new Vector3(1.3, .55, .35), { segments: 5, seed: 91, colors: [linear(LEAF), linear(0x8aba61)] });
  return b.build();
}

// ---- Boss keepsakes (Clatterhorn and the Sunken Spire) ------------------------------
const BEETLE = [0x2e7d6f, 0x3b5ba9, 0x7e4fa8], BEETLE_DARK = 0x1f3f4a;
const PRISM = [0x9fe7ff, 0xffd6f0, 0xb79bff], PRISM_CORE = 0xf4fbff, SILVER = 0xb9c2cc, SILVER_DARK = 0x7f8a96;

/** Clatterhorn Horn: a dark band with the beetle's forked, iridescent horn rising over the brow. */
function clatterhornHorn(): BufferGeometry {
  const b = new LowPolyBuilder();
  const y = HEAD_TOP - 0.11;
  b.log(new Vector3(0, y, 0), new Vector3(0, y + 0.04, 0), 0.215, 0.215, { sides: 10, rings: 2, bark: [linear(BEETLE_DARK), linear(BEETLE[0])], cap: linear(BEETLE_DARK), capStart: false, capEnd: false });
  const base = new Vector3(0, y + 0.03, 0.2), bend = new Vector3(0, y + 0.17, 0.25), fork = new Vector3(0, y + 0.26, 0.2);
  const shell = BEETLE.map(linear);
  b.log(base, bend, 0.05, 0.038, { sides: 5, rings: 2, bark: shell, cap: linear(BEETLE[0]), capEnd: false });
  b.log(bend, fork, 0.038, 0.026, { sides: 5, rings: 2, bark: shell, cap: linear(BEETLE[2]), capStart: false, capEnd: false });
  for (const side of [-1, 1]) b.log(fork, new Vector3(side * 0.06, y + 0.33, 0.16), 0.026, 0.006, { sides: 4, rings: 2, bark: [linear(BEETLE[2]), linear(BEETLE[1])], cap: linear(BEETLE[2]), capStart: false });
  return b.build();
}

/** Prism Crown: a silver band ringed with glass spikes in the Shardmother's phase colours. */
function prismCrown(): BufferGeometry {
  const b = new LowPolyBuilder();
  const y = HEAD_TOP - 0.08;
  b.log(new Vector3(0, y, 0), new Vector3(0, y + 0.04, 0), 0.215, 0.21, { sides: 10, rings: 2, bark: [linear(SILVER), linear(SILVER_DARK)], cap: linear(SILVER), capStart: false, capEnd: false });
  ringPoints(0.21, 5, y + 0.1, Math.PI / 2).forEach((p, i) => {
    b.rock(p, 0.05, new Vector3(0.55, i === 0 ? 2.1 : 1.6, 0.55), { segments: 4, jitter: 0.1, seed: 101 + i, colors: [linear(PRISM[i % 3]), linear(PRISM_CORE)], top: linear(PRISM_CORE) });
  });
  return b.build();
}

/** Shard Pendant: a silver chain with a long prism shard hanging in front. */
function shardPendant(): BufferGeometry {
  const b = new LowPolyBuilder();
  b.log(new Vector3(0, 0, 0), new Vector3(0, 0.015, 0), 0.175, 0.175, { sides: 10, rings: 2, bark: [linear(SILVER), linear(SILVER_DARK)], cap: linear(SILVER), capStart: false, capEnd: false });
  b.log(new Vector3(0, 0, 0.175), new Vector3(0, -0.06, 0.2), 0.01, 0.01, { sides: 5, rings: 2, bark: [linear(SILVER_DARK)], cap: linear(SILVER) });
  b.rock(new Vector3(0, -0.13, 0.21), 0.07, new Vector3(0.45, 1.3, 0.35), { segments: 5, jitter: 0.12, seed: 111, colors: PRISM.map(linear), top: linear(PRISM_CORE) });
  return b.build();
}

/** Shard Circlet: a fine silver circlet with one prism shard on the brow and two small ones at the temples. */
function shardCirclet(): BufferGeometry {
  const b = new LowPolyBuilder();
  const y = HEAD_TOP - 0.12;
  b.log(new Vector3(0, y, 0), new Vector3(0, y + 0.02, 0), 0.218, 0.218, { sides: 10, rings: 2, bark: [linear(SILVER), linear(SILVER_DARK)], cap: linear(SILVER), capStart: false, capEnd: false });
  b.rock(new Vector3(0, y + 0.05, 0.215), 0.045, new Vector3(0.55, 1.5, 0.4), { segments: 5, jitter: 0.1, seed: 121, colors: [linear(PRISM[0]), linear(PRISM[2])], top: linear(PRISM_CORE) });
  for (const side of [-1, 1]) {
    b.rock(new Vector3(side * 0.15, y + 0.03, 0.15), 0.028, new Vector3(0.6, 1.3, 0.5), { segments: 4, jitter: 0.1, seed: 122 + side, colors: [linear(PRISM[1]), linear(PRISM[0])], top: linear(PRISM_CORE) });
  }
  return b.build();
}

// ---- The Long Season keepsakes (ids 16-29) ------------------------------------------
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);

/** A plain cord/chain collar in the Neck frame. 20 tris. */
function collar(b: LowPolyBuilder, colors: number[], radius = 0.175, y = 0) {
  b.log(new Vector3(0, y, 0), new Vector3(0, y + 0.015, 0), radius, radius, { sides: 10, rings: 2, bark: colors.map(linear), cap: linear(colors[0]), capStart: false, capEnd: false });
}

/**
 * A faceted star in the plane spanned by `u` (right) and `v` (up), bulging
 * `depth` towards `n` and half as much behind. 4*points tris.
 */
function star(b: LowPolyBuilder, centre: Vector3, u: Vector3, v: Vector3, n: Vector3, outer: number, inner: number, depth: number, colors: number[], points = 5) {
  const outline = Array.from({ length: points * 2 }, (_, i) => {
    const a = Math.PI / 2 + (Math.PI * i) / points, r = i % 2 === 0 ? outer : inner;
    return centre.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r);
  });
  const front = centre.clone().addScaledVector(n, depth), back = centre.clone().addScaledVector(n, -depth / 2);
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length], c = linear(colors[i % colors.length]);
    b.triangle(front, p, q, c);
    b.triangle(back, q, p, linear(colors[(i + 1) % colors.length]));
  });
}

/** A two-sided leaf from `base` to `tip`, `width` wide along `side`, creased down the middle. 4 tris. */
function leaf(b: LowPolyBuilder, base: Vector3, tip: Vector3, side: Vector3, width: number, light: number, dark: number) {
  const mid = base.clone().lerp(tip, 0.45);
  const l = mid.clone().addScaledVector(side, width), r = mid.clone().addScaledVector(side, -width);
  b.triangle(base, tip, l, linear(light)); b.triangle(base, l, tip, linear(dark));
  b.triangle(base, r, tip, linear(dark)); b.triangle(base, tip, r, linear(light));
}

/** Point on a ring around the y axis; angle PI/2 faces forward (+z). */
const around = (a: number, radius: number, y: number) => new Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);

const GLOW = [0x5fc9b4, 0x7fd3c4, 0x3fa596], GLOW_SPOT = 0xd8fff6, GILL = 0xeadfc4;
/** Glowcap Cap: a broad teal mushroom cap with pale glowing spots and cream gills under the rim. */
function glowcapCap(): BufferGeometry {
  const b = new LowPolyBuilder();
  const rim = BRIM_Y - 0.01, centre = BRIM_Y + 0.06;
  // Cream gills under a thick teal rim, then a tall dome dotted with glowing spots.
  b.log(new Vector3(0, rim - 0.012, 0), new Vector3(0, rim, 0), 0.29, 0.29, { sides: 10, rings: 2, bark: [linear(GILL), linear(0xd6c7a6)], cap: linear(GILL), capEnd: false });
  b.log(new Vector3(0, rim, 0), new Vector3(0, rim + 0.05, 0), 0.3, 0.26, { sides: 10, rings: 2, bark: GLOW.map(linear), cap: linear(GLOW[2]), capStart: false });
  b.rock(new Vector3(0, centre, 0), 0.26, new Vector3(1, 0.6, 1), { segments: 10, jitter: 0.05, seed: 161, colors: GLOW.map(linear), top: linear(GLOW[1]) });
  [[0.6, 0.12], [2.0, 0.17], [3.3, 0.1], [4.5, 0.19], [5.6, 0.15], [1.5, 0.2]].forEach(([a, r], i) => {
    const y = centre + Math.sqrt(Math.max(0, 1 - (r / 0.26) ** 2)) * 0.15;
    b.rock(around(a, r, y), 0.03, new Vector3(1, 0.45, 1), { segments: 4, jitter: 0.1, seed: 162 + i, colors: [linear(GLOW_SPOT)], top: linear(0xffffff) });
  });
  return b.build();
}

const CORAL = [0xf26b6b, 0xe8506a, 0xf58a8a], CORAL_TIP = 0xffc2c2;
/** Coral Circlet: a coral band with branching red-pink coral sprigs standing up around the brow. */
function coralCirclet(): BufferGeometry {
  const b = new LowPolyBuilder();
  const y = HEAD_TOP - 0.1;
  b.log(new Vector3(0, y, 0), new Vector3(0, y + 0.03, 0), 0.218, 0.214, { sides: 10, rings: 2, bark: CORAL.map(linear), cap: linear(CORAL[0]), capStart: false, capEnd: false });
  const rand = seeded(17);
  [Math.PI / 2, Math.PI / 2 + 0.75, Math.PI / 2 - 0.75, Math.PI / 2 + 1.6, Math.PI / 2 - 1.6].forEach((a, i) => {
    const base = around(a, 0.215, y + 0.025), out = around(a, 1, 0).setY(0);
    const h = i === 0 ? 0.13 : 0.09 + rand() * 0.02;
    const top = base.clone().addScaledVector(Y, h).addScaledVector(out, 0.02);
    const opts = { sides: 3, rings: 2, bark: CORAL.map(linear), cap: linear(CORAL_TIP), capStart: false };
    b.log(base, top, 0.022, 0.012, opts);
    const fork = base.clone().lerp(top, 0.5), side = new Vector3(-out.z, 0, out.x);
    for (const s of [-1, 1]) b.log(fork, fork.clone().addScaledVector(side, s * 0.045).addScaledVector(Y, h * 0.45), 0.013, 0.007, opts);
  });
  return b.build();
}

const KERCHIEF = [0xc4473a, 0xa8352c], KERCHIEF_DOT = 0xf2e2c4;
/** Artisan's Kerchief: a red neckerchief, knotted at the front with a triangle of cloth hanging below. */
function artisansKerchief(): BufferGeometry {
  const b = new LowPolyBuilder();
  b.log(new Vector3(0, -0.035, 0), new Vector3(0, 0.035, 0), 0.185, 0.165, { sides: 8, rings: 2, bark: KERCHIEF.map(linear), cap: linear(KERCHIEF[1]), capStart: false, capEnd: false });
  // The hanging triangle, slightly folded down its middle.
  const l = new Vector3(-0.11, -0.01, 0.15), r = new Vector3(0.11, -0.01, 0.15), fold = new Vector3(0, -0.04, 0.2), point = new Vector3(0, -0.17, 0.2);
  b.triangle(l, point, fold, linear(KERCHIEF[0])); b.triangle(fold, point, r, linear(KERCHIEF[1]));
  b.triangle(l, fold, point, linear(KERCHIEF[1])); b.triangle(fold, r, point, linear(KERCHIEF[0]));
  // Polka dots and the knot.
  [new Vector3(-0.035, -0.07, 0.196), new Vector3(0.035, -0.07, 0.196), new Vector3(0, -0.12, 0.2)].forEach((p, i) =>
    b.rock(p, 0.014, new Vector3(1, 1, 0.4), { segments: 4, seed: 181 + i, colors: [linear(KERCHIEF_DOT)] }));
  b.rock(new Vector3(0, -0.02, 0.195), 0.035, new Vector3(1.2, 0.9, 0.8), { segments: 5, jitter: 0.2, seed: 184, colors: KERCHIEF.map(linear) });
  for (const s of [-1, 1]) b.log(new Vector3(s * 0.02, -0.03, 0.2), new Vector3(s * 0.06, -0.08, 0.21), 0.016, 0.006, { sides: 3, rings: 2, bark: [linear(KERCHIEF[1])], cap: linear(KERCHIEF[0]), capStart: false });
  return b.build();
}

const STARPETAL = [0xf6e7a1, 0xfff4c8, 0xe8cf72], STAR_HEART = 0xf2b84a;
/** Starpetal Garland: a leafy cord strung with pale gold five-pointed star flowers, thickest at the front. */
function starpetalGarland(): BufferGeometry {
  const b = new LowPolyBuilder();
  collar(b, [LEAF, 0x4a7f3a], 0.18, -0.01);
  [-1.15, -0.7, -0.25, 0.25, 0.7, 1.15, Math.PI].forEach((t, i) => {
    const a = Math.PI / 2 + t, c = around(a, 0.19, -0.01 - (Math.abs(t) < 1.2 ? 0.02 * Math.cos(t) : 0));
    const n = around(a, 1, 0), u = new Vector3(-n.z, 0, n.x);
    star(b, c, u, Y, n, i === 6 ? 0.04 : 0.048, 0.02, 0.015, i % 2 ? STARPETAL : [STARPETAL[1], STARPETAL[0], STARPETAL[2]]);
    b.rock(c.clone().addScaledVector(n, 0.012), 0.011, new Vector3(1, 1, 1), { segments: 3, seed: 191 + i, colors: [linear(STAR_HEART)] });
  });
  return b.build();
}

const MOONSTONE = [0xbfd4f2, 0xe2ecfb, 0x9fb8e4];
/** Moonstone Torc: an open silver neck ring with pale blue moonstone knobs at both ends and one at the back. */
function moonstoneTorc(): BufferGeometry {
  const b = new LowPolyBuilder();
  const gap = 0.32, steps = 9, y = -0.005;
  for (let i = 0; i < steps; i++) {
    const a0 = Math.PI / 2 + gap + ((2 * Math.PI - 2 * gap) * i) / steps, a1 = Math.PI / 2 + gap + ((2 * Math.PI - 2 * gap) * (i + 1)) / steps;
    b.log(around(a0, 0.18, y), around(a1, 0.18, y), 0.017, 0.017, { sides: 5, rings: 2, bark: [linear(SILVER), linear(SILVER_DARK), linear(0xdfe5ec)], cap: linear(SILVER), capStart: i === 0, capEnd: i === steps - 1 });
  }
  for (const s of [-1, 1]) b.rock(around(Math.PI / 2 + s * gap, 0.185, y), 0.032, new Vector3(1, 1, 0.9), { segments: 5, jitter: 0.08, seed: 200 + s, colors: MOONSTONE.map(linear), top: linear(0xf4f8ff) });
  b.rock(around(-Math.PI / 2, 0.185, y), 0.025, new Vector3(1, 0.9, 0.8), { segments: 4, jitter: 0.08, seed: 203, colors: MOONSTONE.map(linear), top: linear(0xf4f8ff) });
  return b.build();
}

const BRASS = [0xc9a04a, 0xa67c2e, 0xe0bd6a], LEATHER = [0x6b4a2e, 0x543820], LENS = 0x8fd7e8;
/** Artisan's Goggles: a leather strap round the head with two brass-rimmed lenses pushed up on the forehead. */
function artisansGoggles(): BufferGeometry {
  const b = new LowPolyBuilder();
  const y = HEAD_TOP - 0.13;
  b.log(new Vector3(0, y, 0), new Vector3(0, y + 0.035, 0), 0.218, 0.218, { sides: 10, rings: 2, bark: LEATHER.map(linear), cap: linear(LEATHER[0]), capStart: false, capEnd: false });
  for (const s of [-1, 1]) {
    const back = new Vector3(s * 0.075, y + 0.03, 0.185), front = new Vector3(s * 0.08, y + 0.045, 0.255);
    b.log(back, front, 0.05, 0.052, { sides: 8, rings: 2, bark: BRASS.map(linear), cap: linear(BRASS[1]), capEnd: false });
    b.log(front.clone().lerp(back, 0.25), front.clone().add(new Vector3(0, 0.002, 0.006)), 0.038, 0.038, { sides: 8, rings: 2, bark: [linear(BRASS[2])], cap: linear(LENS), capStart: false });
  }
  b.log(new Vector3(-0.03, y + 0.04, 0.24), new Vector3(0.03, y + 0.04, 0.24), 0.012, 0.012, { sides: 4, rings: 2, bark: BRASS.map(linear), cap: linear(BRASS[1]) });
  return b.build();
}

const VINE = [0x5b3a7a, 0x4a2e66, 0x6e4a8e], PLUM = [0x8e5bd0, 0x6a3fa8, 0xa47be0], VINE_LEAF = [0x6c9a4a, 0x4f7a36];
/** Dreamvine Crown: a twisting purple vine with leaves and dangling dreamplums. */
function dreamvineCrown(): BufferGeometry {
  const b = new LowPolyBuilder();
  const y = HEAD_TOP - 0.08, steps = 10;
  const pts = Array.from({ length: steps }, (_, i) => around((2 * Math.PI * i) / steps, 0.215 + (i % 2) * 0.01, y + (i % 2 ? 0.03 : -0.005)));
  pts.forEach((p, i) => b.log(p, pts[(i + 1) % steps], 0.018, 0.018, { sides: 4, rings: 2, bark: VINE.map(linear), cap: linear(VINE[0]), capStart: false, capEnd: false }));
  [0.4, 1.2, 2.0, 2.8, 3.8, 4.6, 5.5].forEach((a, i) => {
    const base = around(a, 0.225, y + 0.02), n = around(a, 1, 0);
    leaf(b, base, base.clone().addScaledVector(n, 0.03).addScaledVector(Y, 0.07), new Vector3(-n.z, 0, n.x), 0.025, VINE_LEAF[0], VINE_LEAF[1]);
  });
  [Math.PI / 2, Math.PI / 2 + 0.9, Math.PI / 2 - 0.9, Math.PI + 1.0, -0.15].forEach((a, i) =>
    b.rock(around(a, 0.235, y - 0.03), i === 0 ? 0.04 : 0.032, new Vector3(1, 1.1, 1), { segments: 5, jitter: 0.1, seed: 221 + i, colors: PLUM.map(linear), top: linear(0x4f7a36) }));
  return b.build();
}

const STAR_IRON = [0x3b4560, 0x5e6e8f, 0x2c3448], STARGLOW = [0xfff2a8, 0xfffbe0, 0xffe27a];
/** Starfall Diadem: a dark star-iron band rising to a peak on the brow, set with a glowing star. */
function starfallDiadem(): BufferGeometry {
  const b = new LowPolyBuilder();
  const y = HEAD_TOP - 0.11;
  b.log(new Vector3(0, y, 0), new Vector3(0, y + 0.03, 0), 0.218, 0.216, { sides: 10, rings: 2, bark: STAR_IRON.map(linear), cap: linear(STAR_IRON[0]), capStart: false, capEnd: false });
  for (const s of [-1, 1]) b.log(new Vector3(s * 0.1, y + 0.02, 0.195), new Vector3(s * 0.012, y + 0.1, 0.225), 0.018, 0.012, { sides: 4, rings: 2, bark: STAR_IRON.map(linear), cap: linear(STAR_IRON[1]), capStart: false });
  star(b, new Vector3(0, y + 0.08, 0.235), X, Y, Z, 0.06, 0.026, 0.025, STARGLOW);
  for (const s of [-1, 1]) {
    const a = Math.PI / 2 + s * 0.85, n = around(a, 1, 0);
    star(b, around(a, 0.225, y + 0.02), new Vector3(-n.z, 0, n.x), Y, n, 0.024, 0.01, 0.01, STARGLOW, 4);
  }
  return b.build();
}

const GOLD = [0xd4a526, 0xf6d86b, 0xa87d18];
/** Master's Laurel: a gold laurel wreath, two leafy branches meeting at the brow. */
function mastersLaurel(): BufferGeometry {
  const b = new LowPolyBuilder();
  const y = HEAD_TOP - 0.1;
  b.log(new Vector3(0, y, 0), new Vector3(0, y + 0.015, 0), 0.214, 0.214, { sides: 10, rings: 2, bark: [linear(GOLD[2]), linear(GOLD[0])], cap: linear(GOLD[2]), capStart: false, capEnd: false });
  for (const s of [-1, 1]) for (let i = 0; i < 8; i++) {
    // From the back (angle -PI/2) round to just short of the front, leaves pointing forward.
    const a = -Math.PI / 2 + s * (0.25 + i * 0.33), r = 0.222;
    const base = around(a, r, y + 0.008), tangent = new Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(-s), n = around(a, 1, 0);
    for (const up of [-1, 1]) {
      const tip = base.clone().addScaledVector(tangent, 0.06).addScaledVector(Y, up * 0.035).addScaledVector(n, 0.012);
      const side = new Vector3().crossVectors(tip.clone().sub(base), n).normalize();
      leaf(b, base, tip, side, 0.014, GOLD[1], up > 0 ? GOLD[0] : GOLD[2]);
    }
  }
  return b.build();
}

const PEARL = [0xf2eee4, 0xe7e1f0, 0xfaf6ee];
/** Pearl Strand: a draped string of pearls, the largest at the front. */
function pearlStrand(): BufferGeometry {
  const b = new LowPolyBuilder();
  const count = 11;
  for (let i = 0; i < count; i++) {
    const t = (2 * Math.PI * i) / count, a = Math.PI / 2 + t, front = Math.max(0, Math.cos(t));
    b.rock(around(a, 0.18 + 0.015 * front, 0.005 - 0.07 * front * front), i === 0 ? 0.038 : 0.03, new Vector3(1, 1, 1), { segments: 5, jitter: 0, seed: 250 + i, colors: PEARL.map(linear), top: linear(0xffffff) });
  }
  return b.build();
}

const AMBER = [0xe59a2c, 0xf4b84a, 0xc87418], AMBER_GLOW = 0xffd27a;
/** Amber Amulet: a leather cord with a gold-capped amber drop. */
function amberAmulet(): BufferGeometry {
  const b = new LowPolyBuilder();
  collar(b, [CORD]);
  b.log(new Vector3(0, 0, 0.175), new Vector3(0, -0.06, 0.2), 0.01, 0.01, { sides: 5, rings: 2, bark: [linear(CORD)], cap: linear(CORD) });
  b.rock(new Vector3(0, -0.07, 0.205), 0.022, new Vector3(1, 0.8, 0.8), { segments: 4, seed: 261, colors: GOLD.map(linear) });
  b.rock(new Vector3(0, -0.135, 0.212), 0.06, new Vector3(0.75, 1.1, 0.5), { segments: 6, jitter: 0.08, seed: 262, colors: AMBER.map(linear), top: linear(AMBER_GLOW) });
  b.rock(new Vector3(0, -0.13, 0.232), 0.018, new Vector3(1, 1.3, 0.5), { segments: 4, seed: 263, colors: [linear(AMBER_GLOW)] });
  return b.build();
}

const HELM = [0x4a5878, 0x5e6e8f, 0x3a4560], HELM_SHINE = 0x8a9cc0;
/** Star Iron Helm: a small dark blue-grey dome helm with a rim, a nose guard, a crest and a star stud. */
function starIronHelm(): BufferGeometry {
  const b = new LowPolyBuilder();
  const base = BRIM_Y - 0.04;
  b.log(new Vector3(0, base, 0), new Vector3(0, HEAD_TOP + 0.02, 0), 0.232, 0.2, { sides: 10, rings: 3, bark: HELM.map(linear), cap: linear(HELM[1]), capStart: false, capEnd: false });
  b.rock(new Vector3(0, HEAD_TOP + 0.02, 0), 0.2, new Vector3(1, 0.55, 1), { segments: 10, jitter: 0.02, seed: 271, colors: HELM.map(linear), top: linear(HELM_SHINE) });
  b.log(new Vector3(0, base - 0.01, 0), new Vector3(0, base + 0.025, 0), 0.245, 0.245, { sides: 10, rings: 2, bark: [linear(HELM_SHINE), linear(HELM[0])], cap: linear(HELM[2]), capStart: false, capEnd: false });
  b.log(new Vector3(0, base + 0.01, 0.245), new Vector3(0, base - 0.07, 0.25), 0.022, 0.016, { sides: 4, rings: 2, bark: HELM.map(linear), cap: linear(HELM_SHINE) });
  b.log(new Vector3(0, HEAD_TOP + 0.1, 0.13), new Vector3(0, HEAD_TOP + 0.1, -0.16), 0.03, 0.02, { sides: 3, rings: 2, bark: [linear(HELM_SHINE), linear(HELM[2])], cap: linear(HELM[0]) });
  star(b, new Vector3(0, base + 0.07, 0.235), X, Y, Z, 0.03, 0.013, 0.012, STARGLOW);
  return b.build();
}

const MEDAL = [0xc99a3a, 0x8f6a28, 0xe2bb5c], MEDAL_FACE = 0x2f7f8f, COMPASS = 0xf2e6c8, NORTH = 0xd04a3a;
/** Tidewright's Medallion: a heavy gold chain and a big sea-blue medallion with a compass rose. */
function tidewrightsMedallion(): BufferGeometry {
  const b = new LowPolyBuilder();
  collar(b, MEDAL, 0.178);
  const c = new Vector3(0, -0.13, 0.2);
  b.log(new Vector3(0, 0, 0.178), new Vector3(0, -0.045, 0.198), 0.012, 0.012, { sides: 4, rings: 2, bark: MEDAL.map(linear), cap: linear(MEDAL[1]) });
  b.log(c.clone().setZ(0.185), c.clone().setZ(0.215), 0.088, 0.088, { sides: 12, rings: 2, bark: MEDAL.map(linear), cap: linear(MEDAL[2]) });
  b.log(c.clone().setZ(0.214), c.clone().setZ(0.219), 0.072, 0.072, { sides: 12, rings: 2, bark: [linear(MEDAL_FACE)], cap: linear(MEDAL_FACE), capStart: false });
  // Compass rose: four long points (north in red) and four short ones, slightly proud of the face.
  const face = c.clone().setZ(0.222), hub = c.clone().setZ(0.226);
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 2 - (Math.PI * i) / 4, r = i % 2 ? 0.035 : 0.064, w = i % 2 ? 0.01 : 0.016;
    const tip = face.clone().add(new Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    const l = face.clone().add(new Vector3(Math.cos(a + Math.PI / 2) * w, Math.sin(a + Math.PI / 2) * w, 0));
    const rt = face.clone().add(new Vector3(Math.cos(a - Math.PI / 2) * w, Math.sin(a - Math.PI / 2) * w, 0));
    b.triangle(hub, l, tip, linear(i === 0 ? NORTH : COMPASS));
    b.triangle(hub, tip, rt, linear(i === 0 ? 0xa83a2e : 0xd8c9a4));
  }
  b.rock(hub, 0.012, new Vector3(1, 1, 0.5), { segments: 4, seed: 281, colors: MEDAL.map(linear) });
  return b.build();
}

/** Skill colours for the Paragon Sash: Foraging green, Beachcombing blue, Crafting amber. */
const PARAGON = [0x4f9a4a, 0x3f7fc0, 0xe0a030], PARAGON_EDGE = 0xf3ead2;
/** Paragon Sash: a cream-edged sash from shoulder to hip, striped in the three skills' colours, with a gold star at the shoulder. */
function paragonSash(): BufferGeometry {
  const b = new LowPolyBuilder();
  // Path over the chest from the right shoulder (-x) to the left hip, and back round behind.
  const front = [new Vector3(-0.17, 0.03, 0), new Vector3(-0.15, 0.0, 0.08), new Vector3(-0.1, -0.08, 0.17), new Vector3(-0.03, -0.17, 0.2), new Vector3(0.05, -0.26, 0.2), new Vector3(0.13, -0.35, 0.17), new Vector3(0.19, -0.42, 0.1)];
  const back = front.map((p) => new Vector3(p.x, p.y, -p.z * 0.9));
  const width = 0.075, bands = [PARAGON_EDGE, ...PARAGON, PARAGON_EDGE], edges = [0, 0.1, 0.4, 0.7, 1];
  const strip = (path: Vector3[], outward: number) => {
    for (let i = 0; i < path.length - 1; i++) {
      const p = path[i], q = path[i + 1];
      // Across the sash: perpendicular to its run, in the body's surface.
      const across = new Vector3(q.y - p.y, -(q.x - p.x), 0).normalize().multiplyScalar(width);
      for (let k = 0; k < bands.length - 1; k++) {
        const o0 = edges[k] - 0.5, o1 = edges[k + 1] - 0.5;
        const a = p.clone().addScaledVector(across, o0), bb = p.clone().addScaledVector(across, o1);
        const c = q.clone().addScaledVector(across, o1), d = q.clone().addScaledVector(across, o0);
        const col = linear(bands[k]);
        if (outward > 0) { b.triangle(a, bb, c, col); b.triangle(a, c, d, col); } else { b.triangle(a, c, bb, col); b.triangle(a, d, c, col); }
      }
    }
  };
  for (const side of [1, -1]) { strip(front, side); strip(back, side); }
  star(b, new Vector3(-0.1, -0.08, 0.185), X, Y, new Vector3(0, 0.3, 1).normalize(), 0.035, 0.015, 0.012, GOLD);
  return b.build();
}

const BUILDERS: Record<number, () => BufferGeometry> = {
  [Cosmetic.StrawHat]: strawHat,
  [Cosmetic.CoastScarf]: coastScarf,
  [Cosmetic.FlowerCrown]: flowerCrown,
  [Cosmetic.ShellNecklace]: shellNecklace,
  [Cosmetic.DriftwoodCrown]: driftwoodCrown,
  [Cosmetic.WovenSash]: wovenSash,
  [Cosmetic.WelcomedRibbon]: welcomedRibbon,
  [Cosmetic.MentorPin]: mentorPin(0xb07a3e, 0xd9a46a),
  [Cosmetic.MentorPinSilver]: mentorPin(0xa9b1bb, 0xe4e8ee),
  [Cosmetic.MentorPinGold]: mentorPin(0xd4a526, 0xf6d86b),
  [Cosmetic.GiantsTooth]: giantsTooth,
  [Cosmetic.BerryHeart]: berryHeart,
  [Cosmetic.ClatterhornHorn]: clatterhornHorn,
  [Cosmetic.PrismCrown]: prismCrown,
  [Cosmetic.ShardPendant]: shardPendant,
  [Cosmetic.ShardCirclet]: shardCirclet,
  [Cosmetic.GlowcapCap]: glowcapCap,
  [Cosmetic.CoralCirclet]: coralCirclet,
  [Cosmetic.ArtisansKerchief]: artisansKerchief,
  [Cosmetic.StarpetalGarland]: starpetalGarland,
  [Cosmetic.MoonstoneTorc]: moonstoneTorc,
  [Cosmetic.ArtisansGoggles]: artisansGoggles,
  [Cosmetic.DreamvineCrown]: dreamvineCrown,
  [Cosmetic.StarfallDiadem]: starfallDiadem,
  [Cosmetic.MastersLaurel]: mastersLaurel,
  [Cosmetic.PearlStrand]: pearlStrand,
  [Cosmetic.AmberAmulet]: amberAmulet,
  [Cosmetic.StarIronHelm]: starIronHelm,
  [Cosmetic.TidewrightsMedallion]: tidewrightsMedallion,
  [Cosmetic.ParagonSash]: paragonSash,
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
