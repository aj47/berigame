import React, { useEffect, useMemo } from "react";
import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  IcosahedronGeometry, LatheGeometry, MeshStandardMaterial, SphereGeometry, Vector2,
} from "three";
import { merged, part } from "../Components/3D/envArt";
import { linear, seeded } from "../Components/3D/nodes/lowPoly";
import { PIECES, type Point } from "../../../shared/sim/frontier/catalog";

/**
 * Settlement building art. Every piece is baked once into a merged, vertex-coloured
 * geometry (one draw call, plus optional glow/glass slots), so a full plot of 128
 * pieces stays cheap. Local frame: tile centre at the origin, +z is the piece's
 * front ("south" at rotation 0). Edge pieces stand on z = 0; PieceModel shifts them
 * to the tile boundary.
 */
export const WALL_HEIGHT = 2.8;
/** Roof rests above the wall plates: the slope drops 0.16 across a brick wall's outer cap. */
export const ROOF_BASE = WALL_HEIGHT + 0.2;
const ROOF_PITCH = 1, ROOF_MAX_RISE = 2, ROOF_OVERHANG = 0.32;

const C = {
  frame: 0x6b4a30, timber: 0x8c6340, plank: 0xb4875a, plankLight: 0xc9a273, daub: 0xe8dbbd,
  stone: 0x9b968d, stoneDark: 0x77736b, brick: 0xb0634a, brickDark: 0x94513d, iron: 0x4a4d52,
  gold: 0xd4a945, cloth: 0xefe6cf, red: 0x9b4340, blue: 0x4f6f9c, teal: 0x5b8a87, leaf: 0x5d9145,
  leafDark: 0x43703a, clay: 0xbb7550, soil: 0x5a4430, hay: 0xd8be66, water: 0x5ea3b9, thatch: 0xcda75c,
  glow: 0xffd78a, glass: 0xbfe0e6,
};

type V3 = [number, number, number];
type Slot = "body" | "glow" | "glass";
class Kit {
  parts: Record<Slot, BufferGeometry[]> = { body: [], glow: [], glass: [] };
  private seed = 1;
  constructor(private readonly rand = seeded(7)) {}
  /** Slight per-part tint so planks and bricks read as individual pieces. */
  private tint(hex: number, amount: number) {
    if (!amount) return hex;
    const c = new Color(hex), hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h + (this.rand() - .5) * amount * .15, hsl.s, Math.min(1, Math.max(0, hsl.l + (this.rand() - .5) * amount)));
    return c.getHex();
  }
  add(geometry: BufferGeometry, hex: number, pos: V3, scale: V3 = [1, 1, 1], rot: V3 = [0, 0, 0], opts: { slot?: Slot; vary?: number; facets?: number } = {}) {
    this.parts[opts.slot ?? "body"].push(part(geometry, this.tint(hex, opts.vary ?? 0), pos, scale, rot, opts.facets ?? .06, this.seed++));
  }
  box(size: V3, pos: V3, hex: number, rot: V3 = [0, 0, 0], opts?: { slot?: Slot; vary?: number; facets?: number }) {
    this.add(BOX, hex, pos, size, rot, opts);
  }
  cyl(rTop: number, rBottom: number, h: number, segments: number, pos: V3, hex: number, rot: V3 = [0, 0, 0], opts?: { slot?: Slot; vary?: number }) {
    this.add(new CylinderGeometry(rTop, rBottom, h, segments), hex, pos, [1, 1, 1], rot, opts);
  }
  /** A part fixed to a door or gate leaf that swings about a vertical hinge. */
  hinged(hinge: V3, angle: number, size: V3, local: V3, hex: number, rotZ = 0, opts?: { slot?: Slot; vary?: number }) {
    const [x, y, z] = local, cos = Math.cos(angle), sin = Math.sin(angle);
    this.box(size, [hinge[0] + x * cos + z * sin, hinge[1] + y, hinge[2] - x * sin + z * cos], hex, [0, angle, rotZ], opts);
  }
  build() {
    const out: Partial<Record<Slot, BufferGeometry>> = {};
    for (const slot of Object.keys(this.parts) as Slot[]) if (this.parts[slot].length) out[slot] = merged(this.parts[slot]);
    return out;
  }
}
const BOX = new BoxGeometry(1, 1, 1);
const H = WALL_HEIGHT;

