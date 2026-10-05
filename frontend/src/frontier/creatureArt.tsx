import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Euler, IcosahedronGeometry,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, Quaternion, TorusGeometry, Vector3,
} from "three";
import { merged, part } from "../Components/3D/envArt";

/**
 * Creature and companion art. Each species is a small rig of named nodes; every
 * node is one baked, vertex-coloured mesh (plus optional unlit glow and wing
 * slots), so a creature is a handful of draw calls and 30+ stay cheap. Local
 * frame: feet on y = 0, facing +z. Animation is additive over the rest pose and
 * driven only by the caller's smoothed speed (tiles per second).
 */
export type CreatureMotion = { speed: number };

type V3 = [number, number, number];
type Slot = "body" | "glow" | "wing";
type Geo = Partial<Record<Slot, BufferGeometry>>;

const ico = (r: number, detail = r < .045 ? 0 : r >= .2 ? 2 : 1) => new IcosahedronGeometry(r, detail);
const cone = (r: number, h: number, sides = 6) => new ConeGeometry(r, h, sides);
const cyl = (top: number, bottom: number, h: number, sides = 7) => new CylinderGeometry(top, bottom, h, sides);
const UP = new Vector3(0, 1, 0);

class Kit {
  private slots: Record<Slot, BufferGeometry[]> = { body: [], glow: [], wing: [] };
  private seed = 1;
  constructor(private readonly grain = .08) {}
  add(g: BufferGeometry, hex: number, at: V3 = [0, 0, 0], sc: V3 | number = 1, rot: V3 = [0, 0, 0], slot: Slot = "body", jitter = this.grain) {
    const s: V3 = typeof sc === "number" ? [sc, sc, sc] : sc;
    this.slots[slot].push(part(g, hex, at, s, rot, jitter, (this.seed++) * 7919));
    return this;
  }
  ball(hex: number, r: number, at: V3, sc: V3 | number = 1, rot: V3 = [0, 0, 0], slot: Slot = "body", jitter?: number) {
    return this.add(ico(r), hex, at, sc, rot, slot, jitter);
  }
  /** A tapered limb from a to b. */
  seg(hex: number, a: V3, b: V3, r0: number, r1 = r0, slot: Slot = "body", sides = 6) {
    const from = new Vector3(...a), dir = new Vector3(...b).sub(from), len = dir.length();
    const e = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
    const mid = from.addScaledVector(dir, .5);
    return this.add(cyl(r1, r0, len, sides), hex, [mid.x, mid.y, mid.z], 1, [e.x, e.y, e.z], slot);
  }
  /** A chain of tapered segments through points (horns, antennae, whiskers). */
  chain(hex: number, points: V3[], r0: number, r1: number, slot: Slot = "body") {
    for (let i = 1; i < points.length; i++) {
      const t0 = (i - 1) / (points.length - 1), t1 = i / (points.length - 1);
      this.seg(hex, points[i - 1], points[i], r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, slot, 5);
    }
    return this;
  }
  both(fn: (s: number) => void) { fn(1); fn(-1); return this; }
  done(): Geo {
    const out: Geo = {};
    for (const slot of ["body", "glow", "wing"] as Slot[]) if (this.slots[slot].length) out[slot] = merged(this.slots[slot]);
    return out;
  }
}

type NodeSpec = { name: string; parent?: string; at: V3; rot?: V3; build?: (k: Kit) => void; grain?: number };
type Collar = { node: string; at: V3; radius: number; tilt: number; squash?: number };
type Api = {
  t: number; dt: number; ph: number;
  /** 0 idle .. 1 moving, eased. */
  m: number;
  /** Smoothed speed in tiles per second. */
  sp: number;
  /** Advance the gait phase by `hz` cycles per second and return it. */
  step(hz: number): number;
  rot(n: string, x: number, y?: number, z?: number): void;
  move(n: string, x: number, y?: number, z?: number): void;
  scale(n: string, x: number, y?: number, z?: number): void;
  blink(): boolean;
};
type Rig = {
  nodes: (NodeSpec & { geo: Geo })[];
  children: Record<string, string[]>;
  collar: Collar;
  animate: (a: Api) => void;
};

const fract = (v: number) => v - Math.floor(v);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const TAU = Math.PI * 2;
/** A soft pulse that peaks briefly every `period` seconds. */
const every = (t: number, period: number, width = .12) => {
  const p = fract(t / period);
  return p < width ? Math.sin((p / width) * Math.PI) : 0;
};

function rig(nodes: NodeSpec[], collar: Collar, animate: Rig["animate"]): Rig {
  const all = [{ name: "root", at: [0, 0, 0] as V3 }, ...nodes];
  const children: Record<string, string[]> = {};
  const built = all.map(n => {
    const parent = n.name === "root" ? "" : n.parent ?? "root";
    (children[parent] ??= []).push(n.name);
    const kit = new Kit(n.grain);
    n.build?.(kit);
    return { ...n, parent, geo: kit.done() };
  });
  return { nodes: built, children, collar, animate };
}
const sides = (fn: (s: number, side: "L" | "R") => NodeSpec) => [fn(1, "L"), fn(-1, "R")];

/** Shared quadruped gait: diagonal pairs (trot) or front/back pairs (gallop). */
function legs(a: Api, cycle: number, amp: number, gallop = false) {
  const swing = (o: number) => Math.sin(cycle * TAU + o) * amp * a.m;
  a.rot("legFL", swing(0)); a.rot("legBR", swing(gallop ? Math.PI + .5 : 0));
  a.rot("legFR", swing(gallop ? .5 : Math.PI)); a.rot("legBL", swing(gallop ? Math.PI : Math.PI));
}
const eyeBlink = (a: Api) => { if (a.blink()) a.scale("eyes", 1, .12, 1); };

const EYE = 0x231c22, SHINE = 0xffffff;

