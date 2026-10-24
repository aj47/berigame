import React from 'react';
import type { BufferGeometry, Color } from 'three';
import { Box3, Float32BufferAttribute, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import { TIER_NODES, tierNode } from '@sim';
import { LowPolyBuilder, linear, seeded } from './lowPoly';

/**
 * The Long Season's ten tiered gathering nodes (season.ts TIER_NODES), one
 * low-poly builder per kind in the style of ObsidianOutcrop and TideRock:
 * flat-shaded vertex colours baked into one geometry per kind and state, so a
 * node is one draw. Glowing parts (glowcaps, starpetals, moonstone, the star
 * core) carry a per-vertex `glow` weight that the shared season material adds
 * as emission, still in that one draw. Higher tiers are a touch larger and glowier.
 */

const L = linear;
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** LowPolyBuilder plus a per-vertex glow weight and local transforms for tilted parts. */
class SeasonBuilder extends LowPolyBuilder {
  glow: number[] = [];
  private level = 0;

  triangle(a: Vector3, b: Vector3, c: Vector3, color: Color) {
    super.triangle(a, b, c, color);
    this.glow.push(this.level, this.level, this.level);
  }

  /** Everything built inside `fn` emits its own colour at `level` (0..1). */
  glowing(level: number, fn: () => void) {
    const prev = this.level;
    this.level = level;
    fn();
    this.level = prev;
  }

  /** Everything built inside `fn` is moved by `m` (nest for hinge-then-place). */
  transformed(m: Matrix4, fn: () => void) {
    const start = this.positions.length;
    fn();
    const v = new Vector3();
    for (let i = start; i < this.positions.length; i += 3) {
      v.set(this.positions[i], this.positions[i + 1], this.positions[i + 2]).applyMatrix4(m);
      this.positions[i] = v.x; this.positions[i + 1] = v.y; this.positions[i + 2] = v.z;
    }
  }

  /** A double-sided flat leaf (diamond) from `base` to `tip`. 4 tris. */
  leaf(base: Vector3, tip: Vector3, width: number, top: Color, under: Color) {
    const dir = tip.clone().sub(base);
    const side = new Vector3(-dir.z, 0, dir.x);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize().multiplyScalar(width / 2);
    const mid = base.clone().lerp(tip, 0.45).add(V(0, 0.03, 0));
    const l = mid.clone().add(side), r = mid.clone().sub(side);
    this.triangle(base, l, tip, top); this.triangle(base, tip, r, top);
    this.triangle(base, tip, l, under); this.triangle(base, r, tip, under);
  }

  /** A double-sided star (or flower) in the XZ plane at the origin, centre raised by `lift`. 4*points tris. */
  star(points: number, outer: number, inner: number, lift: number, top: Color, tips: Color, under: Color) {
    const c = V(0, lift, 0), cu = V(0, -0.02, 0);
    const p = (i: number) => {
      const a = (Math.PI * i) / points, r = i % 2 ? inner : outer;
      return V(Math.cos(a) * r, 0, Math.sin(a) * r);
    };
    for (let i = 0; i < points * 2; i++) {
      const a = p(i), b = p(i + 1);
      this.triangle(c, b, a, i % 2 ? top : tips);
      this.triangle(cu, a, b, under);
    }
  }

  build(): BufferGeometry {
    const g = super.build();
    g.setAttribute('glow', new Float32BufferAttribute(this.glow, 1));
    return g;
  }
}

const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeRotationY(ry)).multiply(new Matrix4().makeRotationX(rx)).multiply(new Matrix4().makeRotationZ(rz));

const BARK = [0x6b4a2e, 0x5a3d26, 0x7a573a].map(L), BARK_RING = L(0xb08a5a);
const LEAF = [0x5f9a3e, 0x4d8434, 0x6aa646].map(L), LEAF_TOP = L(0x7fb853), LEAF_UNDER = L(0x3f6e2c);
const SAND = [0xc8b48c, 0xb39e78].map(L), SAND_TOP = L(0xd6c49e);

// ---- Tier 1 ---------------------------------------------------------------

