import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, MeshStandardMaterial } from 'three';
import { merged, part } from '../Components/3D/envArt';
import { islandForestGeometry, islandForestMaterial } from '../Components/3D/IslandLandmarks';
import { islandFlowerGeometry, islandFlowerMaterial, islandGrassGeometry, islandGrassMaterial, islandStoneGeometry, islandStoneMaterial } from '../Components/3D/IslandDetails';
import { berryBodyMaterial, getBerryShape } from '../Components/3D/BerryTree';

// Use Bramblewild's actual meshes and materials so the trail stays in one woodland.
// Smaller firs and berry-free understory vary the groves without a second art style.
export const meadowGeometry = {
  fir: islandForestGeometry,
  sapling: islandForestGeometry.clone().scale(.57, .65, .57),
  shrub: getBerryShape('berry_strawberry').body.clone().scale(.55, .48, .55),
  grass: islandGrassGeometry,
  flowers: islandFlowerGeometry,
  rock: islandStoneGeometry,
};

export type MeadowShape = keyof typeof meadowGeometry;
export const meadowMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
export const meadowMaterials = {
  fir: islandForestMaterial,
  sapling: islandForestMaterial,
  shrub: berryBodyMaterial,
  grass: islandGrassMaterial,
  flowers: islandFlowerMaterial,
  rock: islandStoneMaterial,
};

// Ground resources use the angular shapes, bark and mineral colours of the
// original island's harvest nodes.
export const meadowResourceGeometry = {
  // Same angular woodland palette, with a higher crown and pale forester's
  // band around the exposed trunk so usable timber is visible without labels.
  timber: merged([
    part(new CylinderGeometry(.16,.28,2.5,7),0x816145,[0,1.25,0]),
    ...[0,1,2].map(i => part(new ConeGeometry(1.35-i*.27,1.8-i*.18,7),
      [0x477e4e,0x669656,0x80a760][i],[0,2.65+i*.6,0],[1,1,1],[0,i*.7,0],.13,i+1)),
    part(new CylinderGeometry(.243,.26,.18,7),0xe1c48b,[0,.78,0]),
    part(new BoxGeometry(.11,.27,.055),0xf0dbad,[.035,.62,.248],[1,1,1],[0,0,.15]),
  ]),
  fibre: merged([-1, 0, 1].map(i => part(new ConeGeometry(.24, 1.15 + i * .12, 3),
    i === 0 ? 0x5fa23c : 0x3f7f2e, [i * .27, .55, Math.abs(i) * .1], [1, 1, 1], [0, i, i * -.2], .18, i + 4))),
  clay: merged([-1, 0, 1].map(i => part(new IcosahedronGeometry(.55, 0),
    i === 0 ? 0xad795a : 0xc2926e, [i * .4, .2, Math.abs(i) * .17], [1, .55, .8], [0, i * 1.1, 0], .12, i + 3))),
  stone: merged([-1, 0, 1].map(i => part(new IcosahedronGeometry(.63, 0),
    i === 0 ? 0x959482 : 0xb3aa8c, [i * .4, .25, Math.abs(i) * .17], [1, .6, .8], [0, i * 1.1, 0], .15, i + 2))),
  iron: merged([
    part(new IcosahedronGeometry(.72, 0), 0x77736b, [0, .35, 0], [1.15, .7, 1], [0, .4, 0], .15),
    ...[-1, 0, 1].map(i => part(new BoxGeometry(.15, .12, .17), 0x8f6651, [i * .24, .52 - Math.abs(i) * .08, .34], [1, 1, 1], [0, i, .3], .12, i + 2)),
  ]),
};
