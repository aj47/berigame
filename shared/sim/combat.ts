import { RETALIATE_OFFSET_TICKS, SWING_INTERVAL_TICKS } from './constants';

/**
 * Tick on which a retaliating player should first swing so that the pair
 * alternates: opponent's next swing + half a swing interval, advanced by whole
 * intervals until it is in the future.
 */
export function retaliationSwingTick(now: number, opponentNextSwing: number): number {
  let t = opponentNextSwing + RETALIATE_OFFSET_TICKS;
  while (t <= now) t += SWING_INTERVAL_TICKS;
  return t;
}

export function isSwingDue(now: number, nextSwingTick: number): boolean {
  return now >= nextSwingTick;
}
