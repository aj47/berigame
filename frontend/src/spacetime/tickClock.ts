import { TICK_MS } from '@sim';

/**
 * Client-side view of the server tick, fed by updates to the `world` row.
 * `period` is a smoothed estimate of the real interval between ticks as they
 * arrive here, so interpolation stays smooth even if the network jitters.
 */
export const tickClock = {
  tick: 0,
  arrivedAt: 0,
  period: TICK_MS,
};

export function onWorldTick(tick: number): void {
  const now = performance.now();
  if (tickClock.arrivedAt > 0 && tick > tickClock.tick) {
    const observed = (now - tickClock.arrivedAt) / (tick - tickClock.tick);
    const clamped = Math.min(900, Math.max(400, observed));
    tickClock.period = tickClock.period * 0.8 + clamped * 0.2;
  }
  tickClock.tick = tick;
  tickClock.arrivedAt = now;
}
