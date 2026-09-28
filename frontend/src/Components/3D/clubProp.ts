import { BufferGeometry, MeshStandardMaterial, Vector3 } from 'three';
import { STICK_LENGTH, STICK_RADIUS, STICK_TIP_RADIUS } from '../../animation/stickSwing';
import { LowPolyBuilder, coastMaterial, linear } from './nodes/lowPoly';

/**
 * The wielded stone club (M2): a pale driftwood haft with a knapped flint head
 * lashed across its top with cord, echoing /items/stone_club.png. Same frame as
 * stickProp.ts: modelled along +Y from the butt (y=0) to the tip
 * (y=STICK_LENGTH), so it mounts with stickMount() and swings like the stick.
 * Flat shaded vertex colours; one shared geometry and material, never
 * disposed per avatar (render with dispose={null}). Not wired into the game yet.
 */
const HAFT = 0xc9b594, HAFT_DARK = 0x9d8a6c, CUT = 0xe6d8bb, GRIP = 0xa8723c, CORD = 0xc9934e;
const FLINT = 0x4a5870, FLINT_LIGHT = 0x7d8da6, FLINT_DARK = 0x36404f;

function buildGeometry(): BufferGeometry {
  const b = new LowPolyBuilder();
  const top = STICK_LENGTH - 0.04;
  // Haft: slightly thicker than the stick, gently crooked.
  b.log(new Vector3(0, 0, 0), new Vector3(0.008, top, 0), STICK_RADIUS * 1.05, STICK_TIP_RADIUS * 1.4, {
    rings: 4, wobble: 0.006, seed: 2, bark: [linear(HAFT), linear(HAFT_DARK), linear(HAFT)], cap: linear(CUT),
  });
  // Leather grip wrap near the butt and cord lashing under the head (slightly proud of the haft).
  b.log(new Vector3(0, 0.03, 0), new Vector3(0, 0.15, 0), STICK_RADIUS * 1.25, STICK_RADIUS * 1.2, { rings: 2, bark: [linear(GRIP), linear(0x8a5a2e)], cap: linear(GRIP) });
  b.log(new Vector3(0.006, top - 0.13, 0), new Vector3(0.007, top - 0.06, 0), STICK_TIP_RADIUS * 1.9, STICK_TIP_RADIUS * 1.9, { rings: 2, bark: [linear(CORD), linear(0xa8743a)], cap: linear(CORD) });
  // Flint head: a chunky faceted wedge across the haft top, blade edge along ±X.
  b.rock(new Vector3(0.01, top - 0.02, 0), 0.11, new Vector3(1.5, 1.05, 0.85), {
    segments: 6, jitter: 0.35, seed: 13, colors: [linear(FLINT), linear(FLINT_LIGHT), linear(FLINT_DARK)], top: linear(FLINT_LIGHT),
  });
  return b.build();
}

let geometry: BufferGeometry | null = null;
/** Shared by every held club; created on first use. */
export function clubGeometry(): BufferGeometry {
  return geometry ??= buildGeometry();
}
/** The Coast's shared vertex-colour material (same look as stickMaterial()). */
export function clubMaterial(): MeshStandardMaterial {
  return coastMaterial();
}
