import { tickClock } from '../spacetime/tickClock';

/**
 * Harvest timing on the client: the server says when a harvest ends
 * (player.harvestEndTick); between world ticks the progress is interpolated
 * with the tick clock so rings fill smoothly instead of in 600ms jumps.
 */

/** The server tick as a continuous value: the last tick plus the fraction of a period since it arrived (capped). */
export function estimatedTick(now: number, clock: { tick: number; arrivedAt: number; period: number } = tickClock): number {
  if (clock.arrivedAt <= 0) return clock.tick;
  return clock.tick + Math.min(1, Math.max(0, (now - clock.arrivedAt) / clock.period));
}

/** 0..1 through a harvest of `totalTicks` ending at `endTick`. */
export function harvestProgress(endTick: number, totalTicks: number, tick: number): number {
  if (endTick <= 0 || totalTicks <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - (endTick - tick) / totalTicks));
}

/** identity hex -> harvestEndTick, for avatars harvesting right now (fed from the player table by FxLayer). */
export const harvesting = new Map<string, number>();