const burrowbun = () => {
  const FUR = 0xd9bba0, DARK = 0xc29e80, CREAM = 0xf4e8d6, WHITE = 0xfffaf2, PINK = 0xf08f9c, INNER = 0xf3b7bd;
  return rig([
    { name: "body", at: [0, 0, 0], build: k => k
      .ball(FUR, .3, [0, .3, -.04], [1, .92, 1.12])
      .ball(CREAM, .21, [0, .27, .13], [.9, .95, .72])
 },
    // Haunch and long hind foot swing together from the hip; front paws from the shoulder.
    ...sides((s, side) => ({ name: `legB${side}`, parent: "body", at: [s * .16, .22, -.1], build: k => k
      .ball(DARK, .17, [s * .01, -.02, -.04], [.72, .95, 1.2])
      .ball(CREAM, .09, [-s * .01, -.175, .08], [.85, .45, 1.95]) })),
    ...sides((s, side) => ({ name: `legF${side}`, parent: "body", at: [s * .09, .2, .19], build: k => k
      .seg(FUR, [0, 0, 0], [0, -.14, .01], .04, .032)
      .ball(CREAM, .055, [0, -.15, .02], [1, .8, 1.3]) })),
    { name: "tail", parent: "body", at: [0, .33, -.37], grain: .3, build: k => k
      .ball(WHITE, .1, [0, 0, 0], [1, 1, .9])
      .ball(WHITE, .06, [.05, .04, -.03]).ball(WHITE, .06, [-.05, .03, -.02]) },
    { name: "head", parent: "body", at: [0, .6, .16], build: k => k
      .ball(FUR, .23, [0, 0, 0], [1.08, .96, 1])
      .ball(CREAM, .07, [0, -.055, .19])
      .ball(PINK, .03, [0, -.005, .235], [1.35, .9, 1])
      .both(s => k
        .ball(CREAM, .11, [s * .1, -.07, .11], [1, .85, .9])
        .seg(WHITE, [s * .07, -.05, .21], [s * .23, -.02, .2], .004, .003)
        .seg(WHITE, [s * .07, -.065, .21], [s * .22, -.09, .19], .004, .003)) },
    { name: "eyes", parent: "head", at: [0, .035, .172], build: k => k.both(s => k
      .ball(EYE, .064, [s * .115, 0, 0], [.9, 1.1, .8])
      .ball(SHINE, .022, [s * .1, .032, .048], 1, [0, 0, 0], "glow")
      .ball(SHINE, .011, [s * .13, -.02, .05], 1, [0, 0, 0], "glow")) },
    ...sides((s, side) => ({ name: `ear${side}`, parent: "head", at: [s * .085, .16, -.03], rot: [-.18, 0, -s * .16], build: k => k
      .ball(FUR, .1, [0, .21, 0], [.52, 2.1, .3])
      .ball(INNER, .08, [0, .2, .028], [.36, 1.7, .18]) })),
  ], { node: "body", at: [0, .41, .09], radius: .2, tilt: .3 }, a => {
    const m = a.m, c = a.step(1.6 + a.sp * .55), p = fract(c), air = Math.sin(p * Math.PI) * m;
    a.move("root", 0, air * .24);
    a.scale("root", 1 - (air - .5 * m) * .09, 1 + (air - .5 * m) * .18, 1 - (air - .5 * m) * .09);
    a.rot("body", -Math.cos(p * TAU) * .16 * m);
    // Bound: stretched out in the air (front paws reaching, hind feet kicked back), gathered on
    // the ground with the hind feet swung under the body. Front paws touch down a beat early.
    const reach = Math.sin(p * Math.PI), land = Math.sin(fract(p + .1) * Math.PI);
    a.rot("legBL", (reach * 1.05 - .4) * m); a.rot("legBR", (reach * 1.05 - .4) * m);
    a.rot("legFL", (.35 - land * .95) * m); a.rot("legFR", (.35 - land * .95) * m);
    a.rot("earL", -.15 - air * .7, 0, -(Math.sin(a.t * 1.3 + a.ph) ** 24) * .45);
    a.rot("earR", -.15 - air * .7 + every(a.t + a.ph, 4.3) * .25, 0, 0);
    a.rot("tail", air * .4 + Math.sin(a.t * 7) * .08 * (1 - m));
    const breathe = 1 + Math.sin(a.t * 2.2 + a.ph) * .018 * (1 - m);
    a.scale("body", breathe, breathe, 1);
    const sniff = every(a.t + a.ph, 3.1, .3);
    a.rot("head", Math.sin(a.t * 18) * .025 * sniff + air * .12, Math.sin(a.t * .4 + a.ph) * .3 * (1 - m));
    eyeBlink(a);
  });
};

const reedhorn = () => {
  const FUR = 0xa9b884, DARK = 0x7f8e5f, BELLY = 0xe3e2bf, HORN = 0xece0bf, HOOF = 0x4f4536, NOSE = 0x3d3a30;
  const horn = (s: number): V3[] => Array.from({ length: 5 }, (_, i) => {
    const a = i / 4 * 1.9, R = .12;
    return [s * (.055 + .05 * i / 4), .1 + R * Math.sin(a), -.02 - R + R * Math.cos(a)];
  });
  const leg = (front: boolean) => (k: Kit) => {
    if (!front) k.ball(FUR, .11, [0, -.04, 0], [.7, 1.2, 1]);
    k.seg(DARK, [0, 0, 0], [0, -.3, front ? .01 : -.02], .055, .04)
      .seg(DARK, [0, -.3, front ? .01 : -.02], [0, -.5, 0], .036, .03)
      .add(cyl(.04, .045, .06), HOOF, [0, -.51, 0]);
  };
  return rig([
    { name: "body", at: [0, .62, 0], build: k => k
      .ball(FUR, .3, [0, 0, 0], [.78, .72, 1.45])
      .ball(BELLY, .24, [0, -.09, 0], [.7, .55, 1.2])
      .ball(FUR, .2, [0, .04, -.26], [.92, .95, .9])
      .ball(BELLY, .12, [0, .05, -.4], [.9, 1, .4])
      .ball(FUR, .17, [0, -.02, .3]) },
    { name: "tail", parent: "body", at: [0, .12, -.44], rot: [-.6, 0, 0], build: k => k.add(cone(.05, .16, 5), BELLY, [0, .06, 0]) },
    ...sides((s, side) => ({ name: `legF${side}`, parent: "body", at: [s * .13, -.08, .3], build: leg(true) })),
    ...sides((s, side) => ({ name: `legB${side}`, parent: "body", at: [s * .13, -.06, -.3], build: leg(false) })),
    { name: "neck", parent: "body", at: [0, .1, .34], rot: [.45, 0, 0], build: k => k.add(cyl(.07, .1, .32), FUR, [0, .14, 0]) },
    { name: "head", parent: "neck", at: [0, .3, 0], rot: [-.3, 0, 0], build: k => k
      .ball(FUR, .14, [0, .02, .06], [.8, .85, 1.15])
      .ball(BELLY, .09, [0, -.03, .2], [.85, .8, 1.1])
      .ball(NOSE, .035, [0, -.01, .29])
      .both(s => k
        .chain(HORN, horn(s), .028, .012)
        .add(cone(.05, .16, 4), FUR, [s * .12, .08, -.02], [1, 1, .5], [0, 0, -s * 1.25])) },
    { name: "eyes", parent: "head", at: [0, .05, .12], build: k => k.both(s => k
      .ball(EYE, .035, [s * .085, 0, 0])
      .ball(SHINE, .012, [s * .08, .015, .025], 1, [0, 0, 0], "glow")) },
  ], { node: "neck", at: [0, .08, 0], radius: .105, tilt: 0 }, a => {
    const m = a.m, c = a.step(1.2 + a.sp * .5), φ = c * TAU;
    legs(a, c, .6, true);
    a.move("body", 0, Math.abs(Math.sin(φ)) * .07 * m);
    a.rot("body", Math.sin(φ) * .07 * m);
    const graze = every(a.t + a.ph, 9, .35) * (1 - m);
    a.rot("neck", Math.sin(φ + 1) * .1 * m + graze * .95);
    a.rot("head", graze * .3 + Math.sin(a.t * 6) * .04 * graze, Math.sin(a.t * .5 + a.ph) * .25 * (1 - m));
    a.rot("tail", Math.sin(a.t * 14) * .25 * every(a.t + a.ph * 2, 2.7, .25) + m * -.4);
    eyeBlink(a);
  });
};

