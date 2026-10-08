import { isNewcomer } from './areas';

interface Contender { state: number; respawnTick: number }

/**
 * Extra odds a full energy meter adds to a claim draw: an empty meter weighs 1,
 * the rested line 3, a full (rested) meter 4. Gathering nonstop drains the
 * meter and time away refills it, so a node camped by a grinder still leans
 * toward fresher players without ever shutting the grinder out.
 */
export const CLAIM_ENERGY_BONUS = 3;

/** A contender's weight in a claim draw from its energy `points` out of `max`. */
export function claimWeight(points: number, max: number): number {
  return 1 + CLAIM_ENERGY_BONUS * Math.min(1, Math.max(0, max > 0 ? points / max : 0));
}

/**
 * Who gets a contested node: a weighted draw among everyone in reach on the
 * tick it frees, with newcomers (first-spawn grace) drawn first. Arrival order,
 * reaction time and network latency never matter; `weight` (energy, via
 * claimWeight) sets the odds, and every contender has some. `contenders` arrives
 * in a fixed order (the tick's `s.order`), and `random` and `weight` are only
 * called when two or more share the top tier, so replays agree and an
 * uncontested claim draws nothing.
 */
export function drawClaimant<T extends Contender>(contenders: readonly T[], tick: number, random: () => number, weight: (c: T) => number = () => 1): T | undefined {
  const newcomers = contenders.filter((p) => isNewcomer(p, tick));
  const pool = newcomers.length > 0 ? newcomers : contenders;
  if (pool.length <= 1) return pool[0];
  const weights = pool.map((c) => Math.max(0, weight(c)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  let roll = random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll < 0) return pool[i];
  }
  return pool[pool.length - 1];
}