/** A papery wild hive hanging from a branch of an old stump; bees while it is full. */
function honeyHive(b: SeasonBuilder, ripe: boolean) {
  b.log(V(0, -0.02, 0), V(0, 0.6, 0), 0.3, 0.26, { sides: 7, rings: 2, seed: 1, bark: BARK, cap: BARK_RING, capStart: false });
  b.log(V(0.05, 0.5, 0.05), V(0.55, 1.05, 0.2), 0.08, 0.05, { sides: 5, rings: 3, wobble: 0.03, seed: 2, bark: BARK, cap: BARK_RING, capStart: false });
  b.log(V(-0.1, 0.55, -0.05), V(-0.3, 0.85, -0.15), 0.06, 0.03, { sides: 4, rings: 2, seed: 3, bark: BARK, cap: BARK_RING, capStart: false });
  const hive = ripe ? [0xe8b23a, 0xc98f22, 0xf2c95a].map(L) : [0xb9a98a, 0x9c8d72].map(L);
  b.glowing(ripe ? 0.06 : 0, () => b.rock(V(0.45, 0.66, 0.17), ripe ? 0.27 : 0.21, V(1, 1.35, 1), { segments: 7, seed: 4, jitter: 0.12, colors: hive, top: L(0x8a6a2a) }));
  // The entrance, facing the camera.
  b.rock(V(0.5, 0.6, ripe ? 0.42 : 0.36), 0.06, V(1, 0.8, 0.4), { segments: 4, seed: 5, colors: [L(0x2a1d10)] });
  if (ripe) {
    b.glowing(0.2, () => b.rock(V(0.45, 0.27, 0.17), 0.05, V(1, 1.6, 1), { segments: 4, seed: 6, colors: [L(0xf2b630)] }));
    [[0.85, 0.85, 0.35], [0.15, 1.05, 0.45], [0.75, 0.45, 0.5]].forEach(([x, y, z], i) =>
      b.rock(V(x, y, z), 0.04, V(1.3, 0.9, 1), { segments: 3, seed: 7 + i, jitter: 0, colors: [L(0x2a2216), L(0xf2c23a)] }));
  }
  b.rock(V(-0.3, 0.02, 0.22), 0.13, V(1.3, 0.4, 1), { segments: 5, seed: 12, colors: LEAF });
}

/** A shallow mound of oysters; open with a pearl showing while ripe, shut tight while they settle. */
function oysterBed(b: SeasonBuilder, ripe: boolean) {
  b.rock(V(0, 0.02, 0), 0.6, V(1.35, 0.22, 1.1), { segments: 8, seed: 20, colors: [L(0x8f8670), L(0x7a725e)], top: L(0xa39a82) });
  const shell = [0x8a8478, 0x6e695f, 0x9d978a].map(L), inside = L(0xe9e4d6);
  const oysters: [number, number, number, number][] = [[0.05, 0.1, 0.12, 0.3], [0.42, 0.06, 0.05, 1.6], [-0.38, 0.05, 0.2, 2.6], [0.2, 0.04, -0.35, 4.2], [-0.25, 0.06, -0.3, 5.3]];
  oysters.forEach(([x, y, z, ry], i) => b.transformed(at(x, y + 0.04, z, 0, ry), () => {
    b.rock(V(0, 0, 0), 0.16, V(1.2, 0.32, 0.9), { segments: 5, seed: 30 + i, colors: shell, top: inside });
    // Lid hinged at its back edge (-x), swung open while ripe.
    b.transformed(new Matrix4().makeTranslation(-0.17, 0.03, 0).multiply(new Matrix4().makeRotationZ(ripe ? 0.85 : 0)).multiply(new Matrix4().makeTranslation(0.17, 0, 0)), () =>
      b.rock(V(0, ripe ? 0.02 : 0.04, 0), 0.15, V(1.2, 0.26, 0.9), { segments: 5, seed: 40 + i, colors: shell, top: L(0x7d776b) }));
    if (ripe) b.glowing(0.25, () => b.rock(V(0.02, 0.07, 0), 0.055, V(1, 1, 1), { segments: 3, seed: 50 + i, jitter: 0, colors: [L(0xfaf6ee), L(0xe2dccd)] }));
  }));
  b.rock(V(0.55, 0.02, -0.15), 0.1, V(1.2, 0.5, 1), { segments: 4, seed: 60, colors: [L(0x4f6e3e)] });
}

// ---- Tier 2 ---------------------------------------------------------------

