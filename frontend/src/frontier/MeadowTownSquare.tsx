import React from 'react';
import { BufferGeometry, IcosahedronGeometry, MeshStandardMaterial } from 'three';
import { merged, part } from '../Components/3D/envArt';

const paving = (() => {
  const pieces: BufferGeometry[] = [];
  // Worn stones sit in the existing dirt clearing, with grass and earth showing
  // between them. The workshop reads as an island camp rather than a paved plaza.
  const steps = [
    [-2.1, -.3], [-1.25, .1], [-.4, -.15], [.55, .22], [1.4, -.12],
    [.65, -1.05], [1.2, -1.85], [1.7, -2.6], [1.05, 1.08], [1.55, 1.92], [2.05, 2.62],
  ];
  steps.forEach(([x, z], i) => pieces.push(part(new IcosahedronGeometry(1, 0),
    i % 3 === 0 ? 0xb3aa8c : 0x959482, [x, .024, z], [.45 + i % 3 * .04, .05, .32], [0, i * 1.3, 0], .12, i + 2)));
  for (let i = 0; i < 12; i++) {
    const x = Math.sin(i * 7.3) * 2.5, z = Math.cos(i * 4.9) * 2.5;
    pieces.push(part(new IcosahedronGeometry(1, 0), 0xb3aa8c,
      [x, .015, z], [.09 + i % 3 * .025, .025, .075], [0, i, 0], .12, i + 7));
  }
  const geometry = merged(pieces); pieces.forEach(p => p.dispose()); return geometry;
})();
const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });

export default function MeadowTownSquare({ x }: { x: number }) {
  return <mesh position={[x, 0, 39]} geometry={paving} material={material} raycast={() => null} receiveShadow dispose={null} />;
}
