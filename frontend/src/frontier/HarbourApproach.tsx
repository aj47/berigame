import React, { useEffect, useMemo } from 'react';
import { BoxGeometry, BufferGeometry, CanvasTexture, ConeGeometry, IcosahedronGeometry, MeshStandardMaterial, sRGBEncoding } from 'three';
import { merged, part } from '../Components/3D/envArt';
import { islandGrassGeometry, islandGrassMaterial, islandFlowerGeometry, islandFlowerMaterial } from '../Components/3D/IslandDetails';
import { linear } from '../Components/3D/nodes/lowPoly';
import { AdventureAssetView } from '../Components/3D/AdventureModels';

const noRaycast = () => null;
const timber = new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
const lantern = new MeshStandardMaterial({ color: linear(0xffdd8e), emissive: linear(0xe7ac4e), emissiveIntensity: .35, roughness: .8 });

/** Low roadside details make the continuous harbour trail feel inhabited. */
const approach = (() => {
  const solid: BufferGeometry[] = [], plants: BufferGeometry[] = [], flowers: BufferGeometry[] = [];
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, angle = 0) =>
    solid.push(part(new BoxGeometry(sx, sy, sz), color, [x - 25, y, z - 25], [1, 1, 1], [0, angle, 0], .08));
  // Low split-rail fences sit beside the road and keep the entrance open.
  for (const z of [22.5, 27.5]) {
    for (const x of [65.7, 67.25, 68.8]) {
      box(x, .44, z, .14, .88, .14, 0x806044);
      solid.push(part(new ConeGeometry(.13, .18, 4), 0xb39360, [x - 25, .94, z - 25], [1, 1, 1], [0, Math.PI / 4, 0]));
    }
    box(67.25, .52, z, 3.1, .13, .09, 0xb59a6c);
    box(67.25, .25, z, 3.1, .1, .09, 0xa98b5f);
  }
  // A few worn stones disappear into the same dirt trail as Bramblewild.
  for (let i = 0; i < 16; i++) {
    const x = 60.5 + (i % 8) * 1.4 + Math.sin(i * 4.2) * .3;
    const z = 24.55 + Math.floor(i / 8) * .78 + Math.cos(i * 1.7) * .35;
    solid.push(part(new IcosahedronGeometry(1, 0), i % 3 ? 0xb3aa8c : 0x959482,
      [x - 25, .022, z - 25], [.32 + (i % 3) * .06, .045, .25], [0, i * .7, 0], .12, i + 1));
  }
  // Coastal clusters bridge the old island's vegetation and the meadow groves.
  for (let i = 0; i < 36; i++) {
    const x = 50 + (i % 18) * 1.25 + Math.sin(i * 2.8) * .4;
    const z = (i < 18 ? 21.65 : 28.35) + Math.cos(i * 2.1) * .55;
    const size = .11 + (i % 4) * .045;
    if (i % 3 === 0) solid.push(part(new IcosahedronGeometry(1, 0), 0xb3aa8c,
      [x - 25, .05, z - 25], [size * 1.8, size * .75, size], [0, i, 0], .15, i + 8));
    const scale = .22 + (i % 4) * .04;
    plants.push(islandGrassGeometry.clone().scale(scale, scale, scale).rotateY(i * 1.7).translate(x - 25, 0, z - 25));
    if (i % 5 === 0) {
      flowers.push(islandFlowerGeometry.clone().scale(.24, .24, .24).rotateY(i).translate(x - 24.7, 0, z - 25.2));
    }
  }
  const geometry = merged(solid), greenery = merged(plants), blossoms = merged(flowers);
  [...solid, ...plants, ...flowers].forEach(g => g.dispose());
  return { geometry, greenery, blossoms };
})();

const welcome = (() => {
  const pieces: BufferGeometry[] = [];
  const box = (color: number, position: [number, number, number], scale: [number, number, number], angle = 0) =>
    pieces.push(part(new BoxGeometry(1, 1, 1), color, position, scale, [0, 0, angle], .07));
  for (const side of [-1, 1]) {
    box(0x866347, [side * 2.1, 1.55, 0], [.22, 3.1, .24]);
    box(0xb59a70, [side * 2.1, .14, 0], [.43, .28, .4]);
    box(0x9b7952, [side * 1.78, 2.85, 0], [.12, 1, .14], -side * Math.PI / 4);
    box(0x514b37, [side * 1.65, 2.78, 0], [.035, .46, .035]);
    box(0x514b37, [side * 1.65, 2.47, 0], [.25, .06, .25]);
    box(0x514b37, [side * 1.65, 2.18, 0], [.25, .06, .25]);
  }
  box(0xa28053, [0, 3.08, 0], [4.8, .24, .3], -.018);
  box(0x3c6850, [0, 3.02, .19], [2.85, .65, .12]);
  box(0x688453, [0, 3.41, .17], [3.12, .12, .34]);
  for (let i = 0; i < 12; i++) {
    const x = -2.23 + i * .4;
    pieces.push(part(new IcosahedronGeometry(.22, 0), i % 3 ? 0x3e8e41 : 0x6cb85a,
      [x, 3.35 + Math.sin(i * 1.6) * .12, -.04], [1.2, .6, 1], [0, i, 0]));
  }
  const geometry = merged(pieces);
  pieces.forEach(g => g.dispose());
  return geometry;
})();

export default function HarbourApproach() {
  const sign = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 768; canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#3c6850'; ctx.fillRect(0, 0, 768, 160);
    ctx.strokeStyle = '#b0bf8a'; ctx.lineWidth = 3; ctx.strokeRect(12, 12, 744, 136);
    ctx.font = 'bold 62px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f7e7bd'; ctx.fillText('THE MEADOWS', 384, 83);
    const texture = new CanvasTexture(canvas); texture.encoding = sRGBEncoding;
    return texture;
  }, []);
  useEffect(() => () => sign.dispose(), [sign]);
  return <group>
    <mesh geometry={approach.geometry} material={timber} raycast={noRaycast} receiveShadow />
    <mesh geometry={approach.greenery} material={islandGrassMaterial} raycast={noRaycast} dispose={null} />
    <mesh geometry={approach.blossoms} material={islandFlowerMaterial} raycast={noRaycast} dispose={null} />
    <group position={[44, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
      <mesh geometry={welcome} material={timber} raycast={noRaycast} castShadow />
      {[-1, 1].map(side => <React.Fragment key={side}>
        <mesh position={[side * 1.65, 2.32, 0]} material={lantern} raycast={noRaycast}>
          <boxGeometry args={[.18, .24, .18]} />
        </mesh>
        <mesh position={[0, 3.02, side * .26]} rotation={[0, side === 1 ? 0 : Math.PI, 0]} raycast={noRaycast}>
          <planeGeometry args={[2.75, .56]} /><meshStandardMaterial map={sign} roughness={1} />
        </mesh>
      </React.Fragment>)}
    </group>
    <group position={[27, 0, 2.5]} rotation={[0, .6, 0]} scale={.8}>
      <AdventureAssetView asset="handcart" />
    </group>
  </group>;
}