/** A fairy ring of teal glowcaps on moss; only nubs while they sprout. */
function glowcapRing(b: SeasonBuilder, ripe: boolean) {
  b.rock(V(0, 0, 0), 0.62, V(1.3, 0.12, 1.3), { segments: 8, seed: 70, colors: [L(0x4f7a3a), L(0x5d8a44)], top: L(0x66944a) });
  const stem = [L(0xe6e0cc), L(0xcfc8b2)];
  const cap = ripe ? [L(0x6fd0c0), L(0x52b8a8)] : [L(0x5f8a84), L(0x4f7570)];
  const capTop = ripe ? L(0xa8f0e4) : L(0x6f9a94);
  const rand = seeded(71);
  for (let i = 0; i < 7; i++) {
    const a = (2 * Math.PI * i) / 7, r = 0.52 + (rand() - 0.5) * 0.12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = (0.22 + rand() * 0.22) * (ripe ? 1 : 0.35), cr = (0.13 + rand() * 0.06) * (ripe ? 1 : 0.5);
    b.log(V(x, 0.02, z), V(x, 0.04 + h, z), 0.035, 0.03, { sides: 5, rings: 2, seed: 72 + i, bark: stem, cap: stem[0], capStart: false, capEnd: false });
    b.glowing(ripe ? 0.55 : 0.04, () => b.rock(V(x, 0.04 + h, z), cr, V(1, 0.5, 1), { segments: 6, seed: 80 + i, jitter: 0.1, colors: cap, top: capTop }));
  }
}

/** A sandstone shelf crowded with branching coral and a fan; bleached stubs while it regrows. */
function coralShelf(b: SeasonBuilder, ripe: boolean) {
  b.rock(V(0, 0.12, 0), 0.55, V(1.3, 0.4, 1), { segments: 8, seed: 90, colors: SAND, top: SAND_TOP });
  b.rock(V(-0.5, 0.06, 0.35), 0.2, V(1, 0.6, 1), { segments: 5, seed: 91, colors: SAND, top: SAND_TOP });
  const palettes = ripe
    ? [[0xf06c6c, 0xd85656], [0xff8a7a, 0xe86e60], [0xe0507a, 0xc63e66], [0xf59a5a, 0xdd8044]]
    : [[0xe8dccb, 0xd6c9b4], [0xefe4d4, 0xdacdb8]];
  const tip = ripe ? L(0xffc2b0) : L(0xf4ece0);
  const clusters: [number, number, number][] = [[0.1, 0.05, 0.75], [0.4, -0.1, 0.55], [-0.3, -0.05, 0.6], [-0.05, 0.3, 0.5]];
  const scale = ripe ? 1 : 0.35;
  clusters.forEach(([x, z, h], i) => {
    const bark = palettes[i % palettes.length].map(L);
    const base = V(x, 0.3, z), top = V(x + 0.05, 0.3 + h * scale, z + 0.04);
    b.glowing(ripe ? 0.1 : 0, () => {
      b.log(base, top, 0.06, 0.03, { sides: 4, rings: 3, wobble: 0.04, seed: 100 + i, bark, cap: tip, capStart: false });
      for (const s of [-1, 1]) {
        const from = base.clone().lerp(top, 0.45);
        b.log(from, from.clone().add(V(0.16 * s, 0.22 * scale, 0.08 * s * (i % 2 ? 1 : -1))), 0.035, 0.02, { sides: 4, rings: 2, seed: 110 + i * 2 + s, bark, cap: tip, capStart: false });
      }
    });
  });
  // A fan coral standing on the camera side.
  if (ripe) b.transformed(at(0.2, 0.32, 0.32, Math.PI / 2 - 0.2, 0.4), () =>
    b.star(4, 0.26, 0.2, 0, L(0xb84a8a), L(0xd06aa0), L(0x9a3c74)));
}

// ---- Tier 3 ---------------------------------------------------------------