const glowmoth = () => {
  const FUZZ = 0xebd887, CREAM = 0xfff6d8, OCHRE = 0xcdb062, DARK = 0x6b5a3a, WING = 0xfff3c4, SPOT = 0xffc94a, MOTHEYE = 0x2a2238;
  const wing = (s: number, fore: boolean) => (k: Kit) => {
    const [r, x, z, sx, sz] = fore ? [.3, .3, .08, 1.05, .72] : [.22, .22, -.1, 1, .78];
    k.ball(WING, r, [s * x, 0, z], [sx, .035, sz], [0, s * (fore ? -.25 : .2), 0], "wing", .02)
      .ball(SPOT, r * .26, [s * x * 1.18, .012, z * 1.2], [1, .05, 1], [0, 0, 0], "glow")
      .ball(0xffffff, r * .1, [s * x * 1.18, .018, z * 1.2], [1, .05, 1], [0, 0, 0], "glow");
  };
  return rig([
    { name: "body", at: [0, 1.05, 0], grain: .25, build: k => k
      .ball(FUZZ, .15, [0, 0, 0], [1, .95, 1.05])
      .ball(CREAM, .14, [0, .03, .08], [1.15, 1, .7], [0, 0, 0], "body", .3)
      .ball(FUZZ, .12, [0, -.04, -.21], [.85, .8, 1.7])
      .ball(OCHRE, .121, [0, -.04, -.17], [.87, .82, .3])
      .ball(OCHRE, .1, [0, -.045, -.28], [.86, .8, .3])
      .both(s => { for (const z of [.07, 0, -.07]) k.seg(DARK, [s * .07, -.1, z], [s * .14, -.2, z + .03], .012, .008); }) },
    { name: "head", parent: "body", at: [0, .02, .2], grain: .2, build: k => k
      .ball(FUZZ, .09, [0, 0, 0])
      .both(s => k
        .ball(MOTHEYE, .05, [s * .06, .02, .05])
        .ball(SHINE, .016, [s * .05, .045, .085], 1, [0, 0, 0], "glow")) },
    ...sides((s, side) => ({ name: `ant${side}`, parent: "head", at: [s * .03, .07, .05], build: k => k
      .chain(DARK, [[0, 0, 0], [s * .05, .1, .05], [s * .09, .19, .06]], .01, .007)
      .ball(0xe0c27a, .045, [s * .09, .19, .06], [.6, 1.4, .25], [0, 0, -s * .4]) })),
    ...sides((s, side) => ({ name: `wingF${side}`, parent: "body", at: [s * .09, .06, .03], build: wing(s, true) })),
    ...sides((s, side) => ({ name: `wingB${side}`, parent: "body", at: [s * .08, .04, -.08], build: wing(s, false) })),
  ], { node: "body", at: [0, .03, .14], radius: .1, tilt: 1.45 }, a => {
    const m = a.m, hz = 4.5 + m * 7;
    a.move("root", 0, Math.sin(a.t * 2.1 + a.ph) * .07 + m * .15);
    a.rot("body", .22 * m + Math.sin(a.t * 2.1 + a.ph + .6) * .05);
    const flap = (lag: number) => .25 + Math.sin(a.t * hz * TAU + lag) * (.5 + .25 * m);
    a.rot("wingFL", 0, 0, flap(0)); a.rot("wingFR", 0, 0, -flap(0));
    a.rot("wingBL", 0, 0, flap(-.6)); a.rot("wingBR", 0, 0, -flap(-.6));
    a.rot("antL", Math.sin(a.t * 3 + a.ph) * .15); a.rot("antR", Math.sin(a.t * 3 + a.ph + 1) * .15);
  });
};

const shellback = () => {
  const SHELL = 0x6f9892, PLATE = 0x8db7ae, EDGE = 0x557b75, RIM = 0x4f7470, SKIN = 0xb5ad7a, UNDER = 0xd8cf9c;
  const R = .36, S: V3 = [1, .62, 1.18], C: V3 = [0, .08, 0];
  const plate = (k: Kit, dir: V3, r: number) => {
    const u = new Vector3(...dir).normalize();
    const p = new Vector3(u.x * R * S[0], u.y * R * S[1], u.z * R * S[2]).multiplyScalar(.97).add(new Vector3(...C));
    const n = new Vector3(u.x / S[0], u.y / S[1], u.z / S[2]).normalize();
    const e = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(UP, n));
    k.add(cyl(r, r * 1.12, .05, 6), PLATE, [p.x, p.y, p.z], 1, [e.x, e.y, e.z])
      .add(cyl(r * 1.16, r * 1.2, .03, 6), EDGE, [p.x - n.x * .012, p.y - n.y * .012, p.z - n.z * .012], 1, [e.x, e.y, e.z]);
  };
  const leg = (k: Kit) => k.ball(SKIN, .085, [0, -.06, 0], [1.1, 1.35, 1.1]).ball(UNDER, .03, [0, -.15, .05], [1.4, .5, 1]);
  return rig([
    { name: "body", at: [0, .2, 0], build: k => {
      k.ball(SHELL, R, C, S).add(cyl(.37, .35, .07, 9), RIM, [0, -.02, 0], [1, 1, 1.18])
        .ball(UNDER, .33, [0, -.06, 0], [1, .25, 1.12])
        .add(cone(.04, .1, 5), SKIN, [0, -.02, -.44], 1, [-1.8, 0, 0]);
      plate(k, [0, 1, 0], .1);
      for (const [x, z] of [[0, .6], [0, -.6], [.55, .3], [-.55, .3], [.55, -.3], [-.55, -.3]]) plate(k, [x, .75, z], .085);
      for (let i = 0; i < 8; i++) { const ang = i / 8 * TAU; plate(k, [Math.sin(ang), .2, Math.cos(ang)], .06); }
    } },
    { name: "head", parent: "body", at: [0, .1, .4], build: k => k
      .seg(SKIN, [0, -.04, -.12], [0, .01, .04], .07, .065)
      .ball(SKIN, .1, [0, .03, .07], [.95, .85, 1.2])
      .add(new BoxGeometry(.08, .008, .012), 0x5e5838, [0, -.015, .17]) },
    { name: "eyes", parent: "head", at: [0, .055, .12], build: k => k.both(s => k
      .ball(EYE, .028, [s * .058, 0, 0])
      .ball(SHINE, .01, [s * .052, .01, .02], 1, [0, 0, 0], "glow")) },
    ...sides((s, side) => ({ name: `legF${side}`, parent: "body", at: [s * .26, -.04, .24], build: leg })),
    ...sides((s, side) => ({ name: `legB${side}`, parent: "body", at: [s * .26, -.04, -.24], build: leg })),
  ], { node: "head", at: [0, .01, .04], radius: .082, tilt: 1.25 }, a => {
    const m = a.m, c = a.step(.9 + a.sp * .6), φ = c * TAU;
    legs(a, c, .45);
    a.rot("body", 0, 0, Math.sin(φ) * .06 * m);
    a.move("body", 0, Math.abs(Math.sin(φ)) * .025 * m);
    const hide = Math.max(0, Math.sin(a.t * .35 + a.ph)) ** 10 * (1 - m);
    a.move("head", 0, 0, Math.sin(φ * 2) * .02 * m - hide * .12);
    a.rot("head", Math.sin(a.t * 1.3 + a.ph) * .08 * (1 - m), Math.sin(a.t * .5 + a.ph) * .25 * (1 - m));
    eyeBlink(a);
  });
};

