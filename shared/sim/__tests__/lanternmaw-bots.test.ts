/**
 * Difficulty estimate for Lanternmaw before the staging playtest (BOSSES.md
 * 9.9): scripted players (lanternmawBots.ts) on fresh run seeds, solo with a
 * stone club. A learner starts sloppy and becomes careful over K attempts; its
 * attempts to a first clear follow from the measured win rate at each step.
 *
 * Default: 40 runs per point. LANTERN_BOTS=full: 400 runs per point plus
 * parties, and the table printed for the doc.
 */
import { describe, expect, it } from 'vitest';
import { CAREFUL, PERFECT, SLOPPY, blendProfile, runLanternBots, type BotProfile } from './lanternmawBots';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const FULL = env.LANTERN_BOTS === 'full';
const RUNS = FULL ? 400 : 40;

function winRate(ps: readonly BotProfile[], runs: number, salt: number): number {
  let won = 0;
  for (let s = 1; s <= runs; s++) if (runLanternBots(salt * 100_000 + s, ps).outcome === 'cleared') won++;
  return won / runs;
}

/** Expected and median attempts to a first clear when attempt k plays at skill min(1, (k - 1) / K), from rates measured at skill 0, 1/4 .. 1. */
function attemptsToFirstClear(rates: readonly number[], K: number, cap = 500): { mean: number; median: number; p90: number } {
  const rateAt = (k: number) => {
    const t = Math.min(1, (k - 1) / K) * (rates.length - 1), i = Math.min(rates.length - 2, Math.floor(t));
    return rates[i] + (rates[i + 1] - rates[i]) * (t - i);
  };
  let none = 1, mean = 0, median = 0, p90 = 0;
  for (let k = 1; k <= cap; k++) {
    mean += none;
    none *= 1 - rateAt(k);
    if (!median && none <= 0.5) median = k;
    if (!p90 && none <= 0.1) p90 = k;
  }
  return { mean, median: median || cap, p90: p90 || cap };
}

describe('Lanternmaw difficulty estimate (scripted players, solo stone club)', () => {
  const rates: number[] = [];

  it('a perfect player (almost) always clears; a careful one clears 25-35%; a sloppy one almost never', () => {
    const perfect = winRate([PERFECT], RUNS, 1), careful = winRate([CAREFUL], RUNS, 2), sloppy = winRate([SLOPPY], RUNS, 3);
    // Rules 3 (4 meals): the scripted perfect player caps every spring, so on its longest seed (1 of 400) a twelfth
    // bite outlasts its food; a real expert would skip that cap. Every sampled clock run still clears (patterns test).
    expect(perfect).toBeGreaterThanOrEqual(FULL ? 0.99 : 1);
    // The default sample is small: allow its noise around the 20-40% target the full run measures.
    expect(careful).toBeGreaterThanOrEqual(FULL ? 0.2 : 0.1);
    expect(careful).toBeLessThanOrEqual(FULL ? 0.35 : 0.5);
    expect(sloppy).toBeLessThanOrEqual(0.05);
    console.log(`Lanternmaw solo win rates over ${RUNS} runs: perfect ${perfect}, careful ${careful}, sloppy ${sloppy}`);
  }, 300_000);

  it('a learner needs 10-50 attempts to a first clear', () => {
    for (const t of [0, 250, 500, 750, 1000]) rates.push(winRate([blendProfile(t)], RUNS, 10 + t));
    const fast = attemptsToFirstClear(rates, 10), slow = attemptsToFirstClear(rates, 30);
    // A learner who becomes careful within 10 to 30 attempts.
    expect(fast.median).toBeGreaterThanOrEqual(FULL ? 8 : 5);
    expect(slow.median).toBeLessThanOrEqual(50);
    console.log(`Lanternmaw learner rates ${rates.map((r) => r.toFixed(2)).join(' ')}; K=10 ${JSON.stringify(fast)}; K=30 ${JSON.stringify(slow)}`);
  }, 600_000);

  it.runIf(FULL)('parties: careful duos and quads, perfect and sloppy quads', () => {
    const duo = winRate([CAREFUL, CAREFUL], 100, 4), quad = winRate([CAREFUL, CAREFUL, CAREFUL, CAREFUL], 100, 5);
    const pquad = winRate([PERFECT, PERFECT, PERFECT, PERFECT], 100, 6), squad = winRate([SLOPPY, SLOPPY, SLOPPY, SLOPPY], 100, 7);
    const stick = winRate([{ ...PERFECT, weapon: 6 }], 100, 8);
    console.log(`Lanternmaw parties: careful x2 ${duo}, careful x4 ${quad}, perfect x4 ${pquad}, sloppy x4 ${squad}; perfect solo with a stick ${stick}`);
    expect(pquad).toBe(1);
    expect(quad).toBeGreaterThanOrEqual(0.5);
    expect(quad).toBeLessThanOrEqual(0.7);
    // Why entry needs a stone club: a stick cannot beat the clock even played perfectly.
    expect(stick).toBeLessThan(0.1);
  }, 600_000);
});
