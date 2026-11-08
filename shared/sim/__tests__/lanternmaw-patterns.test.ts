/**
 * The exhaustive Lanternmaw fairness validator (BOSSES.md 9.8), always the full
 * sweep (about 1 s): every den kind x 64 seeds (Mire Marks x all 216 aim tiles)
 * and every spring x 64 pulse seeds x 3 phases x capped or not: 15,808
 * instances. Each must give at least 3 ticks of notice (8 for the tide), leave
 * every standable tile winning at publication, and never leave a tick with no
 * free tile. Plus the unwinnable-state checks: the heal bound, the cap walk,
 * swing room at the spring, separation between instances, and a perfect solo
 * player clearing every sampled run.
 */
import { describe, expect, it } from 'vitest';
import {
  LANTERN_DIVE_TICKS, LANTERN_PATTERNS, LANTERN_RULES_VERSION, LANTERN_TIDE_TICKS, lanternPatternDuration,
} from '../lanternmaw';
import {
  lanternHealProblem, lanternInstances, lanternPatternTableHash, lanternValidateInstance, lanternWorstCapTicks,
  type LanternInstance, type LanternValidation,
} from '../lanternmawValidate';
import { LANTERN_VALIDATED } from './lanternmawValidated';
import { PERFECT, runLanternBots } from './lanternmawBots';

const HASH = lanternPatternTableHash();
const LAST = LANTERN_VALIDATED[LANTERN_VALIDATED.length - 1];
const KNOWN = !!LAST && LAST.hash === HASH;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** BOSSES.md table 9.8, measured over the full sweep. */
const TABLE: Record<string, { n: number; first: number; last: number; minFree: number; pinch: number; reach: number; still: number }> = {
  lure_sweep: { n: 64, first: 3, last: 6, minFree: 156, pinch: 0.64, reach: 0.63, still: 1 },
  mud_geysers: { n: 64, first: 3, last: 8, minFree: 207, pinch: 0.95, reach: 0.75, still: 0.15 },
  tail_lash: { n: 64, first: 3, last: 9, minFree: 144, pinch: 0.67, reach: 0, still: 0.52 },
  ripple: { n: 64, first: 3, last: 17, minFree: 128, pinch: 0.59, reach: 0, still: 1 },
  mire_marks: { n: 13824, first: 3, last: 5, minFree: 207, pinch: 0.95, reach: 0.69, still: 0.02 },
  drowning_cross: { n: 64, first: 3, last: 7, minFree: 144, pinch: 0.67, reach: 0.25, still: 0.63 },
  lantern_storm: { n: 64, first: 3, last: 7, minFree: 198, pinch: 0.91, reach: 0.56, still: 0.25 },
  maw_bellow: { n: 64, first: 3, last: 7, minFree: 56, pinch: 0.26, reach: 0, still: 1 },
  tide: { n: 768, first: 8, last: 22, minFree: 49, pinch: 0.23, reach: 0.08, still: 0.78 },
  tide_capped: { n: 768, first: 8, last: 22, minFree: 49, pinch: 0.12, reach: 0.08, still: 0.78 },
};

interface Agg { n: number; first: number; last: number; minFree: number; pinch: number; reach: number; reachMin: number; still: number }
const groupOf = (x: LanternInstance) => (x.group === 'den' ? LANTERN_PATTERNS[x.kind].key : x.capped ? 'tide_capped' : 'tide');
const results = new Map<string, Agg>();
const bad: string[] = [];
let total = 0;
let swept = false;

