import { SPIRE_STAR_PERIOD, SPIRE_STAR_PREVIEW, spireStarWave, spireStars, type Tile } from '@sim';

export interface StarView {
  wave: number;
  /** Uncaught stars of the live wave, with their index j (bit j of starMask). */
  live: { j: number; tile: Tile }[];
  /** The next wave, drawn faint in the last SPIRE_STAR_PREVIEW ticks of this one. */
  preview: Tile[];
  /** The live wave is in its last 2 ticks: its stars blink. */
  ending: boolean;
  /** Stars per wave (party + 2). */
  count: number;
  /** Stars of this wave already caught. */
  caught: number;
}

const EMPTY: StarView = { wave: -1, live: [], preview: [], ending: false, count: 0, caught: 0 };

/** The stars at server tick τ (FINAL_SPEC 3.11, 7.5). Before the start (intro) there are none. */
export function starView(run: { startTick: number; partySize: number } | null, fight: { seed: number; starWave: number; starMask: number } | null, tau: number): StarView {
  if (!run || !fight || run.startTick <= 0) return EMPTY;
  const wave = spireStarWave(run.startTick, tau);
  if (wave < 0) return EMPTY;
  const count = Math.max(1, run.partySize) + 2;
  const mask = fight.starWave === wave ? fight.starMask : 0;
  const stars = spireStars(fight.seed, wave, count);
  const live: StarView['live'] = [];
  let caught = 0;
  stars.forEach((tile, j) => { if (mask & (1 << j)) caught++; else live.push({ j, tile }); });
  const into = (tau - run.startTick) % SPIRE_STAR_PERIOD;
  const ending = into >= SPIRE_STAR_PERIOD - SPIRE_STAR_PREVIEW;
  return { wave, live, preview: ending ? spireStars(fight.seed, wave + 1, count) : [], ending, count, caught };
}