/** A small sunpeach tree: crooked trunk, round canopy, fruit on the camera side. */
function sunpeachTree(b: SeasonBuilder, ripe: boolean) {
  b.log(V(0, -0.02, 0), V(0.05, 0.95, 0.02), 0.12, 0.08, { sides: 6, rings: 3, wobble: 0.05, seed: 120, bark: BARK, cap: BARK_RING, capStart: false });
  b.log(V(0.03, 0.7, 0.01), V(0.32, 1.0, 0.22), 0.05, 0.03, { sides: 4, rings: 2, seed: 121, bark: BARK, cap: BARK_RING, capStart: false });
  b.log(V(0.03, 0.75, 0.01), V(-0.3, 1.02, -0.1), 0.05, 0.03, { sides: 4, rings: 2, seed: 122, bark: BARK, cap: BARK_RING, capStart: false });
  b.rock(V(0.02, 1.25, 0), 0.5, V(1.1, 0.8, 1.1), { segments: 7, seed: 123, colors: LEAF, top: LEAF_TOP });
  b.rock(V(0.32, 1.08, 0.25), 0.33, V(1, 0.85, 1), { segments: 7, seed: 124, colors: LEAF, top: LEAF_TOP });
  b.rock(V(-0.3, 1.12, -0.12), 0.33, V(1, 0.85, 1), { segments: 7, seed: 125, colors: LEAF, top: LEAF_TOP });
  const fruit: [number, number, number][] = [[0.25, 1.0, 0.52], [0.55, 1.12, 0.3], [-0.05, 1.05, 0.55], [0.0, 1.45, 0.42], [-0.45, 1.05, 0.15], [0.42, 1.38, 0.2], [-0.3, 1.32, 0.3]];
  const peach = [L(0xf49a5b), L(0xe86f3c), L(0xf7b77a)];
  (ripe ? fruit : fruit.slice(0, 4)).forEach(([x, y, z], i) => {
    if (ripe) b.glowing(0.1, () => b.rock(V(x, y, z), 0.085, V(1, 1, 1), { segments: 4, seed: 130 + i, jitter: 0.1, colors: peach, top: L(0xe0603a) }));
    else b.rock(V(x, y, z), 0.04, V(1, 1, 1), { segments: 3, seed: 130 + i, jitter: 0, colors: [L(0x9fbf5a)] });
  });
  b.rock(V(0.18, 0.02, 0.15), 0.12, V(1.4, 0.35, 1), { segments: 5, seed: 140, colors: LEAF });
}

/** Where the bluff stone is cut by a vein of golden amber; a dark resin line while it hardens. */
function amberSeam(b: SeasonBuilder, ripe: boolean) {
  const stone = [0x8a7a66, 0x75664f, 0x806f5a].map(L);
  const centre = V(0, 0.4, 0), r = 0.55, sc = V(1.1, 0.85, 0.9);
  b.rock(centre, r, sc, { segments: 8, seed: 150, jitter: 0.12, colors: stone, top: L(0x9d8c74) });
  b.rock(V(0.5, 0.1, -0.3), 0.2, V(1, 0.7, 1), { segments: 5, seed: 151, colors: stone, top: L(0x9d8c74) });
  // Blobs on the +z face of the hull ellipsoid along a rising diagonal.
  const ax = r * sc.x * 0.9, ay = r * sc.y * 0.9, az = r * sc.z * 0.9;
  for (let i = 0; i < 6; i++) {
    const t = i / 5, x = -0.38 + 0.76 * t, y = centre.y - 0.2 + 0.36 * t + (i % 2 ? 0.04 : -0.03);
    const z = az * Math.sqrt(Math.max(0.05, 1 - (x / ax) ** 2 - ((y - centre.y) / ay) ** 2));
    const size = (i % 3 === 1 ? 0.11 : 0.08) * (ripe ? 1 : 0.55);
    if (ripe) b.glowing(0.35, () => b.rock(V(x, y, z), size, V(1, 0.85, 0.7), { segments: 5, seed: 160 + i, jitter: 0.3, colors: [L(0xe59a2c), L(0xf5b850), L(0xd0821c)], top: L(0xffd27a) }));
    else b.rock(V(x, y, z - 0.02), size, V(1.3, 0.5, 0.4), { segments: 5, seed: 160 + i, colors: [L(0x7a4e1c), L(0x6a4218)] });
  }
}

// ---- Tier 4 ---------------------------------------------------------------

