import { ConeGeometry, CylinderGeometry, DodecahedronGeometry, IcosahedronGeometry, MeshStandardMaterial, OctahedronGeometry } from 'three';
import { merged, part, withWind } from '../envArt';

/**
 * Low-poly, vertex-coloured scenery trees, one geometry per biome style
 * (expanse.ts BiomeDef.trees). Each style is one instanced draw per chunk.
 */
export type TreeStyle = 'broadleaf' | 'pine' | 'snowpine' | 'willow' | 'palm' | 'crystal';
const wood = 0x816145;

/** The island's tree, unchanged (also the Meadows' fir). */
export const forestGeo = merged([
  part(new CylinderGeometry(.12, .25, 2.1, 5), wood, [0, 1, 0]),
  ...[0, 1, 2].map(i => part(new ConeGeometry(1.45 - i * .29, 2.25 - i * .25, 7), [0x355e40, 0x477e4e, 0x669656][i], [0, 2 + i * .72, 0], [1, 1, 1], [0, i * .7, 0], .13, i + 1)),
]);
const vertexMat = () => new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
export const forestMat = withWind(vertexMat(), .013, 1.6);

const PINE_GREENS = [0x2b4a37, 0x335640, 0x3c6449, 0x477352];
const pineTiers = (snow: boolean) => [0, 1, 2, 3].flatMap(i => {
  const r = 1.15 - i * .23, h = 1.75 - i * .18, y = 1.7 + i * .78;
  const tier = part(new ConeGeometry(r, h, 6), PINE_GREENS[i], [0, y, 0], [1, 1, 1], [0, i * .9, 0], .12, i + 3);
  if (!snow) return [tier];
  // A snow cap over the upper part of each tier, and a dusting along its rim.
  return [tier,
    part(new ConeGeometry(r * .62, h * .5, 6), 0xf3f7fa, [0, y + h * .27, 0], [1, 1, 1], [0, i * .9, 0], .06, i + 13),
    part(new ConeGeometry(r * 1.02, h * .16, 6), 0xe6eef3, [0, y - h * .38, 0], [1, 1, 1], [0, i * .9, 0], .05, i + 23)];
});
export const pineGeo = merged([part(new CylinderGeometry(.11, .22, 1.9, 5), 0x6e5038, [0, .95, 0]), ...pineTiers(false)]);
export const snowPineGeo = merged([part(new CylinderGeometry(.11, .22, 1.9, 5), 0x6e5038, [0, .95, 0]), ...pineTiers(true)]);

/** A fen willow: a stout leaning trunk, a low dome and drooping curtains. */
export const willowGeo = merged([
  part(new CylinderGeometry(.2, .36, 2.3, 6), 0x6a5540, [.12, 1.1, 0], [1, 1, 1], [0, 0, -.1]),
  part(new IcosahedronGeometry(1.75, 0), 0x6f8f4a, [.3, 2.75, 0], [1, .55, 1], [0, .3, 0], .14, 5),
  part(new IcosahedronGeometry(1.2, 0), 0x86a457, [.2, 3.25, .1], [1, .5, 1], [0, 1.1, 0], .12, 6),
  ...Array.from({ length: 11 }, (_, i) => {
    const a = i / 11 * Math.PI * 2, r = 1.45 + (i % 3) * .12;
    return part(new ConeGeometry(.26, 1.9 + (i % 2) * .5, 4), i % 2 ? 0x7e9b52 : 0x5f7f3e, [.3 + Math.cos(a) * r, 1.75 - (i % 2) * .25, Math.sin(a) * r], [1, 1, .6], [Math.PI, a, 0], .12, 30 + i);
  }),
]);

/** A palm (trunk and fronds merged): beaches on the island, the dunes and the oasis. */
export const palmGeo = merged([
  ...[0, 1, 2, 3, 4].map((i) => part(new ConeGeometry(.2 - i * .02, .75, 6).translate(0, .37, 0), i % 2 ? 0x9a7a52 : 0x7d5e3c, [i * i * .045, i * .66, 0], [1, 1, 1], [0, 0, -i * .09], .12, i)),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => part(new OctahedronGeometry(1, 0).scale(.95, .07, .26).translate(.95, 0, 0).rotateZ(-.35 - (i % 2) * .25).rotateY(i / 8 * Math.PI * 2), i % 2 ? 0x3e8e41 : 0x5aa84a, [.75, 3.35, 0], [1, 1, 1], [0, 0, 0], .2, 10 + i)),
  ...[0, 1, 2].map((i) => part(new IcosahedronGeometry(.16, 0), 0x7a5a2e, [.75 + Math.cos(i * 2.1) * .2, 3.15, Math.sin(i * 2.1) * .2], [1, 1, 1], [0, 0, 0], .1, 30 + i)),
]);
export const palmMat = withWind(vertexMat(), .018, 1.5);

/** Starfall's crystal spires: a cluster of glassy shards on a basalt foot. */
export const crystalGeo = merged([
  part(new DodecahedronGeometry(.8, 0), 0x3b3542, [0, .2, 0], [1.2, .45, 1.1], [0, .4, 0], .2, 1),
  part(new OctahedronGeometry(1, 0), 0xb79cff, [0, 2.1, 0], [.42, 2.2, .42], [0, .3, .05], .16, 2),
  part(new OctahedronGeometry(1, 0), 0x86e3ff, [.55, 1.3, .25], [.3, 1.35, .3], [.15, 1.1, -.35], .16, 3),
  part(new OctahedronGeometry(1, 0), 0xe1b3ff, [-.5, 1.1, -.2], [.28, 1.15, .28], [-.2, .2, .4], .16, 4),
  part(new OctahedronGeometry(1, 0), 0x9d86f0, [.1, .8, -.6], [.22, .8, .22], [-.4, .7, .1], .16, 5),
]);
export const crystalMat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .35, metalness: .1, emissive: '#5a3a9a', emissiveIntensity: .45 });

export const TREE_ART: Record<TreeStyle, { geometry: typeof forestGeo; material: MeshStandardMaterial }> = {
  broadleaf: { geometry: forestGeo, material: forestMat },
  pine: { geometry: pineGeo, material: forestMat },
  snowpine: { geometry: snowPineGeo, material: forestMat },
  willow: { geometry: willowGeo, material: withWind(vertexMat(), .02, 1.4) },
  palm: { geometry: palmGeo, material: palmMat },
  crystal: { geometry: crystalGeo, material: crystalMat },
};