const bristleback = () => {
  const HIDE = 0x946f60, DARK = 0x5b4034, BELLY = 0xb99383, SNOUT = 0xd4a597, DISC = 0xb9837a, TUSK = 0xf3ead2, HOOF = 0x3a2a22;
  const leg = (k: Kit) => k.add(cyl(.07, .055, .28), HIDE, [0, -.14, 0]).add(cyl(.05, .055, .05), HOOF, [0, -.3, 0]);
  return rig([
    { name: "body", at: [0, .5, 0], build: k => {
      k.ball(HIDE, .32, [0, 0, 0], [.92, .85, 1.45]).ball(HIDE, .27, [0, .08, .18])
        .ball(BELLY, .24, [0, -.12, 0], [.85, .6, 1.2]);
      for (let i = 0; i < 9; i++) {
        const z = .2 - i * .075, y = .23 + .08 * Math.sqrt(Math.max(0, 1 - ((z - .05) / .45) ** 2));
        k.add(cone(.045, .2 - i * .008, 4), DARK, [i % 2 ? .035 : -.035, y, z], 1, [-.55, 0, i % 2 ? -.25 : .25]);
      }
    } },
    { name: "tail", parent: "body", at: [0, .08, -.46], build: k => k.add(new TorusGeometry(.05, .014, 4, 8, 5), DARK, [0, 0, -.03], 1, [0, Math.PI / 2, 0]) },
    { name: "head", parent: "body", at: [0, .02, .42], build: k => k
      .ball(HIDE, .21, [0, 0, .08], [.95, .88, 1.1])
      .add(cyl(.09, .1, .16, 8), SNOUT, [0, -.06, .27], 1, [Math.PI / 2, 0, 0])
      .add(cyl(.095, .095, .02, 8), DISC, [0, -.06, .355], 1, [Math.PI / 2, 0, 0])
      .both(s => k
        .ball(0x3a2622, .02, [s * .035, -.06, .366])
        .add(cone(.026, .15, 5), TUSK, [s * .085, -.05, .31], 1, [-.35, 0, -s * .35])
        .ball(0x2a1a18, .036, [s * .085, .055, .255])
        .ball(0xff6a45, .014, [s * .085, .06, .286], 1, [0, 0, 0], "glow")
        .add(new BoxGeometry(.1, .026, .03), 0x3a2622, [s * .085, .105, .262], 1, [0, 0, s * .42])
        .add(cone(.06, .13, 4), HIDE, [s * .13, .15, .02], 1, [-.3, 0, -s * .5])) },
    ...sides((s, side) => ({ name: `legF${side}`, parent: "body", at: [s * .17, -.18, .28], build: leg })),
    ...sides((s, side) => ({ name: `legB${side}`, parent: "body", at: [s * .17, -.18, -.28], build: leg })),
  ], { node: "head", at: [0, -.02, -.02], radius: .19, tilt: 1.35 }, a => {
    const m = a.m, c = a.step(1.3 + a.sp * .55), φ = c * TAU;
    legs(a, c, .5);
    a.move("body", 0, Math.abs(Math.sin(φ)) * .05 * m);
    const snort = every(a.t + a.ph, 5.3, .1) * (1 - m);
    a.rot("head", .16 * m + Math.sin(φ * 2) * .05 * m - snort * .18, Math.sin(a.t * .6 + a.ph) * .2 * (1 - m));
    a.rot("tail", 0, Math.sin(a.t * 9) * .3);
    const breathe = 1 + Math.sin(a.t * 1.8) * .02;
    a.scale("body", breathe, breathe, 1);
  });
};