/** A tall star-shaped glowing flower with two smaller stars; a shut bud while it reblooms. */
function starblossom(b: SeasonBuilder, ripe: boolean) {
  for (let i = 0; i < 6; i++) {
    const a = (2 * Math.PI * i) / 6 + 0.3;
    b.leaf(V(0, 0.02, 0), V(Math.cos(a) * 0.5, 0.06, Math.sin(a) * 0.5), 0.18, LEAF_TOP, LEAF_UNDER);
  }
  const stemBark = [L(0x5f9a3e), L(0x4d8434)];
  const heads: [Vector3, number][] = [[V(0, 0.95, 0.05), 0.42], [V(0.38, 0.6, 0.18), 0.22], [V(-0.32, 0.52, 0.25), 0.2]];
  heads.forEach(([p, size], i) => {
    b.log(V(p.x * 0.3, 0.02, p.z * 0.3), p, 0.035, 0.025, { sides: 4, rings: 3, wobble: 0.03, seed: 170 + i, bark: stemBark, cap: stemBark[0], capStart: false, capEnd: false });
    if (ripe) b.transformed(at(p.x, p.y, p.z, 0.45, i * 0.7), () => {
      b.glowing(0.7, () => b.star(5, size, size * 0.42, 0.06, L(0xf3e08e), L(0xfff3c0), L(0xc9b45e)));
      b.glowing(1, () => b.transformed(at(0, 0.04, 0, 0, Math.PI / 5), () => b.star(5, size * 0.45, size * 0.2, 0.04, L(0xfff8dc), L(0xffffff), L(0xe8d98a))));
    });
    else b.rock(p.clone().add(V(0, 0.06, 0)), size * 0.3, V(0.8, 1.5, 0.8), { segments: 5, seed: 180 + i, colors: [L(0xb9c46a), L(0x8faa4c)], top: L(0xe4dc8a) });
  });
  if (ripe) [[0.25, 1.25, 0.3], [-0.3, 1.05, 0.1], [0.5, 0.95, -0.1], [-0.1, 0.75, 0.5]].forEach(([x, y, z], i) =>
    b.glowing(1, () => b.rock(V(x, y, z), 0.03, V(1, 1, 1), { segments: 3, seed: 190 + i, jitter: 0, colors: [L(0xfff3c0)] })));
}

/** Dark shore rock split by a vein of pale moonstone crystals; dull stubs while they glint again. */
function moonstoneVein(b: SeasonBuilder, ripe: boolean) {
  const rock = [0x4a5266, 0x3c4356, 0x525b70].map(L);
  b.rock(V(0, 0.35, 0), 0.58, V(1.15, 0.75, 0.95), { segments: 8, seed: 200, jitter: 0.15, colors: rock, top: L(0x5b6478) });
  b.rock(V(-0.55, 0.1, 0.3), 0.22, V(1, 0.7, 1), { segments: 5, seed: 201, colors: rock, top: L(0x5b6478) });
  const crystal = ripe ? [0xafc8f0, 0xd8e6fb, 0x9bb4e0].map(L) : [0x7f8ca8, 0x6c7894].map(L);
  const tipC = ripe ? L(0xf2f7ff) : L(0x8e9ab4);
  const shards: [number, number, number, number, number, number][] = [
    // x, y, z, height, radius, lean (x)
    [-0.35, 0.4, 0.3, 0.45, 0.08, -0.25], [-0.12, 0.52, 0.32, 0.62, 0.1, -0.05], [0.12, 0.6, 0.26, 0.55, 0.09, 0.15],
    [0.32, 0.5, 0.22, 0.4, 0.07, 0.3], [0.02, 0.62, 0.05, 0.7, 0.11, 0.05], [0.42, 0.32, 0.38, 0.3, 0.06, 0.4],
  ];
  b.glowing(ripe ? 0.45 : 0, () => {
    shards.forEach(([x, y, z, h, r, lean], i) => {
      const hh = h * (ripe ? 1 : 0.25);
      b.log(V(x, y, z), V(x + lean * hh, y + hh, z + 0.12 * hh), r, ripe ? 0.01 : r * 0.7, { sides: 5, rings: 2, seed: 210 + i, bark: crystal, cap: tipC, capStart: false });
    });
    // The pale band itself, running down the face.
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      b.rock(V(-0.45 + 0.8 * t, 0.25 + 0.25 * t, 0.42 - 0.05 * Math.abs(t - 0.5)), 0.08, V(1.6, 0.5, 0.5), { segments: 4, seed: 220 + i, colors: crystal });
    }
  });
}

// ---- Tier 5 ---------------------------------------------------------------

