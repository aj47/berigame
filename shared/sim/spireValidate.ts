/**
 * The exhaustive Spire pattern validator (FINAL_SPEC 3.9, 6.5): backward
 * induction over (tile, tick) for one pattern instance. Imported by tests and
 * dev tools only (not exported from index.ts).
 *
 * WP0 stub: the types are final; WP1 ports proto-final/validate.mjs.
 */
import type { Tile } from './types';

export interface SpireValidation {
  ok: boolean;
  firstContact: number;
  lastDanger: number;
  maxLive: number;
  unsafe: number;
  pinch: number;
  courtPinch: number;
  still: number;
}

const todo = (name: string): never => { throw new Error(`not implemented: ${name}`); };

export function spireValidate(kind: number, seed6: number, aimX: number, aimZ: number): SpireValidation {
  return todo(`spireValidate(${kind},${seed6},${aimX},${aimZ})`);
}

/** 144 representatives (reduced directions), absolute tiles, sorted clockwise. */
export function spireAimClasses(): Tile[] { return todo('spireAimClasses'); }

/**
 * FNV-1a over the bullet-relevant behaviour, NOT over SPIRE_RULES_VERSION:
 * SPIRE_PATTERNS (kinds, durations, flags), SPIRE_POOLS, SPIRE_DAMAGE, the star
 * constants, the packed bullets of every kind for all 64 seeds at two fixed
 * aims, and spireStars for 8 seeds x 4 waves x K 3..6.
 */
export function spirePatternTableHash(): string { return todo('spirePatternTableHash'); }