const thistlefox = () => {
  const FUR = 0xd9894a, DARK = 0xa8582c, WHITE = 0xfbf1e2, SOCK = 0x3f2c22, PURPLE = 0xa171c4, GREEN = 0x6f9a4f, NOSE = 0x241b1b, INNER = 0xf6d7c0;
  const leg = (k: Kit) => k.add(cyl(.04, .033, .3), FUR, [0, -.15, 0]).add(cyl(.035, .03, .13), SOCK, [0, -.25, 0]).ball(SOCK, .04, [0, -.29, .02], [1, .6, 1.3]);
  return rig([
    { name: "body", at: [0, .42, 0], build: k => k
      .ball(FUR, .24, [0, 0, 0], [.82, .78, 1.5])
      .ball(WHITE, .16, [0, -.02, .24], [.9, 1, .8])
      .ball(WHITE, .18, [0, -.08, -.02], [.75, .5, 1.2]) },
    { name: "head", parent: "body", at: [0, .16, .32], build: k => {
      k.ball(FUR, .16, [0, .04, 0], [1.05, .9, 1])
        .add(cone(.075, .19, 6), WHITE, [0, -.01, .16], 1, [Math.PI / 2, 0, 0])
        .ball(NOSE, .03, [0, -.005, .26])
        .add(cone(.03, .08, 4), GREEN, [0, .21, .03])
        .ball(PURPLE, .045, [0, .26, .03], 1, [0, 0, 0], "body", .2)
        .both(s => k
          .ball(WHITE, .07, [s * .095, -.03, .05], [1, .75, .9])
          .add(cone(.075, .2, 4), FUR, [s * .085, .19, -.01], 1, [-.1, 0, -s * .25])
          .add(cone(.045, .13, 4), INNER, [s * .085, .17, .015], 1, [-.1, 0, -s * .25])
          .add(cone(.03, .07, 4), SOCK, [s * .108, .275, -.02], 1, [-.1, 0, -s * .25]));
      for (let i = 0; i < 6; i++) {
        const ang = i / 6 * TAU;
        k.add(cone(.012, .07, 3), PURPLE, [Math.sin(ang) * .03, .29, .03 + Math.cos(ang) * .03], 1, [Math.cos(ang) * .6, 0, -Math.sin(ang) * .6]);
      }
    } },
    { name: "eyes", parent: "head", at: [0, .07, .115], build: k => k.both(s => k
      .ball(EYE, .032, [s * .07, 0, 0], [1, 1.25, .8])
      .ball(SHINE, .011, [s * .062, .015, .025], 1, [0, 0, 0], "glow")) },
    ...sides((s, side) => ({ name: `legF${side}`, parent: "body", at: [s * .09, -.12, .22], build: leg })),
    ...sides((s, side) => ({ name: `legB${side}`, parent: "body", at: [s * .1, -.1, -.24], build: leg })),
    { name: "tail", parent: "body", at: [0, .06, -.34], rot: [-.25, 0, 0], grain: .16, build: k => k
      .ball(FUR, .13, [0, 0, -.24], [.85, .85, 2.1])
      .ball(DARK, .1, [0, .04, -.2], [.7, .5, 1.6])
      .ball(WHITE, .09, [0, 0, -.5], [.9, .9, 1.2]) },
  ], { node: "body", at: [0, .1, .26], radius: .125, tilt: 1.1 }, a => {
    const m = a.m, c = a.step(1.5 + a.sp * .55), φ = c * TAU;
    legs(a, c, .55);
    a.move("body", 0, Math.abs(Math.sin(φ)) * .035 * m);
    a.rot("tail", Math.sin(φ) * .1 * m, Math.sin(a.t * (1.6 + m * 3) + a.ph) * (.35 - m * .15));
    const tilt = every(a.t + a.ph, 6.5, .3) * (1 - m);
    a.rot("head", Math.sin(φ * 2) * .04 * m, Math.sin(a.t * .55 + a.ph) * .3 * (1 - m), tilt * .35);
    eyeBlink(a);
  });
};

const puddlefrog = () => {
  const SKIN = 0x7fb069, DARK = 0x5e8c4c, BELLY = 0xe7efc4, SPOT = 0x4f7a3f, WHITE = 0xfbfbf2, PUPIL = 0x1d1a16, MOUTH = 0x3e5a33;
  return rig([
    { name: "body", at: [0, 0, 0], build: k => {
      k.ball(SKIN, .26, [0, .2, 0], [1.2, .78, 1.05]).ball(BELLY, .22, [0, .15, .07], [1.05, .6, .9])
        .add(new BoxGeometry(.3, .014, .02), MOUTH, [0, .175, .262], 1, [0, 0, 0]);
      for (const [x, z, r] of [[.11, -.05, .05], [-.12, .02, .045], [0, -.13, .055], [.05, .1, .035], [-.06, -.1, .03]] as V3[])
        k.ball(SPOT, r, [x, .385 - Math.abs(z) * .25, z], [1, .3, 1]);
    } },
    { name: "eyes", parent: "body", at: [0, .36, .12], build: k => k.both(s => k
      .ball(SKIN, .088, [s * .12, 0, 0])
      .ball(WHITE, .066, [s * .13, .02, .04])
      .ball(PUPIL, .036, [s * .135, .028, .095], [1.4, .7, .5])
      .ball(SHINE, .016, [s * .118, .055, .1], 1, [0, 0, 0], "glow")) },
    { name: "throat", parent: "body", at: [0, .1, .2], build: k => k.ball(BELLY, .1, [0, 0, 0], [1.1, .7, .8]) },
    ...sides((s, side) => ({ name: `legB${side}`, parent: "body", at: [s * .2, .12, -.12], build: k => k
      .ball(DARK, .1, [0, 0, 0], [.7, .6, 1.4])
      .ball(SKIN, .06, [s * .04, -.07, .08], [.6, .5, 1.3])
      .ball(DARK, .07, [s * .06, -.105, .15], [1.35, .25, 1.5]) })),
    ...sides((s, side) => ({ name: `legF${side}`, parent: "body", at: [s * .14, .1, .16], build: k => k
      .add(cyl(.03, .03, .1, 5), SKIN, [0, -.05, 0]).ball(DARK, .045, [0, -.1, .02], [1.3, .3, 1.2]) })),
  ], { node: "body", at: [0, .2, .03], radius: .285, tilt: .12 }, a => {
    const m = a.m, c = a.step(.9 + a.sp * .45), p = fract(c), air = Math.sin(p * Math.PI) * m;
    a.move("root", 0, air * .34, air * .05);
    a.rot("root", -Math.cos(p * Math.PI) * .3 * m);
    a.scale("root", 1 - air * .08, 1 - air * .06, 1 + air * .28);
    a.rot("legBL", -air * 1.1); a.rot("legBR", -air * 1.1);
    a.rot("legFL", air * .6); a.rot("legFR", air * .6);
    const puff = 1 + Math.max(0, Math.sin(a.t * 2.5 + a.ph)) ** 4 * .45 * (1 - m);
    a.scale("throat", puff, puff, puff);
    const breathe = 1 + Math.sin(a.t * 1.7 + a.ph) * .025 * (1 - m);
    a.scale("body", breathe, 1 / breathe, breathe);
    eyeBlink(a);
  });
};