/** An old stump with a trellis, wound with a dreamvine hung with glowing purple plums. */
function dreamvine(b: SeasonBuilder, ripe: boolean) {
  b.log(V(0, -0.02, 0), V(0, 0.35, 0), 0.24, 0.21, { sides: 6, rings: 2, seed: 230, bark: BARK, cap: BARK_RING, capStart: false });
  const post = [L(0x8a6a48), L(0x765a3c)];
  for (const x of [-0.5, 0.5]) b.log(V(x, -0.02, -0.08), V(x * 0.95, 1.5, -0.08), 0.045, 0.04, { sides: 4, rings: 2, seed: 231, bark: post, cap: L(0xa0805a), capStart: false });
  for (const y of [0.9, 1.4]) b.log(V(-0.56, y, -0.08), V(0.56, y, -0.08), 0.035, 0.035, { sides: 4, rings: 2, seed: 232, bark: post, cap: L(0xa0805a) });
  const vine = [L(0x4c6a3a), L(0x5a4a6a)];
  const paths: Vector3[][] = [
    [V(0.05, 0.33, 0.05), V(-0.48, 0.95, -0.02)], [V(-0.48, 0.95, -0.02), V(0.5, 1.42, -0.02)], [V(0.1, 0.33, 0.02), V(0.48, 0.92, -0.02)],
  ];
  paths.forEach(([from, to], i) => b.log(from, to, 0.03, 0.02, { sides: 4, rings: 4, wobble: 0.07, seed: 240 + i, bark: vine, cap: vine[0], capStart: false }));
  const leaves: [number, number, number][] = [[-0.3, 0.75, 0.05], [0.25, 0.7, 0.05], [-0.1, 1.15, 0.03], [0.3, 1.3, 0.02], [-0.45, 1.2, 0.0], [0.45, 1.05, 0.02], [0, 0.55, 0.12], [0.15, 1.5, -0.02]];
  leaves.forEach(([x, y, z], i) => b.leaf(V(x, y, z), V(x + (i % 2 ? 0.2 : -0.2), y + 0.06, z + 0.12), 0.14, L(0x5e8a48), L(0x3e5e30)));
  const clusters: [number, number, number][] = [[-0.25, 0.85, 0.1], [0.3, 1.25, 0.08], [0.35, 0.78, 0.1]];
  const plum = [L(0x9a62d6), L(0x7c48b8)];
  clusters.forEach(([x, y, z], c) => {
    const fruit = ripe ? [[0, 0, 0], [0.09, -0.06, 0.02], [-0.07, -0.09, 0.03]] : [[0, -0.02, 0]];
    fruit.forEach(([dx, dy, dz], i) => {
      if (ripe) b.glowing(0.35, () => b.rock(V(x + dx, y - 0.08 + dy, z + dz), 0.075, V(1, 1.1, 1), { segments: 4, seed: 250 + c * 3 + i, jitter: 0.08, colors: plum, top: L(0xc7a0f0) }));
      else b.rock(V(x + dx, y - 0.05 + dy, z + dz), 0.035, V(1, 1, 1), { segments: 3, seed: 250 + c, jitter: 0, colors: [L(0x8fb060)] });
    });
  });
}

