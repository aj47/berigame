import { ConeGeometry, CylinderGeometry, IcosahedronGeometry, MeshStandardMaterial, OctahedronGeometry } from 'three';
import { merged, part, withWind } from '../envArt';

/** The Expanse's ground cover, low-poly and vertex-coloured like the island's tufts. */
export const dryTuftGeo = merged([0, 1, 2, 3].map((i) => part(new ConeGeometry(.28, 1, 3).translate(0, .5, 0), [0xd9c27a, 0xc4a65a, 0xe6d391, 0xb8955a][i], [(i - 1.5) * .18, 0, (i % 2) * .14 - .07], [1, i % 2 ? 1.2 : .8, 1], [0, i * 1.3, (i - 1.5) * .45], .2, i)));
export const snowTuftGeo = merged([
  part(new IcosahedronGeometry(.55, 0), 0xf4f8fb, [0, .05, 0], [1, .38, .85], [0, .3, 0], .08, 1),
  ...[0, 1, 2].map((i) => part(new ConeGeometry(.16, .8, 3).translate(0, .4, 0), i === 1 ? 0x5d8a76 : 0x46705e, [(i - 1) * .2, .1, (i % 2) * .1], [1, i === 1 ? 1.1 : .8, 1], [0, i, (i - 1) * .3], .15, i + 2)),
]);
/** A reed clump: tall blades, three with cattail heads. */
export const reedGeo = merged([
  ...[0, 1, 2, 3, 4].map((i) => part(new ConeGeometry(.08, 2.4, 3).translate(0, 1.2, 0), i % 2 ? 0x7c9a4e : 0x627f3c, [Math.cos(i * 1.3) * .22, 0, Math.sin(i * 1.3) * .22], [1, .75 + (i % 3) * .2, 1], [Math.sin(i) * .12, 0, Math.cos(i * 2) * .14], .15, i)),
  ...[0, 2, 4].map((i) => part(new CylinderGeometry(.07, .07, .4, 5), 0x6b4a2c, [Math.cos(i * 1.3) * .22, 2.0 + (i % 3) * .1, Math.sin(i * 1.3) * .22], [1, 1, 1], [0, 0, 0], .1, 10 + i)),
]);
/** A small saguaro-ish cactus. */
export const cactusGeo = merged([
  part(new CylinderGeometry(.2, .24, 2, 6).translate(0, 1, 0), 0x5f8f46, [0, 0, 0], [1, 1, 1], [0, 0, 0], .1, 1),
  part(new CylinderGeometry(.12, .14, .8, 6).translate(0, .4, 0), 0x6b9a4f, [.32, .75, 0], [1, 1, 1], [0, 0, -.25], .1, 2),
  part(new CylinderGeometry(.11, .13, .65, 6).translate(0, .32, 0), 0x6b9a4f, [-.3, 1.05, 0], [1, 1, 1], [0, 0, .3], .1, 3),
  part(new IcosahedronGeometry(.13, 0), 0xf472b6, [0, 2.02, 0], [1, .7, 1], [0, 0, 0], .1, 4),
]);
/** A crystal shard poking out of the ash. */
export const shardGeo = merged([
  part(new OctahedronGeometry(1, 0), 0xc4a8ff, [0, .9, 0], [.35, 1.2, .35], [.12, 0, .1], .2, 1),
  part(new OctahedronGeometry(1, 0), 0x8fe6ff, [.32, .45, .1], [.2, .6, .2], [0, .6, -.4], .2, 2),
]);

export const dryTuftMat = withWind(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }), .07, 0);
export const reedMat = withWind(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }), .05, 0);
export const staticMat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
export const shardMat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .35, emissive: '#5a3a9a', emissiveIntensity: .5 });
