import { BoxGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, IcosahedronGeometry, MeshStandardMaterial, OctahedronGeometry } from 'three';
import { merged, part } from '../envArt';

/** The mainland's props: waystones, town dressing and the ledger clerks' desks. Low-poly, vertex-coloured. */
const box = (color: number, p: [number, number, number], s: [number, number, number], r: [number, number, number] = [0, 0, 0]) => part(new BoxGeometry(1, 1, 1), color, p, s, r, .08, Math.round(p[0] * 31 + p[1] * 99 + p[2] * 17));
const wood = 0x816145, paleWood = 0xba9160, stone = 0x959482, darkStone = 0x6f6d64, roof = 0x59796a;

export const propMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
/** Waystone runes glow faintly (emissive vertex colour, no light). */
export const glowMat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .4, emissive: '#7fe3ff', emissiveIntensity: .9, toneMapped: false });

/** A tall standing stone on a stepped plinth; the rune band is the glowing part (waystoneGlowGeo). */
export const waystoneGeo = merged([
  part(new CylinderGeometry(.95, 1.1, .22, 7), darkStone, [0, .11, 0], [1, 1, 1], [0, 0, 0], .1, 1),
  part(new CylinderGeometry(.7, .8, .18, 7), stone, [0, .3, 0], [1, 1, 1], [0, .3, 0], .1, 2),
  part(new BoxGeometry(1, 1, 1), 0x8b8a80, [0, 1.35, 0], [.55, 2.1, .38], [0, .2, .04], .12, 3),
  part(new OctahedronGeometry(.32, 0), 0x8b8a80, [0, 2.45, 0], [1, .7, .8], [0, .2, 0], .1, 4),
]);
export const waystoneGlowGeo = merged([
  ...[.75, 1.25, 1.75].map((y, i) => part(new BoxGeometry(1, 1, 1), 0x9ff0ff, [0, y, 0], [.58, .07, .41], [0, .2, .04], 0, 10 + i)),
  part(new OctahedronGeometry(.18, 0), 0xd8fbff, [0, 2.95, 0], [1, 1.4, 1], [0, 0, 0], 0, 20),
]);

