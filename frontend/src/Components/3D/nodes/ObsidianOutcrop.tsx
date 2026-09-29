import React from 'react';
import type { BufferGeometry } from 'three';
import { Vector3 } from 'three';
import { LowPolyBuilder, coastMaterial, linear } from './lowPoly';

/**
 * M3 Boulders node: an obsidian outcrop. A squat volcanic rock with glassy,
 * near-black shards (violet highlights) jutting up from it while ripe; while
 * it reforms, only low broken stumps remain. Flat-shaded vertex colours on the
 * shared Coast material: one draw per node.
 */
const ROCK = 0x6a615b, ROCK_LIGHT = 0x857a6e, ROCK_DARK = 0x4e4743;
const GLASS = 0x241c30, GLASS_MID = 0x3b2f55, GLASS_HI = 0x8a78c4, STUMP = 0x2e2638;

function build(ripe: boolean): BufferGeometry {
  const b = new LowPolyBuilder();
  const rock = [linear(ROCK), linear(ROCK_DARK)];
  b.rock(new Vector3(0, 0.18, 0), 0.5, new Vector3(1.15, 0.55, 1), { segments: 7, seed: 11, colors: rock, top: linear(ROCK_LIGHT) });
  b.rock(new Vector3(-0.42, 0.08, 0.28), 0.2, new Vector3(1, 0.6, 1), { segments: 5, seed: 12, colors: rock, top: linear(ROCK_LIGHT) });
  const glass = [linear(GLASS), linear(GLASS_MID), linear(GLASS)];
  const shards: [number, number, number, number, number][] = [
    // x, z, height, radius, lean
    [0.05, 0.02, 1.05, 0.13, 0.05],
    [0.28, 0.12, 0.72, 0.1, 0.35],
    [-0.2, 0.16, 0.62, 0.09, -0.3],
    [0.1, -0.24, 0.55, 0.08, 0.2],
    [-0.1, -0.1, 0.8, 0.1, -0.12],
  ];
  shards.forEach(([x, z, h, r, lean], i) => {
    const base = new Vector3(x, 0.3, z);
    const tip = new Vector3(x + lean * 0.35, 0.3 + (ripe ? h : 0.14), z + lean * 0.2);
    b.log(base, tip, r, ripe ? 0.005 : r * 0.8, { sides: 4, rings: 2, seed: 60 + i, bark: glass, cap: ripe ? linear(GLASS_HI) : linear(STUMP), capStart: false });
  });
  if (ripe) {
    // A few bright facets so the glass catches the eye.
    b.rock(new Vector3(0.18, 0.5, 0.2), 0.05, new Vector3(1, 1.6, 0.4), { segments: 4, seed: 70, colors: [linear(GLASS_HI)] });
    b.rock(new Vector3(-0.14, 0.62, 0.12), 0.04, new Vector3(1, 1.8, 0.4), { segments: 4, seed: 71, colors: [linear(GLASS_HI)] });
  }
  return b.build().scale(1.2, 1.2, 1.2);
}

const cache: Partial<Record<'ripe' | 'regrowing', BufferGeometry>> = {};
export function obsidianGeometry(ripe: boolean): BufferGeometry {
  const key = ripe ? 'ripe' : 'regrowing';
  return cache[key] ??= build(ripe);
}

interface Props {
  position: [number, number, number];
  ripe?: boolean;
  rotation?: number;
  onClick?: (e: any) => void;
}

const ObsidianOutcrop = ({ position, ripe = true, rotation = 0, onClick }: Props) => (
  <mesh position={position} rotation={[0, rotation, 0]} geometry={obsidianGeometry(ripe)} material={coastMaterial()} onClick={onClick} dispose={null} />
);
export default ObsidianOutcrop;
