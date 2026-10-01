import React from 'react';
import type { BufferGeometry } from 'three';
import { Vector3 } from 'three';
import { LowPolyBuilder, coastMaterial, linear } from './lowPoly';

/**
 * M2 Coast node: a pile of sun-bleached driftwood on the beach (1 tile).
 * Ripe: three crossed logs with a forked branch and two pebbles.
 * Regrowing: one short half-buried log and the pebbles, so the spot still
 * reads as "driftwood comes here" while it is empty.
 * One shared geometry per state and one shared material: a single draw call,
 * and either geometry can back an InstancedMesh (see driftwoodPileGeometry).
 */
// Weathered wood darker than the pale sand, with bright cut ends and a wet-sand
// shadow under the pile, so it reads at game distance (review: too small and pale).
const PALE = 0x8e7658, MID = 0x6c573f, DARK = 0x46382a, CUT = 0xe8d4a8, PEBBLE = 0x6f6c66, PEBBLE_DARK = 0x4f4c48, SHADOW = 0x8a7652;

function build(ripe: boolean): BufferGeometry {
  const b = new LowPolyBuilder();
  const bark = [linear(PALE), linear(MID), linear(PALE), linear(DARK)];
  const cut = linear(CUT);
  const pebbles = [linear(PEBBLE), linear(PEBBLE_DARK)];
  if (ripe) {
    // Two logs on the sand, crossed, and a third resting across them.
    b.log(new Vector3(-0.42, 0.07, 0.2), new Vector3(0.44, 0.06, -0.12), 0.13, 0.09, { seed: 3, wobble: 0.025, bark, cap: cut });
    b.log(new Vector3(-0.3, 0.06, -0.3), new Vector3(0.36, 0.06, 0.3), 0.115, 0.08, { seed: 5, wobble: 0.02, bark, cap: cut });
    b.log(new Vector3(-0.1, 0.27, -0.4), new Vector3(0.06, 0.22, 0.44), 0.1, 0.07, { seed: 9, wobble: 0.02, bark, cap: cut });
    // A forked stub off the top log, the silhouette from the icon.
    b.log(new Vector3(0.03, 0.28, 0.1), new Vector3(0.2, 0.46, 0.22), 0.045, 0.026, { sides: 4, rings: 2, bark, cap: cut, capStart: false });
  } else {
    // One short, half-buried stump of a log.
    b.log(new Vector3(-0.22, 0.01, 0.08), new Vector3(0.2, 0.03, -0.06), 0.1, 0.075, { seed: 11, bark: [linear(MID), linear(DARK)], cap: linear(PALE) });
  }
  // Damp, darker sand under the pile: an 8-sided patch, 8 tris.
  const shadow = linear(SHADOW), centre = new Vector3(0, 0.004, 0);
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
    const r = ripe ? 0.56 : 0.4;
    b.triangle(centre, new Vector3(Math.cos(a1) * r, 0.004, Math.sin(a1) * r * 0.85), new Vector3(Math.cos(a0) * r, 0.004, Math.sin(a0) * r * 0.85), shadow);
  }
  b.rock(new Vector3(0.4, 0.03, 0.28), 0.09, new Vector3(1, 0.55, 0.9), { segments: 5, seed: 21, colors: pebbles });
  b.rock(new Vector3(-0.36, 0.025, -0.24), 0.05, new Vector3(1.1, 0.5, 1), { segments: 5, seed: 22, colors: pebbles });
  // Author at ~1 tile, then enlarge to read next to a 2.8-unit berry tree.
  return b.build().scale(1.5, 1.5, 1.5);
}

const cache: Partial<Record<'ripe' | 'regrowing', BufferGeometry>> = {};
/** Shared geometry for a pile state; created on first use, never disposed. */
export function driftwoodPileGeometry(ripe: boolean): BufferGeometry {
  const key = ripe ? 'ripe' : 'regrowing';
  return cache[key] ??= build(ripe);
}

interface Props {
  position: [number, number, number];
  /** True when there is driftwood to gather; false while regrowing. */
  ripe?: boolean;
  /** Y rotation so neighbouring piles don't look stamped. */
  rotation?: number;
  onClick?: (e: any) => void;
}

const DriftwoodPile = ({ position, ripe = true, rotation = 0, onClick }: Props) => (
  <mesh position={position} rotation={[0, rotation, 0]} geometry={driftwoodPileGeometry(ripe)} material={coastMaterial()} onClick={onClick} dispose={null} />
);
export default DriftwoodPile;
