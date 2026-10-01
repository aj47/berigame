/**
 * Locomotion timing shared by the tile interpolation (hooks/useTileMotion.ts)
 * and the clip director. Pure functions, so node tests and the offline
 * animation harness use exactly what the game runs.
 */

/** Absorb a small packet/frame gap without flashing the idle pose mid-run. */
export const MOVEMENT_ANIMATION_GRACE_MS = 120;

/**
 * A start from rest eases the body in over this long instead of jumping to
 * full speed while the Run clip is still fading in (which drags the planted
 * feet). The eased body is back on the server schedule when it ends, so
 * arrival at the confirmed tile is never delayed.
 */
export const START_EASE_MS = 80;

/**
 * Travel time elapsed on the server schedule, `elapsedMs` after a start from
 * rest: C1 ease-in, zero speed at 0, back on schedule (position and speed) at
 * `easeMs`, unchanged after that. Peak speed during the catch-up is 4/3.
 */
export function easedElapsed(elapsedMs: number, easeMs = START_EASE_MS): number {
  if (!(easeMs > 0) || elapsedMs >= easeMs) return elapsedMs;
  if (elapsedMs <= 0) return 0;
  const u = elapsedMs / easeMs;
  return easeMs * u * u * (2 - u);
}

/** d(easedElapsed)/d(elapsed): the body's speed as a fraction of the scheduled speed. */
export function easedSpeedFactor(elapsedMs: number, easeMs = START_EASE_MS): number {
  if (!(easeMs > 0) || elapsedMs >= easeMs) return 1;
  if (elapsedMs <= 0) return 0;
  const u = elapsedMs / easeMs;
  return u * (4 - 3 * u);
}

/** Turn rate of the avatar's facing, per second: 1-exp(-13/60) ~= the old 0.2 per frame at 60 fps. */
export const TURN_RATE = 13;

/** Fraction of the remaining turn to close this frame: the same feel at any frame rate. */
export function turnFactor(dtSeconds: number): number {
  return 1 - Math.exp(-TURN_RATE * Math.max(0, dtSeconds));
}

/** Move `current` towards `target` by `factor` of the shortest signed angle between them. */
export function dampAngle(current: number, target: number, factor: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * factor;
}

/**
 * The baked Run cycle (0.6 s, build_character.py RUN_SPEED) plants each foot and
 * slides it back at 3.3 units/s at native cadence. Match it to ground speed.
 */
export const RUN_NATIVE_SPEED = 3.3;
export const runScale = (speed?: number) => Math.max(0.85, Math.min(2.5, (speed ?? 3.33) / RUN_NATIVE_SPEED));

/** How quickly Run's cadence winds down once the body has stopped at its destination. */
export const HOLD_RAMP_MS = 16;

/**
 * Run's cadence while the body waits at its destination for the next confirmed
 * step (the arrival grace). The body has already stopped, so any stride now
 * slides the planted foot (the old full-cadence hold ran in place): ramp the
 * cadence to a standstill within about a frame, and snap back to cadence if
 * travel resumes. A slower ramp measurably slides more (40ms: +30%).
 */
export function holdCadence(holdMs: number): number {
  if (!(holdMs > 0)) return 1;
  const left = HOLD_RAMP_MS > 0 ? 1 - holdMs / HOLD_RAMP_MS : 0;
  return left > 0 ? left : 0;
}
