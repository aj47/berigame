import type { Tile } from '@sim';

/**
 * Spire step controls (FINAL_SPEC 7.6): WASD or arrows map to the 8 grid
 * directions relative to the camera azimuth (45-degree sectors); a tap steps 1
 * tile, holding steps 2 per tick, Shift keeps 1-tile steps; at most one
 * setTarget in flight and the latest intent replaces a queued one.
 *
 * WP0 stub with the final API (owned by WP7).
 */
export interface StepKeys { up: boolean; down: boolean; left: boolean; right: boolean }

/** Grid delta (each component -1..1) for the held keys at camera azimuth `azimuth` (radians), or null. */
export function stepDelta(keys: StepKeys, azimuth: number): readonly [number, number] | null {
  void keys; void azimuth;
  throw new Error('not implemented: stepDelta');
}

/** The tile to send: 1 tile for a tap or with Shift, 2 tiles while held. */
export function stepTarget(me: Tile, delta: readonly [number, number], held: boolean, shift: boolean): Tile {
  void me; void delta; void held; void shift;
  throw new Error('not implemented: stepTarget');
}

export interface StepSender {
  /** Send now when nothing is in flight, else replace the queued intent. */
  send(target: Tile): void;
  /** The tile waiting for the in-flight call to settle, if any. */
  readonly queued: Tile | null;
  readonly inFlight: boolean;
}

/** One setTarget in flight at a time; the latest intent wins. */
export function createStepSender(setTarget: (x: number, z: number) => Promise<unknown>): StepSender {
  void setTarget;
  throw new Error('not implemented: createStepSender');
}
