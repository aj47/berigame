import { spireStandable, type Tile } from '@sim';

/**
 * Spire step controls (FINAL_SPEC 7.6): WASD or arrows map to the 8 grid
 * directions relative to the camera azimuth (45-degree sectors); a tap steps 1
 * tile, holding steps 2 per tick, Shift keeps 1-tile steps; at most one
 * setTarget in flight and the latest intent replaces a queued one.
 */
export interface StepKeys { up: boolean; down: boolean; left: boolean; right: boolean }

/** The 8 grid directions clockwise on screen from above (+z is south), starting east. */
const RING: readonly (readonly [number, number])[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/**
 * Grid delta (each component -1..1) for the held keys at camera azimuth `azimuth` (radians), or null.
 * Azimuth 0 is the camera south of its target looking north (screen up = grid north, -z); a larger
 * azimuth swings the camera toward +x, which turns screen up counter-clockwise (north -> west).
 */
export function stepDelta(keys: StepKeys, azimuth: number): readonly [number, number] | null {
  const ux = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const uz = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (ux === 0 && uz === 0) return null;
  const at = RING.findIndex(([x, z]) => x === ux && z === uz);
  const sector = Math.round(azimuth / (Math.PI / 4));
  const i = (((at - sector) % 8) + 8) % 8;
  return RING[i];
}

/**
 * The tile to send: 1 tile for a tap or with Shift, 2 tiles while held. A step off the floor or onto the
 * dais falls back to the 1-tile step, then to holding position.
 */
export function stepTarget(me: Tile, delta: readonly [number, number], held: boolean, shift: boolean): Tile {
  const far = { x: me.x + 2 * delta[0], z: me.z + 2 * delta[1] };
  const near = { x: me.x + delta[0], z: me.z + delta[1] };
  if (held && !shift && spireStandable(far)) return far;
  if (spireStandable(near)) return near;
  return { x: me.x, z: me.z };
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
  let inFlight = false;
  let queued: Tile | null = null;
  const fire = (t: Tile) => {
    inFlight = true;
    let p: Promise<unknown>;
    try { p = Promise.resolve(setTarget(t.x, t.z)); } catch { p = Promise.resolve(); }
    void p.catch(() => undefined).then(() => {
      inFlight = false;
      const next = queued;
      queued = null;
      if (next) fire(next);
    });
  };
  return {
    send(target: Tile) {
      if (inFlight) queued = { x: target.x, z: target.z };
      else fire(target);
    },
    get queued() { return queued; },
    get inFlight() { return inFlight; },
  };
}