/** Shared timber-framed bay: corner posts, plates, and a lower plank wainscot. */
function frame(k: Kit, opts: { sole?: boolean; wainscot?: boolean } = {}) {
  for (const x of [-.5, .5]) k.box([.2, H, .2], [x, H / 2, 0], C.frame);
  k.box([1.02, .18, .24], [0, H - .09, 0], C.frame);
  if (opts.sole !== false) k.box([1, .16, .22], [0, .08, 0], C.frame);
  if (opts.wainscot !== false) {
    for (const x of [-.3, -.1, .1, .3]) k.box([.19, .84, .12], [x, .58, 0], C.plank, [0, 0, 0], { vary: .08 });
    k.box([1, .12, .2], [0, 1.06, 0], C.frame);
  }
}
function timberWall(k: Kit) {
  frame(k);
  k.box([.8, 1.5, .1], [0, 1.87, 0], C.daub, [0, 0, 0], { facets: .03 });
  const length = Math.hypot(.8, 1.5);
  k.box([.09, length, .15], [0, 1.87, 0], C.frame, [0, 0, -Math.atan2(.8, 1.5)]);
  k.box([.8, .09, .14], [0, 1.87, 0], C.frame);
}
function brickWall(k: Kit) {
  k.box([1.06, .3, .3], [0, .15, 0], C.stoneDark, [0, 0, 0], { vary: .05 });
  for (const x of [-.5, .5]) k.box([.28, H, .28], [x, H / 2, 0], C.brickDark, [0, 0, 0], { facets: .1 });
  k.box([.76, H - .46, .18], [0, .3 + (H - .46) / 2, 0], C.daub, [0, 0, 0], { facets: 0 });
  const rows = Math.floor((H - .46) / .2);
  for (let row = 0; row < rows; row++) {
    const y = .3 + .1 + row * ((H - .46) / rows), offset = row % 2 ? .19 : 0;
    for (let x = -.38 + offset; x < .38; x += .38) {
      const from = Math.max(-.36, x - .18), to = Math.min(.36, x + .18);
      if (to - from > .06) k.box([to - from - .02, .17, .24], [(from + to) / 2, y, 0], C.brick, [0, 0, 0], { vary: .1 });
    }
  }
  k.box([1.08, .16, .32], [0, H - .08, 0], C.stone, [0, 0, 0], { vary: .05 });
}
function windowWall(k: Kit) {
  frame(k);
  k.box([.92, .07, .36], [0, 1.15, 0], C.timber);
  for (const x of [-.35, .35]) k.box([.1, 1.06, .2], [x, 1.68, 0], C.frame);
  k.box([.8, .14, .22], [0, 2.27, 0], C.frame);
  k.box([.8, .28, .1], [0, 2.48, 0], C.daub, [0, 0, 0], { facets: .03 });
  k.box([.6, 1, .03], [0, 1.69, 0], C.glass, [0, 0, 0], { slot: "glass", facets: 0 });
  k.box([.04, 1, .07], [0, 1.69, 0], C.frame);
  k.box([.6, .04, .07], [0, 1.69, 0], C.frame);
  // Open shutters and a flower box on the front face.
  for (const side of [-1, 1]) k.hinged([side * .4, 1.69, .11], side * 2.1, [.3, .98, .04], [side * -.15, 0, 0], C.teal, 0, { vary: .05 });
  k.box([.62, .14, .16], [0, 1.04, .22], C.timber);
  [[-.22, C.red], [-.08, C.gold], [.07, 0xf2f0e6], [.21, C.red]].forEach(([x, hex]) => {
    k.add(new IcosahedronGeometry(.06, 0), hex, [x, 1.16, .22]);
    k.add(new IcosahedronGeometry(.05, 0), C.leaf, [x + .05, 1.13, .2]);
  });
}
function doorWall(k: Kit) {
  frame(k, { sole: false, wainscot: false });
  k.box([1, .05, .24], [0, .025, 0], C.stoneDark);
  k.box([.8, .26, .22], [0, H - .31, 0], C.frame);
  // The door stands ajar so the walkable opening reads at a glance.
  const hinge: V3 = [-.37, 0, .04], open = 1.05;
  for (const x of [.13, .37, .61]) k.hinged(hinge, open, [.235, 2.28, .06], [x, 1.16, 0], C.plank, 0, { vary: .07 });
  for (const y of [.45, 1.85]) {
    k.hinged(hinge, open, [.7, .12, .04], [.37, y, -.05], C.timber);
    k.hinged(hinge, open, [.32, .05, .02], [.16, y, .04], C.iron);
  }
  k.hinged(hinge, open, [.07, 1.55, .04], [.37, 1.15, -.05], C.timber, -.72);
  k.hinged(hinge, open, [.05, .05, .08], [.64, 1.1, .05], C.gold);
  k.box([.06, .06, .06], [-.42, 2.2, .14], C.iron);
}
function fence(k: Kit, gate: boolean) {
  for (const x of [-.45, .45]) {
    k.box([.13, gate ? 1.2 : 1, .13], [x, gate ? .6 : .5, 0], C.timber, [0, 0, 0], { vary: .06 });
    if (gate) k.add(new IcosahedronGeometry(.09, 0), C.frame, [x, 1.26, 0]);
    else k.add(new ConeGeometry(.095, .18, 4), C.timber, [x, 1.09, 0], [1, 1, 1], [0, Math.PI / 4, 0]);
  }
  if (!gate) {
    for (const y of [.36, .76]) k.box([.98, .08, .05], [0, y, .08], C.plank, [0, 0, 0], { vary: .06 });
    for (const x of [-.22, 0, .22]) {
      k.box([.1, .8, .04], [x, .45, .04], C.plankLight, [0, 0, 0], { vary: .08 });
      k.add(new ConeGeometry(.07, .12, 4), C.plankLight, [x, .91, .04], [1, 1, .4], [0, Math.PI / 4, 0]);
    }
    return;
  }
  const hinge: V3 = [-.38, 0, 0], open = .85;
  for (const y of [.32, .86]) k.hinged(hinge, open, [.76, .08, .05], [.39, y, 0], C.plank);
  for (const x of [.1, .3, .5, .7]) k.hinged(hinge, open, [.09, .8, .04], [x, .6, .04], C.plankLight, 0, { vary: .08 });
  k.hinged(hinge, open, [.06, .78, .04], [.39, .59, -.04], C.timber, -.95);
  k.hinged(hinge, open, [.08, .05, .07], [.74, .62, 0], C.iron);
}
function lantern(k: Kit) {
  k.box([.32, .14, .32], [0, .07, 0], C.stone, [0, 0, 0], { vary: .05 });
  k.box([.1, 1.72, .1], [0, 1, 0], C.frame);
  k.add(new ConeGeometry(.08, .14, 4), C.frame, [0, 1.93, 0], [1, 1, 1], [0, Math.PI / 4, 0]);
  k.box([.38, .05, .05], [.16, 1.78, 0], C.iron);
  k.box([.02, .12, .02], [.3, 1.7, 0], C.iron);
  k.add(new ConeGeometry(.14, .11, 4), C.iron, [.3, 1.6, 0], [1, 1, 1], [0, Math.PI / 4, 0]);
  k.box([.15, .2, .15], [.3, 1.44, 0], C.glow, [0, 0, 0], { slot: "glow", facets: 0 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box([.025, .24, .025], [.3 + dx * .085, 1.44, dz * .085], C.iron);
  k.box([.2, .03, .2], [.3, 1.32, 0], C.iron);
}
function sign(k: Kit) {
  for (const x of [-.34, .34]) k.box([.08, 1.2, .08], [x, .6, 0], C.timber);
  k.box([.84, .46, .06], [0, .96, .02], C.plankLight, [0, 0, 0], { vary: .05 });
  for (const y of [.73, 1.19]) k.box([.9, .06, .08], [0, y, .02], C.frame);
  for (const [y, w] of [[1.03, .5], [.93, .4], [.84, .3]]) k.box([w, .03, .02], [0, y, .06], C.frame);
  for (const side of [-1, 1]) k.box([.5, .05, .16], [side * .22, 1.3, .02], C.timber, [0, 0, -side * .32]);
}
function planter(k: Kit) {
  for (const z of [-.41, .41]) k.box([.9, .3, .08], [0, .19, z], C.plank, [0, 0, 0], { vary: .07 });
  for (const x of [-.41, .41]) k.box([.08, .3, .74], [x, .19, 0], C.plank, [0, 0, 0], { vary: .07 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box([.11, .4, .11], [x * .42, .2, z * .42], C.frame);
  k.box([.76, .05, .76], [0, .32, 0], C.soil, [0, 0, 0], { facets: .15 });
  for (const [x, z] of [[-.3, -.3], [.3, .3], [.3, -.28]]) k.add(new ConeGeometry(.06, .16, 4), C.leaf, [x, .42, z]);
}
function chair(k: Kit) {
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box([.07, .46, .07], [x * .2, .23, z * .2], C.timber);
  k.box([.52, .07, .52], [0, .49, 0], C.plank, [0, 0, 0], { vary: .05 });
  k.box([.42, .05, .4], [0, .55, .03], C.red, [0, 0, 0], { facets: .12 });
  for (const x of [-.2, .2]) k.box([.07, .62, .07], [x, .82, -.22], C.timber);
  for (const x of [-.1, 0, .1]) k.box([.06, .42, .04], [x, .82, -.22], C.plankLight, [0, 0, 0], { vary: .06 });
  k.box([.52, .09, .08], [0, 1.1, -.22], C.frame);
}
function table(k: Kit) {
  for (const x of [-.3, 0, .3]) k.box([.3, .07, .92], [x, .8, 0], C.plank, [0, 0, 0], { vary: .07 });
  k.box([.82, .1, .82], [0, .71, 0], C.timber);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box([.09, .7, .09], [x * .38, .35, z * .38], C.frame);
  k.box([.7, .05, .05], [0, .2, 0], C.frame);
  k.box([.26, .01, .9], [0, .84, 0], C.cloth);
  k.cyl(.06, .05, .12, 8, [.22, .9, .16], C.clay);
  k.cyl(.13, .09, .05, 10, [-.18, .865, -.12], 0xe7dcc4);
  k.add(new IcosahedronGeometry(.05, 0), C.red, [-.2, .9, -.1]);
  k.add(new IcosahedronGeometry(.05, 0), C.leaf, [-.14, .9, -.14]);
}
function chest(k: Kit) {
  k.box([.82, .42, .52], [0, .23, 0], C.timber, [0, 0, 0], { vary: .04 });
  for (const y of [.12, .26]) k.box([.84, .02, .54], [0, y, 0], C.frame);
  k.add(new CylinderGeometry(.26, .26, .84, 8, 1, false, 0, Math.PI), C.plank, [0, .44, 0], [1, 1, 1], [0, 0, Math.PI / 2]);
  for (const x of [-.29, .29]) {
    k.box([.07, .44, .55], [x, .23, 0], C.iron);
    k.add(new CylinderGeometry(.275, .275, .07, 8, 1, false, 0, Math.PI), C.iron, [x, .44, 0], [1, 1, 1], [0, 0, Math.PI / 2]);
  }
  k.box([.13, .15, .05], [0, .42, .27], C.gold);
  for (const x of [-.36, .36]) k.box([.08, .05, .56], [x, .02, 0], C.frame);
}
function workbench(k: Kit) {
  k.box([1, .1, .58], [0, .82, .06], C.plank, [0, 0, 0], { vary: .05 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box([.09, .78, .09], [x * .42, .39, .06 + z * .22], C.frame);
  k.box([.88, .05, .46], [0, .22, .06], C.timber);
  for (const [i, y] of [.27, .31, .35].entries()) k.box([.6 - i * .08, .04, .14], [-.1 + i * .03, y, .1], C.plankLight, [0, 0, 0], { vary: .08 });
  // Tool board along the back so the working side is unmistakable.
  for (const x of [-.46, .46]) k.box([.07, .7, .07], [x, 1.2, -.24], C.frame);
  k.box([.94, .5, .04], [0, 1.2, -.25], C.timber, [0, 0, 0], { vary: .04 });
  k.box([.3, .11, .01], [-.2, 1.24, -.22], 0xb8bcc0);
  k.box([.08, .06, .03], [-.39, 1.24, -.22], C.frame);
  k.box([.03, .26, .03], [.12, 1.2, -.22], C.timber);
  k.box([.13, .05, .05], [.12, 1.32, -.21], C.iron);
  k.box([.03, .22, .02], [.3, 1.2, -.22], C.iron, [0, 0, .3]);
  k.box([.16, .13, .12], [.37, .93, .34], C.iron);
  k.cyl(.015, .015, .26, 5, [.37, .93, .44], C.iron, [0, Math.PI / 2, Math.PI / 2]);
  k.box([.42, .04, .13], [-.12, .89, .1], C.plankLight, [0, .2, 0]);
  k.box([.05, .05, .2], [.15, .89, .18], C.frame, [0, -.4, 0]);
}
function kiln(k: Kit) {
  k.cyl(.48, .52, .24, 10, [0, .12, 0], C.stone, [0, 0, 0], { vary: .05 });
  k.add(new SphereGeometry(.46, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), C.clay, [0, .24, 0], [1, 1.1, 1]);
  k.cyl(.47, .47, .05, 10, [0, .42, 0], 0xa1603f);
  k.box([.34, .32, .14], [0, .4, .4], 0x3a2a22);
  k.box([.36, .06, .18], [0, .58, .4], C.stoneDark);
  k.box([.26, .2, .04], [0, .37, .46], C.glow, [0, 0, 0], { slot: "glow", facets: 0 });
  k.cyl(.09, .12, .5, 6, [0, .86, -.12], 0xa1603f);
  k.cyl(.12, .12, .05, 6, [0, 1.12, -.12], C.stoneDark);
  for (const [x, y, z] of [[.3, .05, .44], [.4, .05, .38], [.35, .14, .41]]) k.cyl(.05, .05, .36, 6, [x, y, z], C.timber, [Math.PI / 2, .6, 0]);
}
function kitchen(k: Kit) {
  k.box([.9, .56, .7], [0, .28, 0], C.stone, [0, 0, 0], { vary: .06, facets: .14 });
  k.box([.96, .07, .76], [0, .595, 0], C.stoneDark);
  k.box([.44, .28, .06], [0, .2, .33], 0x2f241e);
  k.box([.36, .16, .04], [0, .15, .355], C.glow, [0, 0, 0], { slot: "glow", facets: 0 });
  k.cyl(.19, .15, .22, 10, [-.15, .74, 0], C.iron);
  k.cyl(.21, .21, .03, 10, [-.15, .85, 0], C.iron);
  k.cyl(.18, .18, .01, 10, [-.15, .845, 0], 0x9c5a32);
  k.box([.5, .72, .22], [0, .99, -.24], C.stone, [0, 0, 0], { vary: .06, facets: .14 });
  k.box([.24, .52, .2], [0, 1.6, -.25], C.stoneDark, [0, 0, 0], { facets: .14 });
  k.box([.27, .03, .19], [.25, .645, .12], C.plankLight);
  k.add(new ConeGeometry(.03, .15, 5), 0xef8d34, [.25, .675, .12], [1, 1, 1], [0, 0, Math.PI / 2]);
  k.box([.02, .2, .02], [.18, .95, -.12], C.iron);
  k.cyl(.04, .03, .03, 6, [.18, .84, -.12], C.iron);
}
function stable(k: Kit) {
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box([.1, 1.6, .1], [x * .43, .8, z * .43], C.frame);
  for (const z of [-1, 1]) k.box([1.18, .06, .64], [0, 1.72, z * .27], C.timber, [z * .5, 0, 0], { vary: .05 });
  k.box([1.2, .07, .07], [0, 1.87, 0], C.frame);
  for (const y of [.25, .56, .87]) k.box([.86, .28, .05], [0, y, -.43], C.plank, [0, 0, 0], { vary: .08 });
  for (const y of [.25, .56]) k.box([.05, .28, .8], [-.43, y, 0], C.plank, [0, 0, 0], { vary: .08 });
  k.box([.46, .28, .32], [-.15, .14, -.2], C.hay, [0, .2, 0], { facets: .2 });
  k.box([.6, .18, .22], [.1, .15, .3], C.timber);
  k.box([.52, .02, .15], [.1, .235, .3], C.water, [0, 0, 0], { facets: 0 });
}
function bed(k: Kit) {
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box([.08, .3, .08], [x * .4, .15, z * .45], C.frame);
  k.box([.82, .14, .96], [0, .26, 0], C.timber);
  k.box([.76, .14, .9], [0, .4, 0], C.cloth, [0, 0, 0], { facets: .05 });
  k.box([.8, .1, .6], [0, .45, .16], C.blue, [0, 0, 0], { facets: .08 });
  k.box([.8, .05, .14], [0, .52, -.13], 0x7d95bd);
  k.box([.5, .1, .22], [0, .52, -.32], 0xfaf6ea, [0, 0, 0], { facets: .05 });
  for (const x of [-.43, .43]) k.box([.09, 1.02, .09], [x, .51, -.47], C.frame);
  k.box([.8, .62, .05], [0, .64, -.47], C.timber, [0, 0, 0], { vary: .04 });
  k.box([.92, .08, .09], [0, 1.02, -.47], C.frame);
  for (const x of [-.43, .43]) k.box([.08, .62, .08], [x, .31, .47], C.frame);
  k.box([.8, .3, .04], [0, .44, .47], C.timber);
}
function bench(k: Kit) {
  k.box([.94, .06, .32], [0, .46, .04], C.plank, [0, 0, 0], { vary: .05 });
  for (const x of [-.36, .36]) {
    k.box([.07, .46, .3], [x, .23, .04], C.frame);
    k.box([.06, .52, .06], [x, .72, -.14], C.frame);
  }
  for (const y of [.68, .86]) k.box([.92, .08, .04], [0, y, -.15], C.plankLight, [0, 0, 0], { vary: .06 });
}
function stool(k: Kit) {
  k.cyl(.2, .2, .06, 10, [0, .5, 0], C.plank);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    k.box([.05, .5, .05], [Math.sin(a) * .13, .24, Math.cos(a) * .13], C.frame, [Math.cos(a) * .18, 0, -Math.sin(a) * .18]);
  }
  k.cyl(.12, .12, .03, 8, [0, .2, 0], C.frame);
}
function bookshelf(k: Kit) {
  for (const x of [-.44, .44]) k.box([.06, 1.86, .38], [x, .93, 0], C.timber);
  k.box([.84, 1.86, .03], [0, .93, -.18], C.frame);
  for (const y of [.06, .52, .98, 1.44, 1.84]) k.box([.84, .05, .36], [0, y, 0], C.timber);
  const rand = seeded(11), colors = [C.red, C.blue, C.teal, 0x7a5f8f, C.gold, 0x5c7b49, 0x8e3b2f];
  for (const shelf of [.085, .545, 1.005]) {
    let x = -.39;
    while (x < .36) {
      const w = .05 + rand() * .045, h = .26 + rand() * .12;
      if (rand() < .12 && x < .3) { x += .06; continue; }
      k.box([w - .006, h, .26], [x + w / 2, shelf + h / 2, .02], colors[Math.floor(rand() * colors.length)], [0, 0, 0], { facets: .05 });
      x += w;
    }
  }
  k.cyl(.07, .06, .12, 8, [-.2, 1.53, .02], C.clay);
  k.add(new IcosahedronGeometry(.09, 0), C.leaf, [-.2, 1.63, .02]);
}
function barrel(k: Kit) {
  const profile = Array.from({ length: 7 }, (_, i) => new Vector2(.25 + Math.sin(i / 6 * Math.PI) * .06, i / 6 * .82));
  k.add(new LatheGeometry(profile, 10), C.timber, [0, 0, 0], [1, 1, 1], [0, 0, 0], { facets: .12 });
  k.cyl(.25, .25, .02, 10, [0, .815, 0], C.plank);
  for (const y of [.1, .72]) k.cyl(.285, .285, .04, 10, [0, y, 0], C.iron);
  k.cyl(.315, .315, .04, 10, [0, .41, 0], C.iron);
  k.box([.06, .08, .05], [0, .3, .3], C.frame);
}
function rug(k: Kit) {
  k.box([.92, .012, .72], [0, .156, 0], C.red, [0, 0, 0], { facets: .05 });
  k.box([.72, .014, .52], [0, .158, 0], C.gold, [0, 0, 0], { facets: .05 });
  k.box([.56, .016, .36], [0, .16, 0], C.red, [0, 0, 0], { facets: .05 });
  k.box([.22, .018, .22], [0, .162, 0], C.blue, [0, Math.PI / 4, 0]);
  for (const x of [-.46, .46]) for (let z = -.3; z <= .3; z += .1) k.box([.07, .01, .02], [x + Math.sign(x) * .03, .152, z], C.cloth);
}
function pottedPlant(k: Kit) {
  k.cyl(.17, .13, .3, 8, [0, .15, 0], C.clay, [0, 0, 0], { vary: .04 });
  k.cyl(.19, .19, .05, 8, [0, .3, 0], 0xa5633f);
  k.cyl(.16, .16, .01, 8, [0, .31, 0], C.soil);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2, lean = .35 + (i % 3) * .12;
    k.add(new IcosahedronGeometry(.08, 0), i % 2 ? C.leaf : C.leafDark,
      [Math.sin(a) * .12, .55 + (i % 3) * .07, Math.cos(a) * .12], [.7, 2.3, .7], [Math.cos(a) * lean, 0, -Math.sin(a) * lean]);
  }
  k.add(new IcosahedronGeometry(.13, 0), C.leaf, [0, .72, 0], [1, 1.1, 1]);
}
function floor(k: Kit) {
  k.box([1, .08, 1], [0, .04, 0], C.frame);
  for (let i = 0; i < 5; i++) k.box([.19, .06, .99], [-.4 + i * .2, .11, 0], i % 2 ? C.plank : C.plankLight, [0, 0, 0], { vary: .07, facets: .03 });
}
const BUILDERS: Record<string, (k: Kit) => void> = {
  floor, wall: timberWall, brick_wall: brickWall, window: windowWall, door: doorWall,
  fence: k => fence(k, false), gate: k => fence(k, true), lamp: lantern, sign, planter, chair, table, chest,
  workbench, kiln, kitchen, stable, bed, bench, stool, bookshelf, barrel, rug, potted_plant: pottedPlant,
};
export const hasPieceArt = (piece: string) => piece === "roof" || piece in BUILDERS;
const cache = new Map<string, Partial<Record<Slot, BufferGeometry>>>();
export function pieceGeometry(piece: string) {
  let geometry = cache.get(piece);
  if (!geometry) {
    const kit = new Kit(seeded(piece.length * 97 + piece.charCodeAt(0)));
    (BUILDERS[piece] ?? table)(kit);
    geometry = kit.build();
    cache.set(piece, geometry);
  }
  return geometry;
}

const solid = (opacity = 1) => new MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: .86,
  transparent: opacity < 1, opacity, depthWrite: opacity === 1,
});
const MATERIALS = {
  body: { normal: solid(), ghost: solid(.5), fade: solid(.28) },
  glow: {
    normal: new MeshStandardMaterial({ vertexColors: true, emissive: 0xf0a048, emissiveIntensity: .9, roughness: .5 }),
    ghost: solid(.5), fade: solid(.28),
  },
  glass: {
    normal: new MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: .45, roughness: .1, metalness: .2, depthWrite: false }),
    ghost: solid(.3), fade: solid(.2),
  },
};
const roofMaterials = {
  normal: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .95, side: DoubleSide }),
  ghost: new MeshStandardMaterial({ vertexColors: true, flatShading: true, side: DoubleSide, transparent: true, opacity: .5, depthWrite: false }),
  fade: new MeshStandardMaterial({ vertexColors: true, flatShading: true, side: DoubleSide, transparent: true, opacity: .14, depthWrite: false }),
};
export type PieceLook = keyof typeof roofMaterials;
export const FADING_PIECES = new Set(["wall", "brick_wall", "window", "door"]);