const bumblewisp = () => {
  const YEL = 0xf2c14e, BLACK = 0x2a2420, FUZZ = 0xfff4d6, WING = 0xe6f6ff;
  const wing = (s: number) => (k: Kit) => k
    .ball(WING, .17, [s * .15, 0, -.04], [1, .04, .6], [0, s * -.3, s * .15], "wing", .02)
    .ball(WING, .11, [s * .12, -.01, -.13], [1, .04, .55], [0, s * .25, s * .1], "wing", .02);
  return rig([
    { name: "body", at: [0, 1, 0], grain: .24, build: k => k
      .ball(YEL, .2, [0, 0, 0], [1, .95, 1.15])
      .ball(BLACK, .205, [0, 0, -.06], [1.01, .96, .24])
      .ball(BLACK, .185, [0, -.01, -.17], [.98, .9, .24])
      .ball(FUZZ, .13, [0, .04, .12], [1.25, 1, .6], [0, 0, 0], "body", .3)
      .add(cone(.03, .08, 5), BLACK, [0, -.01, -.26], 1, [-Math.PI / 2, 0, 0])
      .both(s => { for (const z of [.06, -.02, -.1]) k.seg(BLACK, [s * .07, -.14, z], [s * .1, -.24, z + .02], .013, .009); }) },
    { name: "head", parent: "body", at: [0, .02, .2], build: k => k
      .ball(BLACK, .12, [0, 0, 0], [1, .95, .9])
      .both(s => k
        .ball(0x1a1a2e, .055, [s * .068, .02, .06], [.8, 1.1, .7])
        .ball(SHINE, .016, [s * .058, .05, .1], 1, [0, 0, 0], "glow")
        .ball(0xf6a0a0, .025, [s * .075, -.045, .08], [1, .6, .5])
        .chain(BLACK, [[s * .04, .09, .03], [s * .07, .16, .07], [s * .08, .2, .1]], .01, .008)
        .ball(BLACK, .025, [s * .08, .2, .1])) },
    { name: "wingL", parent: "body", at: [.06, .15, .02], build: wing(1) },
    { name: "wingR", parent: "body", at: [-.06, .15, .02], build: wing(-1) },
  ], { node: "body", at: [0, .03, .16], radius: .11, tilt: 1.45 }, a => {
    const m = a.m;
    a.move("root", Math.sin(a.t * 1.1 + a.ph) * .04, Math.sin(a.t * 2.6 + a.ph) * .06 + Math.sin(a.t * 1.3) * .03, 0);
    a.rot("body", .3 * m + Math.sin(a.t * 2.6 + a.ph) * .05, 0, Math.sin(a.t * 1.1 + a.ph) * .08);
    const buzz = Math.sin(a.t * 26 * TAU) * .55;
    a.rot("wingL", 0, 0, .35 + buzz); a.rot("wingR", 0, 0, -.35 - buzz);
    a.rot("head", 0, Math.sin(a.t * .7 + a.ph) * .2 * (1 - m));
  });
};

const hootling = () => {
  const FEATH = 0xa98467, DARK = 0x7d5f48, BELLY = 0xecdcc0, CHEV = 0x9b7a5c, DISC = 0xf1e4cc, RING = 0xf2c445, PUPIL = 0x1b1612, BEAK = 0xe2a23c, FEET = 0xe3a548;
  return rig([
    { name: "body", at: [0, .3, 0], grain: .12, build: k => {
      k.ball(FEATH, .26, [0, 0, 0], [1, 1.12, .95]).ball(BELLY, .2, [0, -.03, .12], [.95, 1.05, .6])
        .add(cone(.08, .14, 4), DARK, [0, -.18, -.2], 1, [-2.2, 0, 0])
        .both(s => k.ball(FEET, .045, [s * .08, -.28, .09], [1.2, .45, 1.4]));
      for (const [x, y] of [[.06, .05], [-.06, .05], [0, -.03], [.08, -.1], [-.08, -.1], [0, -.17]] as [number, number][])
        k.add(cone(.025, .035, 3), CHEV, [x, y, .205 - Math.abs(y) * .12], [1, 1, .4], [Math.PI, 0, 0]);
    } },
    ...sides((s, side) => ({ name: `wing${side}`, parent: "body", at: [s * .23, .06, 0], build: k => k
      .ball(DARK, .17, [0, -.08, -.02], [.32, 1.05, .75])
      .ball(FEATH, .1, [s * .01, -.03, .03], [.3, .9, .6]) })),
    { name: "head", parent: "body", at: [0, .34, 0], build: k => k
      .ball(FEATH, .22, [0, 0, 0], [1.12, .95, 1])
      .add(cone(.03, .08, 4), BEAK, [0, -.06, .2], 1, [Math.PI - .55, 0, 0])
      .add(cone(.025, .05, 3), DARK, [0, .07, .19], [1.8, 1, .5], [0, 0, 0])
      .both(s => k
        .ball(DISC, .1, [s * .085, 0, .14], [1, 1.05, .35])
        .add(cone(.05, .14, 4), DARK, [s * .15, .17, -.01], 1, [-.15, 0, -s * .45])) },
    { name: "eyes", parent: "head", at: [0, 0, .18], build: k => k.both(s => k
      .ball(RING, .066, [s * .085, .01, .0], [1, 1, .45])
      .ball(PUPIL, .043, [s * .085, .01, .022], [1, 1, .45])
      .ball(SHINE, .016, [s * .07, .032, .035], 1, [0, 0, 0], "glow")) },
  ], { node: "body", at: [0, .22, .02], radius: .17, tilt: .3 }, a => {
    const m = a.m, c = a.step(2.2 + a.sp * .6), p = fract(c);
    a.move("root", 0, Math.abs(Math.sin(p * Math.PI)) * .08 * m);
    a.rot("root", 0, 0, Math.sin(p * TAU) * .1 * m);
    const flutter = Math.sin(a.t * 22) * .35 * m;
    a.rot("wingL", 0, 0, flutter + .05); a.rot("wingR", 0, 0, -flutter - .05);
    const look = Math.sin(a.t * .45 + a.ph);
    a.rot("head", 0, Math.sign(look) * Math.abs(look) ** .35 * .85 * (1 - m), every(a.t + a.ph, 7, .25) * .3);
    eyeBlink(a);
  });
};

const driftgull = () => {
  const WHITE = 0xf3f6f8, GREY = 0xa3b0ba, TIP = 0x2f3439, BEAK = 0xf2bf3e, DOT = 0xd9483b, LEG = 0xe9a24a;
  const wing = (s: number) => (k: Kit) => k
    .ball(GREY, .3, [s * .34, 0, -.03], [1.25, .05, .42], [0, 0, 0], "body", .05)
    .ball(WHITE, .2, [s * .2, -.012, .02], [1.2, .04, .3], [0, 0, 0], "body", .03)
    .ball(TIP, .1, [s * .66, 0, -.07], [1.4, .06, .5]);
  return rig([
    { name: "body", at: [0, .38, 0], build: k => k
      .ball(WHITE, .17, [0, 0, 0], [.9, .85, 1.55])
      .ball(GREY, .16, [0, .05, -.04], [.92, .5, 1.45])
      .add(cone(.09, .2, 4), GREY, [0, .02, -.32], [1, .35, 1], [-Math.PI / 2, 0, Math.PI / 4])
      .add(cone(.05, .07, 4), TIP, [0, .02, -.41], [1, .35, 1], [-Math.PI / 2, 0, Math.PI / 4]) },
    { name: "head", parent: "body", at: [0, .16, .2], build: k => k
      .ball(WHITE, .11, [0, 0, 0], [.95, .95, 1.1])
      .add(cone(.032, .14, 5), BEAK, [0, -.02, .16], 1, [Math.PI / 2, 0, 0])
      .ball(DOT, .013, [0, -.038, .15])
      .both(s => k.ball(EYE, .02, [s * .066, .03, .07]).ball(SHINE, .007, [s * .066, .038, .085], 1, [0, 0, 0], "glow")) },
    ...sides((s, side) => ({ name: `wing${side}`, parent: "body", at: [s * .12, .07, .06], rot: [0, s * 1.52, -s * .3], build: wing(s) })),
    ...sides((s, side) => ({ name: `leg${side}`, parent: "body", at: [s * .06, -.12, 0], build: k => k
      .add(cyl(.015, .015, .22, 5), LEG, [0, -.11, 0]).ball(LEG, .035, [0, -.235, .03], [1.2, .2, 1.6]) })),
  ], { node: "head", at: [0, -.08, -.05], radius: .085, tilt: .7 }, a => {
    const fly = clamp01((a.sp - .4) / 1.2), m = a.m;
    a.move("root", 0, fly * .55 + Math.sin(a.t * 3 + a.ph) * .04 * fly);
    a.rot("body", -.12 * fly);
    const flap = Math.sin(a.t * 8 * TAU / 6 + a.ph) * .65;
    a.rot("wingL", 0, -1.52 * fly, (flap + .4) * fly);
    a.rot("wingR", 0, 1.52 * fly, -(flap + .4) * fly);
    a.scale("legL", 1, 1 - fly * .75, 1); a.scale("legR", 1, 1 - fly * .75, 1);
    const waddle = (1 - fly) * m, c = a.step(2 + a.sp);
    a.rot("legL", Math.sin(c * TAU) * .5 * waddle - fly * .8); a.rot("legR", -Math.sin(c * TAU) * .5 * waddle - fly * .8);
    a.rot("body", 0, 0, Math.sin(c * TAU) * .08 * waddle);
    const peck = every(a.t + a.ph, 4.2, .15) * (1 - m);
    a.rot("head", peck * .7 + Math.sin(c * TAU * 2) * .08 * waddle, Math.sin(a.t * .7 + a.ph) * .4 * (1 - m));
  });
};