/** A scorched crater around a pitted rock split open on a glowing star-iron core; an ember while it cools. */
function fallenStar(b: SeasonBuilder, ripe: boolean) {
  b.rock(V(0, 0, 0), 0.6, V(1.15, 0.08, 1.15), { segments: 7, seed: 260, colors: [L(0x3e3a36), L(0x4a443e)], top: L(0x36322e) });
  for (let i = 0; i < 6; i++) {
    const a = (2 * Math.PI * i) / 6 + 0.25;
    b.rock(V(Math.cos(a) * 0.6, 0.04, Math.sin(a) * 0.6), 0.15, V(1.3, 0.5, 0.9), { segments: 4, seed: 261 + i, colors: [L(0x8c7b62), L(0x6e604c)], top: L(0x9a8a70) });
  }
  b.rock(V(0, 0.3, -0.05), 0.42, V(1.1, 0.85, 1), { segments: 8, seed: 270, jitter: 0.35, colors: [L(0x4a4a52), L(0x3a3a42)], top: L(0x5c5c66) });
  [[-0.22, 0.45, 0.22], [0.3, 0.32, 0.18], [-0.05, 0.6, -0.1]].forEach(([x, y, z], i) =>
    b.rock(V(x, y, z), 0.07, V(1, 0.5, 1), { segments: 4, seed: 280 + i, colors: [L(0x26262c)] }));
  // The core, showing through the split on the camera side.
  const core = ripe ? [L(0xdfe8ff), L(0x9fb6ff)] : [L(0x8a3a20), L(0x6a2a18)];
  b.glowing(ripe ? 1 : 0.3, () => b.rock(V(0.08, 0.36, 0.28), 0.19, V(1, 0.9, 0.7), { segments: 6, seed: 290, jitter: 0.25, colors: core, top: ripe ? L(0xffffff) : L(0xa04a28) }));
  if (ripe) b.glowing(0.6, () => {
    [[0.25, 0.4, 0.3, 0.5], [-0.1, 0.42, 0.3, -0.4], [0.1, 0.55, 0.2, 0.1]].forEach(([x, y, z, lean], i) =>
      b.log(V(x, y, z), V(x + lean * 0.25, y + 0.3, z + 0.08), 0.05, 0.005, { sides: 4, rings: 2, seed: 300 + i, bark: [L(0x7f90b8), L(0xb8c8ee)], cap: L(0xe8f0ff), capStart: false }));
    [[0.45, 0.9, 0.3], [-0.3, 0.85, 0.35], [0.1, 1.05, 0.0]].forEach(([x, y, z], i) =>
      b.glowing(1, () => b.rock(V(x, y, z), 0.03, V(1, 1, 1), { segments: 3, seed: 310 + i, jitter: 0, colors: [L(0xe8f0ff)] })));
  });
}

const BUILDERS: Record<number, (b: SeasonBuilder, ripe: boolean) => void> = {
  4: honeyHive, 5: oysterBed, 6: glowcapRing, 7: coralShelf, 8: sunpeachTree,
  9: amberSeam, 10: starblossom, 11: moonstoneVein, 12: dreamvine, 13: fallenStar,
};

function build(kind: number, ripe: boolean): BufferGeometry {
  const def = tierNode(kind)!;
  const b = new SeasonBuilder();
  BUILDERS[kind](b, ripe);
  // Enlarged like the Coast nodes; each tier a little bigger than the last.
  const s = 1.2 * (1 + 0.05 * (def.tier - 1));
  const g = b.build().scale(s, s, s);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const cache = new Map<string, BufferGeometry>();
/** Shared geometry for a tier kind and state; created on first use, never disposed. Undefined for other kinds. */
export function seasonNodeGeometry(kind: number, ripe: boolean): BufferGeometry | undefined {
  if (!BUILDERS[kind]) return undefined;
  const key = `${kind}:${ripe ? 'ripe' : 'regrowing'}`;
  let g = cache.get(key);
  if (!g) { g = build(kind, ripe); cache.set(key, g); }
  return g;
}

/** Height of the ripe model's top, for the harvest ring and labels. */
export function seasonNodeHeight(kind: number): number {
  const g = seasonNodeGeometry(kind, true);
  if (!g) return 1.3;
  return (g.boundingBox ?? new Box3().setFromBufferAttribute(g.getAttribute('position') as any)).max.y;
}

/** Every kind with a model (for tests). */
export const SEASON_MODEL_KINDS = TIER_NODES.map((d) => d.kind).filter((k) => !!BUILDERS[k]);

let material: MeshStandardMaterial | null = null;
/**
 * The Coast vertex-colour material plus emission from the per-vertex `glow`
 * weight (one shader, shared by every season node). Never dispose per instance.
 */
export function seasonMaterial(): MeshStandardMaterial {
  if (material) return material;
  const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0 });
  m.onBeforeCompile = (shader: { vertexShader: string; fragmentShader: string }) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow;');
  };
  m.customProgramCacheKey = () => 'season-glow';
  return material = m;
}

interface Props {
  kind: number;
  position: [number, number, number];
  ripe?: boolean;
  rotation?: number;
  onClick?: (e: any) => void;
}

const SeasonNode = ({ kind, position, ripe = true, rotation = 0, onClick }: Props) => {
  const geometry = seasonNodeGeometry(kind, ripe);
  if (!geometry) return null;
  return <mesh position={position} rotation={[0, rotation, 0]} geometry={geometry} material={seasonMaterial()} onClick={onClick} dispose={null} />;
};
export default SeasonNode;