export function PieceMesh({ piece, look = "normal" }: { piece: string; look?: PieceLook }) {
  if (piece === "roof") return <RoofMesh tiles={[{ x: 0, z: 0 }]} look={look} />;
  const geometry = pieceGeometry(piece);
  return <>
    {(Object.keys(geometry) as Slot[]).map(slot => (
      <mesh key={slot} geometry={geometry[slot]} material={MATERIALS[slot][look]}
        castShadow={look === "normal" && slot === "body"} receiveShadow={slot === "body"} />
    ))}
  </>;
}

const tileKey = (p: Point) => `${p.x},${p.z}`;
/**
 * One hipped roof over every connected roof tile: each tile is a fan of
 * triangles whose height follows the L∞ distance to the roof's outline, so
 * rectangles get ridges and hips and L-shapes get valleys. Wide roofs flatten
 * at ROOF_MAX_RISE. Outline vertices are pushed out and lowered into eaves.
 * Coordinates are tile coordinates with y up; `only` emits just that tile.
 */
export function roofGeometry(tiles: readonly Point[], only?: Point): BufferGeometry {
  const set = new Set(tiles.map(tileKey));
  const has = (x: number, z: number) => set.has(`${x},${z}`);
  const reach = Math.ceil(ROOF_MAX_RISE / ROOF_PITCH) + 1;
  const inset = (x: number, z: number) => {
    let d = ROOF_MAX_RISE / ROOF_PITCH;
    for (let qz = Math.floor(z) - reach; qz <= Math.ceil(z) + reach; qz++)
      for (let qx = Math.floor(x) - reach; qx <= Math.ceil(x) + reach; qx++)
        if (!has(qx, qz)) d = Math.min(d, Math.max(Math.abs(x - qx) - .5, Math.abs(z - qz) - .5, 0));
    return d;
  };
  const vertex = (x: number, z: number): [number, number, number] => {
    // Tiles touching this sample point, with the direction from the point to each.
    const fx = Math.abs(x - Math.round(x)) > .25, fz = Math.abs(z - Math.round(z)) > .25;
    const around: [number, number][] = fx && fz ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : fx ? [[-1, 0], [1, 0]] : fz ? [[0, -1], [0, 1]] : [];
    let px = 0, pz = 0;
    for (const [dx, dz] of around) if (!has(Math.round(x + dx * .5), Math.round(z + dz * .5))) { px += dx; pz += dz; }
    const push = px || pz ? 1 : 0;
    return [x + Math.sign(px) * ROOF_OVERHANG, ROOF_BASE + ROOF_PITCH * (inset(x, z) - push * ROOF_OVERHANG), z + Math.sign(pz) * ROOF_OVERHANG];
  };
  const ring: [number, number][] = [[-.5, -.5], [0, -.5], [.5, -.5], [.5, 0], [.5, .5], [0, .5], [-.5, .5], [-.5, 0]];
  const positions: number[] = [], colors: number[] = [];
  const rand = seeded(tiles.length * 31 + 5), color = new Color();
  const thatch = linear(C.thatch), moss = linear(0x8f9a4e), fascia = linear(C.frame);
  const face = (a: number[], b: number[], c: number[], tint: Color) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(tint.r, tint.g, tint.b);
  };
  const shade = (y: number) => {
    // Bands by height read as courses of thatch; a few tufts are mossier.
    const band = Math.floor((y - ROOF_BASE + ROOF_OVERHANG) * 5) % 2;
    color.copy(thatch);
    if (rand() < .05) color.lerp(moss, .35);
    color.multiplyScalar(.84 + band * .09 + rand() * .07);
    return color;
  };
  const mid = (a: number[], b: number[]) => a.map((v, i) => (v + b[i]) / 2);
  for (const t of only ? [only] : tiles) {
    const centre = vertex(t.x, t.z);
    const edge = ring.map(([ox, oz]) => vertex(t.x + ox, t.z + oz));
    for (let i = 0; i < 8; i++) {
      const a = edge[(i + 1) % 8], b = edge[i];
      // Split each fan triangle in four so thatch courses can follow the slope.
      const ab = mid(a, b), bc = mid(b, centre), ca = mid(centre, a);
      for (const [p, q, r] of [[centre, ca, bc], [ca, a, ab], [bc, ab, b], [ca, ab, bc]])
        face(p, q, r, shade((p[1] + q[1] + r[1]) / 3));
    }
    // Fascia boards under exposed eaves.
    for (let side = 0; side < 4; side++) {
      const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][side];
      if (has(t.x + dx, t.z + dz)) continue;
      for (const [p, q] of [[edge[side * 2], edge[side * 2 + 1]], [edge[side * 2 + 1], edge[(side * 2 + 2) % 8]]]) {
        const p2 = [p[0], p[1] - .16, p[2]], q2 = [q[0], q[1] - .16, q[2]];
        face(p, p2, q2, fascia);
        face(p, q2, q, fascia);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function RoofMesh({ tiles, only, look = "normal", at = [0, 0, 0] }: { tiles: readonly Point[]; only?: Point; look?: PieceLook; at?: V3 }) {
  const key = tiles.map(tileKey).sort().join(";") + (only ? `|${tileKey(only)}` : "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => roofGeometry(tiles, only), [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh position={at} geometry={geometry} material={roofMaterials[look]} castShadow={look === "normal"} receiveShadow />;
}

/** A flat arrow on the placement marker showing which way a piece will face. */
const arrowGeometry = (() => {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([0, 0, .46, -.16, 0, .22, .16, 0, .22, -.06, 0, .22, .06, 0, .22, -.06, 0, .06, .06, 0, .22, .06, 0, .06, -.06, 0, .06], 3));
  g.computeVertexNormals();
  return g;
})();
export function FacingArrow({ valid }: { valid: boolean }) {
  return <mesh geometry={arrowGeometry} position={[0, .03, 0]}>
    <meshBasicMaterial color={valid ? "#2f7d57" : "#8c2f2f"} side={DoubleSide} />
  </mesh>;
}
export const isCentred = (piece: string) => !!PIECES[piece] && !PIECES[piece].edge;