const emberling = () => {
  const SKIN = 0xe2603c, DARK = 0xa83a22, BELLY = 0xf3a465, EMBER = 0xffcf4a, HOT = 0xff8a2a;
  const leg = (s: number) => (k: Kit) => k.ball(SKIN, .035, [s * .04, -.03, 0], [1.8, .55, .8]).ball(DARK, .026, [s * .08, -.065, .02], [1.2, .4, 1.2]);
  return rig([
    { name: "body", at: [0, .11, 0], build: k => k
      .ball(SKIN, .1, [0, 0, 0], [1, .62, 1.7])
      .ball(BELLY, .085, [0, -.035, 0], [.95, .4, 1.5])
      .ball(EMBER, .024, [0, .06, .06], [1, .4, 1], [0, 0, 0], "glow")
      .ball(HOT, .02, [.045, .052, -.04], [1, .4, 1], [0, 0, 0], "glow")
      .ball(EMBER, .022, [-.04, .054, -.08], [1, .4, 1], [0, 0, 0], "glow")
      .ball(HOT, .018, [.02, .058, -.13], [1, .4, 1], [0, 0, 0], "glow") },
    { name: "head", parent: "body", at: [0, .01, .17], build: k => k
      .ball(SKIN, .085, [0, 0, .04], [1.15, .62, 1.25])
      .ball(EMBER, .016, [0, .05, .02], [1, .4, 1], [0, 0, 0], "glow")
      .add(new BoxGeometry(.07, .006, .01), DARK, [0, -.02, .14])
      .both(s => k
        .add(cone(.02, .07, 4), DARK, [s * .095, .025, -.01], 1, [.3, 0, -s * 1.15])
        .add(cone(.016, .055, 4), HOT, [s * .085, .04, -.03], 1, [.1, 0, -s * .8], "glow")) },
    { name: "eyes", parent: "head", at: [0, .035, .07], build: k => k.both(s => k
      .ball(EYE, .03, [s * .06, 0, 0])
      .ball(SHINE, .01, [s * .055, .013, .02], 1, [0, 0, 0], "glow")) },
    { name: "tail1", parent: "body", at: [0, 0, -.15], build: k => k.ball(SKIN, .07, [0, 0, -.08], [.8, .55, 1.6]).ball(EMBER, .016, [0, .035, -.08], [1, .4, 1], [0, 0, 0], "glow") },
    { name: "tail2", parent: "tail1", at: [0, 0, -.17], build: k => k.ball(SKIN, .05, [0, 0, -.07], [.8, .5, 1.7]) },
    { name: "tail3", parent: "tail2", at: [0, 0, -.13], build: k => k
      .add(cone(.035, .15, 5), DARK, [0, 0, -.06], [1, .7, 1], [-Math.PI / 2, 0, 0])
      .ball(HOT, .022, [0, 0, -.14], 1, [0, 0, 0], "glow") },
    ...sides((s, side) => ({ name: `legF${side}`, parent: "body", at: [s * .085, -.03, .09], build: leg(s) })),
    ...sides((s, side) => ({ name: `legB${side}`, parent: "body", at: [s * .085, -.03, -.08], build: leg(s) })),
  ], { node: "head", at: [0, -.005, -.02], radius: .075, tilt: 1.5, squash: .65 }, a => {
    const m = a.m, c = a.step(1.6 + a.sp * .8), φ = c * TAU;
    const sway = Math.sin(φ) * .2 * m + Math.sin(a.t * 1.1 + a.ph) * .05 * (1 - m);
    a.rot("body", 0, sway); a.rot("head", 0, -sway * .8 + Math.sin(a.t * .6 + a.ph) * .2 * (1 - m));
    const wave = (k: number) => Math.sin(φ - k) * .35 * m + Math.sin(a.t * 1.4 + a.ph - k) * .25 * (1 - m);
    a.rot("tail1", 0, wave(.8)); a.rot("tail2", 0, wave(1.6)); a.rot("tail3", 0, wave(2.4));
    for (const [n, o] of [["legFL", 0], ["legBR", 0], ["legFR", Math.PI], ["legBL", Math.PI]] as [string, number][])
      a.rot(n, 0, Math.sin(φ + o) * .55 * m);
    eyeBlink(a);
  });
};

const critter = (color: number) => () => {
  const LIGHT = 0xf3ead8;
  const leg = (k: Kit) => k.ball(color, .06, [0, -.06, 0], [1, 1.4, 1]);
  return rig([
    { name: "body", at: [0, .3, 0], build: k => k.ball(color, .24, [0, 0, 0], [1, .9, 1.2]).ball(LIGHT, .17, [0, -.04, .1], [.9, .8, .8]).ball(LIGHT, .07, [0, .02, -.3]) },
    { name: "head", parent: "body", at: [0, .22, .2], build: k => k
      .ball(color, .17, [0, 0, 0])
      .ball(LIGHT, .07, [0, -.04, .14])
      .both(s => k
        .ball(color, .07, [s * .11, .14, -.02], [.8, 1.1, .5])) },
    { name: "eyes", parent: "head", at: [0, .03, .13], build: k => k.both(s => k
      .ball(EYE, .04, [s * .07, 0, 0])
      .ball(SHINE, .013, [s * .062, .015, .03], 1, [0, 0, 0], "glow")) },
    ...sides((s, side) => ({ name: `legF${side}`, parent: "body", at: [s * .12, -.17, .14], build: leg })),
    ...sides((s, side) => ({ name: `legB${side}`, parent: "body", at: [s * .12, -.17, -.14], build: leg })),
  ], { node: "body", at: [0, .14, .14], radius: .14, tilt: .9 }, a => {
    const m = a.m, c = a.step(1.6 + a.sp * .5);
    legs(a, c, .5);
    a.move("body", 0, Math.abs(Math.sin(c * TAU)) * .04 * m);
    a.rot("head", 0, Math.sin(a.t * .5 + a.ph) * .3 * (1 - m));
    eyeBlink(a);
  });
};