/** A market stall: counter, four posts and a striped awning. */
export const stallGeo = (stripe: number) => merged([
  box(wood, [0, .45, 0], [1.9, .9, .8]), box(paleWood, [0, .93, 0], [2, .08, .9]),
  ...[-.9, .9].flatMap(x => [-.4, .4].map(z => box(wood, [x, 1.05, z], [.1, 2.1, .1]))),
  ...[0, 1, 2, 3, 4].map(i => box(i % 2 ? 0xf4ead2 : stripe, [-.84 + i * .42, 2.12, .05], [.42, .08, 1.15], [.18, 0, 0])),
  box(0xd9b25c, [-.5, 1.05, 0], [.35, .22, .35]), box(0xc0563c, [.35, 1.06, .05], [.4, .24, .3]),
]);
/** Kingsgate's gatehouse: two towers and a roofed beam over the road (the road runs through along x). */
export const gatehouseGeo = merged([
  ...[-3.1, 3.1].flatMap(z => [
    box(stone, [0, 1.6, z], [1.7, 3.2, 1.5]), box(darkStone, [0, 3.35, z], [1.95, .3, 1.75]),
    ...[-.65, .65].flatMap(x => [-.55, .55].map(dz => box(stone, [x, 3.7, z + dz], [.4, .4, .4]))),
    box(0x344e4b, [.86, 1.9, z], [.05, .6, .35]),
  ]),
  box(stone, [0, 3.65, 0], [1.5, .8, 4.8]), box(roof, [-.45, 4.3, 0], [1.1, .14, 5.1], [.0, 0, .5]), box(roof, [.45, 4.3, 0], [1.1, .14, 5.1], [0, 0, -.5]),
  box(0xb24a3a, [.78, 2.9, 0], [.06, 1, .9]), box(0xe8ba64, [.8, 2.9, 0], [.04, .3, .3]),
]);
/** Fenhold's stilt hut: a reed-thatched hut on posts with a little ladder. */
export const stiltHutGeo = merged([
  ...[-.85, .85].flatMap(x => [-.75, .75].map(z => box(wood, [x, .7, z], [.14, 1.6, .14]))),
  box(paleWood, [0, 1.45, 0], [2.1, .12, 1.9]),
  box(0x9a7a52, [0, 2.05, 0], [1.6, 1.1, 1.4]), box(0x2c241b, [0, 1.95, .71], [.45, .7, .03]),
  part(new ConeGeometry(1.55, 1.25, 4), 0xb59a5c, [0, 3.2, 0], [1, 1, 1], [0, Math.PI / 4, 0], .12, 7),
  ...[0, 1, 2].map(i => box(wood, [0, .35 + i * .4, 1.2], [.6, .06, .1])), ...[-.28, .28].map(x => box(wood, [x, .6, 1.2], [.06, 1.3, .06])),
]);
/** A jagged rim stone for the crater. */
export const rimStoneGeo = merged([
  part(new DodecahedronGeometry(1, 0), 0x4d4652, [0, .7, 0], [.8, 1.5, .7], [.1, .4, -.12], .2, 1),
  part(new DodecahedronGeometry(.6, 0), 0x3b3542, [.55, .3, .3], [1, .8, 1], [0, 1, 0], .2, 2),
  part(new IcosahedronGeometry(.25, 0), 0x6b3b3a, [-.3, .12, .45], [1, .6, 1], [0, 0, 0], .1, 3),
]);
/** Rimewatch: a slim stone watchtower. */
export const watchtowerGeo = merged([
  part(new CylinderGeometry(.75, .95, 4.2, 8), 0xa9a596, [0, 2.1, 0], [1, 1, 1], [0, 0, 0], .08, 1),
  part(new CylinderGeometry(1, 1, .3, 8), stone, [0, 4.35, 0], [1, 1, 1], [0, 0, 0], .08, 2),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => box(stone, [Math.cos(i * Math.PI / 4) * .85, 4.7, Math.sin(i * Math.PI / 4) * .85], [.3, .4, .3])),
  part(new ConeGeometry(1.15, 1.2, 8), 0x50606e, [0, 5.6, 0], [1, 1, 1], [0, 0, 0], .1, 3),
  box(0x344e4b, [0, 2.7, .82], [.3, .55, .05]),
]);
/** A ledger clerk's desk: a slanted lectern-desk with an open ledger book, a stool and a sign. */
export const clerkDeskGeo = merged([
  box(wood, [0, .42, 0], [1.3, .84, .7]), box(paleWood, [0, .88, 0], [1.4, .08, .8], [-.18, 0, 0]),
  box(0x7a2e2e, [-.02, .95, .02], [.7, .05, .48], [-.18, 0, 0]),
  box(0xf4ead2, [-.19, .99, .02], [.32, .03, .44], [-.18, 0, .08]), box(0xf4ead2, [.15, .99, .02], [.32, .03, .44], [-.18, 0, -.08]),
  box(0x2c241b, [.42, .96, -.18], [.06, .14, .06]),
  box(wood, [0, .27, -.75], [.45, .06, .45]), ...[-.17, .17].flatMap(x => [-.92, -.58].map(z => box(wood, [x, .13, z], [.06, .26, .06]))),
  box(wood, [.75, .85, .2], [.08, 1.7, .08]), box(0xe8ba64, [.75, 1.55, .3], [.06, .42, .62]), box(0x7a2e2e, [.79, 1.55, .3], [.02, .14, .22]),
]);
/** A plain signpost for every mainland landmark. */
export const signpostGeo = merged([
  box(wood, [0, .75, 0], [.12, 1.5, .12]),
  box(paleWood, [.32, 1.28, 0], [.7, .24, .08], [0, 0, .04]), box(paleWood, [-.25, 1.0, .02], [.6, .2, .08], [0, .5, -.05]),
]);
