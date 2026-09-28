import React from 'react';
import type { BufferGeometry } from 'three';
import { DodecahedronGeometry, Vector3 } from 'three';
import { LowPolyBuilder, coastMaterial, linear, seeded } from './lowPoly';

/**
 * M2 Coast node: a tide rock in a beach corner (1 tile), where flint is knapped.
 * A flat-shaded, squashed dodecahedron boulder with a wet dark base band, a
 * smaller rock beside it and, while ripe, dark blue-grey flint nodules
 * poking out of its face. Regrowing: the same rock with the flint gone and
 * pale chipped scars where it was.
 * One shared geometry per state and one shared material; InstancedMesh-ready.
 * Not wired into the game yet (docs/design/ROADMAP.md, M2).
 */
const STONE = 0x77736b, STONE_LIGHT = 0x8f8b80, STONE_DARK = 0x5c5953, WET = 0x45423d, WEED = 0x5d7a45;
const FLINT = 0x3a4863, FLINT_LIGHT = 0x5f7599, SCAR = 0xcfc8b6;

function build(ripe: boolean): BufferGeometry {
  const b = new LowPolyBuilder();
  // Main boulder: dodecahedron (36 tris), squashed and jittered deterministically.
  const dodeca = new DodecahedronGeometry(0.5, 0).toNonIndexed();
  const pos = dodeca.getAttribute('position');
  const rand = seeded(42);
  const moved = new Map<string, Vector3>();
  const vertex = (i: number) => {
    const v = new Vector3().fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!moved.has(key)) {
      const s = 0.9 + rand() * 0.2;
      moved.set(key, new Vector3(v.x * 1.15 * s, Math.max(-0.12, v.y * 0.78 * s) + 0.3, v.z * 0.95 * s));
    }
    return moved.get(key)!;
  };
  const shades = [linear(STONE), linear(STONE_LIGHT), linear(STONE_DARK)], wet = linear(WET);
  for (let t = 0; t < pos.count / 3; t++) {
    const a = vertex(3 * t), c = vertex(3 * t + 1), d = vertex(3 * t + 2);
    const low = Math.max(a.y, c.y, d.y) < 0.3;
    const up = new Vector3().crossVectors(c.clone().sub(a), d.clone().sub(a)).normalize().y;
    b.triangle(a, c, d, low ? wet : up > 0.6 ? shades[1] : shades[t % 3 === 0 ? 2 : 0]);
  }
  dodeca.dispose();
  // A smaller companion rock and a clump of weed at the waterline.
  b.rock(new Vector3(0.42, 0.1, 0.3), 0.17, new Vector3(1, 0.7, 1), { segments: 6, seed: 5, colors: [linear(STONE), linear(STONE_DARK)], top: linear(STONE_LIGHT) });
  b.rock(new Vector3(-0.38, 0.03, 0.34), 0.1, new Vector3(1.4, 0.35, 1), { segments: 5, seed: 8, colors: [linear(WEED)] });
  // Flint nodules on the camera-facing (+z/+x) side, or their chipped scars.
  const nodules: [Vector3, number][] = [
    [new Vector3(0.16, 0.5, 0.38), 0.15],
    [new Vector3(0.44, 0.36, 0.1), 0.12],
    [new Vector3(-0.16, 0.6, 0.28), 0.11],
  ];
  nodules.forEach(([p, r], i) => {
    if (ripe) b.rock(p, r, new Vector3(1, 1.25, 0.9), { segments: 5, seed: 30 + i, jitter: 0.5, colors: [linear(FLINT), linear(FLINT_LIGHT)] });
    else b.rock(p.clone().multiplyScalar(0.97), r * 0.8, new Vector3(1, 1, 0.35), { segments: 5, seed: 40 + i, colors: [linear(SCAR)] });
  });
  // Enlarged so the corner rock reads as a landmark at the game camera distance.
  return b.build().scale(1.25, 1.25, 1.25);
}

const cache: Partial<Record<'ripe' | 'regrowing', BufferGeometry>> = {};
/** Shared geometry for a rock state; created on first use, never disposed. */
export function tideRockGeometry(ripe: boolean): BufferGeometry {
  const key = ripe ? 'ripe' : 'regrowing';
  return cache[key] ??= build(ripe);
}

interface Props {
  position: [number, number, number];
  /** True when flint can be knapped; false while regrowing. */
  ripe?: boolean;
  rotation?: number;
  onClick?: (e: any) => void;
}

const TideRock = ({ position, ripe = true, rotation = 0, onClick }: Props) => (
  <mesh position={position} rotation={[0, rotation, 0]} geometry={tideRockGeometry(ripe)} material={coastMaterial()} onClick={onClick} dispose={null} />
);
export default TideRock;