const BUILDERS: Record<string, () => Rig> = {
  burrowbun, reedhorn, glowmoth, shellback, bristleback, thistlefox, puddlefrog, bumblewisp, hootling, driftgull, emberling,
};
export const CREATURE_SPECIES = Object.keys(BUILDERS);
export const CREATURE_HEIGHT: Record<string, number> = {
  burrowbun: 1.05, reedhorn: 1.4, glowmoth: 1.65, shellback: .8, bristleback: 1.1, thistlefox: 1.05,
  puddlefrog: .75, bumblewisp: 1.5, hootling: 1.05, driftgull: 1, emberling: .55,
};
export const creatureHeight = (species: string) => CREATURE_HEIGHT[species] ?? .9;

const rigs = new Map<string, Rig>();
/** Built lazily and shared by every creature of a species. */
export function creatureRig(species: string, color = "#b9a68a"): Rig {
  const key = BUILDERS[species] ? species : `critter:${color}`;
  let r = rigs.get(key);
  if (!r) {
    r = (BUILDERS[species] ?? critter(parseInt(color.replace("#", ""), 16) || 0xb9a68a))();
    rigs.set(key, r);
  }
  return r;
}

const MAT = {
  body: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .88 }),
  glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  wing: new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .62, side: DoubleSide, depthWrite: false, toneMapped: false }),
  tag: new MeshStandardMaterial({ color: "#e2b64a", flatShading: true, roughness: .4, metalness: .5 }),
};
const collarMats = new Map<string, MeshStandardMaterial>();
const collarMat = (color: string) => {
  let m = collarMats.get(color);
  if (!m) collarMats.set(color, m = new MeshStandardMaterial({ color, flatShading: true, roughness: .75 }));
  return m;
};
const collarGeos = new Map<number, { band: BufferGeometry; scarf: BufferGeometry; tag: BufferGeometry }>();
function collarGeo(radius: number) {
  let g = collarGeos.get(radius);
  if (!g) {
    const tube = Math.max(.018, radius * .2);
    const band = new TorusGeometry(radius, tube, 5, 14).rotateX(Math.PI / 2);
    const scarf = new ConeGeometry(radius * .55, radius * .8, 3).rotateX(Math.PI).scale(1, 1, .35).translate(0, -radius * .3, radius * .98);
    const tag = new IcosahedronGeometry(Math.max(.018, radius * .16), 0).translate(radius * .45, -radius * .35, radius * 1.02);
    collarGeos.set(radius, g = { band, scarf, tag });
  }
  return g;
}

function CollarMesh({ spec, color }: { spec: Collar; color: string }) {
  const g = collarGeo(spec.radius), mat = collarMat(color);
  return <group position={spec.at} rotation={[spec.tilt, 0, 0]} scale={[1, spec.squash ?? 1, 1]}>
    <mesh geometry={g.band} material={mat} />
    <mesh geometry={g.scarf} material={mat} />
    <mesh geometry={g.tag} material={MAT.tag} />
  </group>;
}

function RigNode({ r, name, refs, collar }: { r: Rig; name: string; refs: Record<string, Object3D>; collar?: string }) {
  const n = r.nodes.find(node => node.name === name)!;
  return <group ref={o => { if (o) refs[name] = o; }} position={n.at} rotation={n.rot ?? [0, 0, 0]}>
    {n.geo.body && <mesh geometry={n.geo.body} material={MAT.body} castShadow />}
    {n.geo.glow && <mesh geometry={n.geo.glow} material={MAT.glow} />}
    {n.geo.wing && <mesh geometry={n.geo.wing} material={MAT.wing} renderOrder={2} />}
    {collar && r.collar.node === name && <CollarMesh spec={r.collar} color={collar} />}
    {(r.children[name] ?? []).map(child => <RigNode key={child} r={r} name={child} refs={refs} collar={collar} />)}
  </group>;
}

export function CreatureModel({ species, motion, tamed = false, ownerColor = "#c8473d", color }: {
  species: string; motion: React.MutableRefObject<CreatureMotion>; tamed?: boolean; ownerColor?: string; color?: string;
}) {
  const r = creatureRig(species, color);
  const refs = useRef<Record<string, Object3D>>({}).current;
  const live = useMemo(() => {
    const state = { sp: 0, m: 0, cycle: 0, ph: Math.random() * 20, t: 0, dt: 0 };
    const base = new Map<string, { p: V3; r: V3 }>(r.nodes.map(n => [n.name, { p: n.at, r: n.rot ?? [0, 0, 0] }]));
    const api: Api = {
      get t() { return state.t; }, get dt() { return state.dt; }, get ph() { return state.ph; },
      get m() { return state.m; }, get sp() { return state.sp; },
      step(hz) { state.cycle += state.dt * hz; return state.cycle; },
      rot(n, x, y = 0, z = 0) { const o = refs[n]; if (o) { o.rotation.x += x; o.rotation.y += y; o.rotation.z += z; } },
      move(n, x, y = 0, z = 0) { const o = refs[n]; if (o) { o.position.x += x; o.position.y += y; o.position.z += z; } },
      scale(n, x, y = x, z = x) { const o = refs[n]; if (o) { o.scale.x *= x; o.scale.y *= y; o.scale.z *= z; } },
      blink() { return fract((state.t + state.ph) * .27) < .035; },
    };
    return { state, base, api };
  }, [r, refs]);
  useFrame((_, delta) => {
    const { state, base, api } = live, dt = Math.min(delta, .1);
    state.t += dt; state.dt = dt;
    state.sp += ((motion.current?.speed ?? 0) - state.sp) * Math.min(1, dt * 6);
    state.m += (clamp01(state.sp / 1.2) - state.m) * Math.min(1, dt * 5);
    for (const [name, b] of base) {
      const o = refs[name];
      if (!o) continue;
      o.position.set(...b.p); o.rotation.set(...b.r); o.scale.set(1, 1, 1);
    }
    r.animate(api);
  });
  return <RigNode r={r} name="root" refs={refs} collar={tamed ? ownerColor : undefined} />;
}