function sweep(): void {
  if (swept) return;
  swept = true;
  for (const x of lanternInstances()) {
    const r: LanternValidation = lanternValidateInstance(x);
    total++;
    const g = groupOf(x);
    const a = results.get(g) ?? { n: 0, first: Infinity, last: -1, minFree: Infinity, pinch: 1, reach: 1, reachMin: Infinity, still: 1 };
    a.n++;
    a.first = Math.min(a.first, r.firstContact);
    a.last = Math.max(a.last, r.lastDanger);
    a.minFree = Math.min(a.minFree, r.minFree);
    a.pinch = Math.min(a.pinch, r.pinch);
    a.reach = Math.min(a.reach, r.reachPinch);
    a.reachMin = Math.min(a.reachMin, r.reachMin);
    a.still = Math.min(a.still, r.still);
    results.set(g, a);
    // Separation: a den pattern's danger ends by the tick the next is published (its first blow is 3 later); the tide's ends before the ebb.
    const sepOk = x.group === 'den' ? r.lastDanger <= lanternPatternDuration(x.kind, x.seed) : r.lastDanger === LANTERN_DIVE_TICKS + LANTERN_TIDE_TICKS - 1;
    if (!r.ok || !sepOk) bad.push(`${g} seed ${x.seed} aim ${x.aim} phase ${x.phase}: ${JSON.stringify(r)}`);
  }
}

describe('Lanternmaw pattern validator (full sweep)', () => {
  it('every instance gives notice, starts winning from every tile and always leaves a free tile', () => {
    sweep();
    expect(bad.slice(0, 5), `${bad.length} failing instances`).toEqual([]);
    expect(total).toBe(15808);
  });

  it('matches table 9.8', () => {
    sweep();
    const got = Object.fromEntries([...results].map(([g, a]) => [g, {
      n: a.n, first: a.first, last: a.last, minFree: a.minFree, pinch: round2(a.pinch), reach: round2(a.reach), still: round2(a.still),
    }]));
    expect(got).toEqual(TABLE);
    console.log(`Lanternmaw validator: ${total} instances OK`);
  });

  it('the spring always leaves room to swing: at least 2 winning tiles in reach on every tide tick', () => {
    sweep();
    expect(results.get('tide')!.reachMin).toBeGreaterThanOrEqual(2);
    expect(results.get('tide_capped')!.reachMin).toBeGreaterThanOrEqual(2);
  });
});

describe('Lanternmaw unwinnable states', () => {
  it('never heals as fast as one stick swing per member, so it cannot out-heal any party that swings', () => {
    expect(lanternHealProblem()).toBeNull();
  });

  it('every tile can reach every spring before it surfaces', () => {
    expect(lanternWorstCapTicks()).toBeLessThanOrEqual(LANTERN_DIVE_TICKS);
  });

  it('a perfect solo player with a stone club clears every sampled run before the time limit', () => {
    const fails: string[] = [];
    for (let s = 1; s <= 24; s++) {
      const r = runLanternBots(0x1a00 + s, [PERFECT]);
      if (r.outcome !== 'cleared') fails.push(`seed ${s}: ${JSON.stringify(r)}`);
    }
    expect(fails).toEqual([]);
  }, 60_000);
});

describe('republish safety (LANTERN_VALIDATED history)', () => {
  it('has strictly increasing rules and distinct hashes', () => {
    for (let i = 1; i < LANTERN_VALIDATED.length; i++) expect(LANTERN_VALIDATED[i].rules).toBeGreaterThan(LANTERN_VALIDATED[i - 1].rules);
    expect(new Set(LANTERN_VALIDATED.map((e) => e.hash)).size).toBe(LANTERN_VALIDATED.length);
  });

  it('matches the current pattern table to the last entry and LANTERN_RULES_VERSION', () => {
    if (!KNOWN) {
      sweep();
      const next = (LAST?.rules ?? 0) + 1;
      if (bad.length) throw new Error(`The Lanternmaw pattern table changed (hash ${HASH}) and the sweep failed: fix the patterns first.`);
      throw new Error(`The Lanternmaw pattern table changed and the full 15,808-instance sweep passed. Append\n  { hash: '${HASH}', rules: ${next} },\n`
        + `to shared/sim/__tests__/lanternmawValidated.ts and set LANTERN_RULES_VERSION = ${next} in shared/sim/lanternmaw.ts.`);
    }
    expect(LAST.rules).toBe(LANTERN_RULES_VERSION);
  });
});
