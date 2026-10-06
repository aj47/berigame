/**
 * The exhaustive Spire pattern validator (FINAL_SPEC 3.9, 10.1).
 *
 * Default run: every non-aimed kind x 64 seeds plus every aimed kind x 64 seeds x 16 stratified aim classes (5,504
 * instances). The full sweep (every aimed kind x 64 seeds x all 144 aim classes, 46,464 instances) runs when
 * SPIRE_VALIDATE=full, or automatically when spirePatternTableHash() is not the last entry of SPIRE_VALIDATED.
 */
import { describe, expect, it } from 'vitest';
import { SPIRE_DEFAULT_AIM, SPIRE_PATTERNS, SPIRE_POOLS, SPIRE_RULES_VERSION, spireBuildPattern } from '../spire';
import { spireAimClasses, spirePatternTableHash, spireValidate } from '../spireValidate';
import type { SpireValidation } from '../spireValidate';
import { SPIRE_VALIDATED } from './spireValidated';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const HASH = spirePatternTableHash();
const LAST = SPIRE_VALIDATED[SPIRE_VALIDATED.length - 1];
const KNOWN = !!LAST && LAST.hash === HASH;
const FULL = env.SPIRE_VALIDATE === 'full' || !KNOWN;
const AIMS = spireAimClasses();
const AIM_SET = FULL ? AIMS : AIMS.filter((_, i) => i % 9 === 0);

/** Appendix A / table 3.9, measured by proto-final/run.mjs exact spin over all 46,464 instances. */
const TABLE: Record<string, { first: number; last: number; maxLive: number; pinch: number; court: number; still: number }> = {
  petal_ring: { first: 4, last: 18, maxLive: 48, pinch: 0.94, court: 0.83, still: 0.44 },
  glint: { first: 3, last: 14, maxLive: 10, pinch: 1.0, court: 1.0, still: 0.13 },
  tidewall: { first: 3, last: 23, maxLive: 39, pinch: 0.8, court: 0.71, still: 0.86 },
  crosswind: { first: 3, last: 23, maxLive: 27, pinch: 0.5, court: 0.44, still: 0.96 },
  lattice: { first: 4, last: 24, maxLive: 44, pinch: 0.96, court: 0.94, still: 0.74 },
  drizzle: { first: 3, last: 32, maxLive: 88, pinch: 0.78, court: 0.78, still: 0.72 },
  glass_sheet: { first: 3, last: 27, maxLive: 120, pinch: 0.49, court: 0.13, still: 0.86 },
  cage: { first: 3, last: 25, maxLive: 48, pinch: 0.25, court: 0.25, still: 0.96 },
  maelstrom: { first: 4, last: 28, maxLive: 84, pinch: 0.75, court: 0.74, still: 0.78 },
  eclipse: { first: 3, last: 29, maxLive: 147, pinch: 0.38, court: 0.07, still: 0.86 },
  shardstorm: { first: 3, last: 32, maxLive: 168, pinch: 0.14, court: 0.01, still: 0.99 },
};

interface Agg { n: number; first: number; last: number; maxLive: number; pinch: number; court: number; still: number }
const results = new Map<number, Agg>();
/** Kinds whose instances all met every obligation in this run. */
const passed = new Set<number>();
const TIMEOUT = FULL ? 600_000 : 60_000;

const round2 = (x: number) => Math.round(x * 100) / 100;

describe(`Spire pattern validator (${FULL ? 'full sweep' : 'stratified'}; ${AIM_SET.length} aim classes)`, () => {
  it.each(SPIRE_PATTERNS.map((p) => [p.key, p.kind] as const))('%s: every instance is fair, separated and bounded', (key, kind) => {
    const p = SPIRE_PATTERNS[kind];
    const aims = p.aimed ? AIM_SET : [SPIRE_DEFAULT_AIM];
    const agg: Agg = { n: 0, first: Infinity, last: -1, maxLive: 0, pinch: 1, court: 1, still: 1 };
    const bad: string[] = [];
    for (let s = 0; s < 64; s++) for (const a of aims) {
      const r: SpireValidation = spireValidate(kind, s, a.x, a.z);
      agg.n++;
      agg.first = Math.min(agg.first, r.firstContact);
      agg.last = Math.max(agg.last, r.lastDanger);
      agg.maxLive = Math.max(agg.maxLive, r.maxLive);
      agg.pinch = Math.min(agg.pinch, r.pinch);
      agg.court = Math.min(agg.court, r.courtPinch);
      agg.still = Math.min(agg.still, r.still);
      // Notice (first contact >= P + 3), fair start (every tile winning at P + 2), separation (last danger <= P + D + 2).
      if (!r.ok || r.firstContact < 3 || r.unsafe !== 0 || r.lastDanger > p.duration + 2 || r.maxLive > 168) {
        bad.push(`seed ${s} aim ${a.x},${a.z}: ${JSON.stringify(r)}`);
      }
    }
    results.set(kind, agg);
    expect(bad.slice(0, 5), `${key}: ${bad.length} failing instances`).toEqual([]);
    expect(agg.n).toBe(64 * aims.length);
    // Durations are exactly the last danger - 2.
    expect(agg.last).toBe(p.duration + 2);
    const t = TABLE[key];
    if (FULL || !p.aimed) {
      expect({ first: agg.first, last: agg.last, maxLive: agg.maxLive, pinch: round2(agg.pinch), court: round2(agg.court), still: round2(agg.still) }).toEqual(t);
    } else {
      // A stratified subset: minima can only be higher and maxima lower than over the full sweep.
      expect(agg.first).toBeGreaterThanOrEqual(t.first);
      expect(agg.last).toBeLessThanOrEqual(t.last);
      expect(agg.maxLive).toBeLessThanOrEqual(t.maxLive);
      for (const k of ['pinch', 'court', 'still'] as const) expect(agg[k]).toBeGreaterThanOrEqual(t[k] - 0.005);
    }
    passed.add(kind);
  }, TIMEOUT);

  it('meets the difficulty bands', () => {
    expect(results.size).toBe(SPIRE_PATTERNS.length);
    for (const p of SPIRE_PATTERNS) {
      const r = results.get(p.kind)!;
      if (p.phase === 1) expect(r.pinch, p.key).toBeGreaterThanOrEqual(0.75);
      if (p.phase >= 3) expect(r.still, p.key).toBeGreaterThanOrEqual(0.75);
    }
    const poolPinch = (ph: 2 | 3 | 4) => Math.min(...SPIRE_POOLS[ph].map((k) => results.get(k)!.pinch));
    expect(poolPinch(2)).toBeLessThanOrEqual(0.6);
    expect(poolPinch(3)).toBeLessThanOrEqual(0.5);
    expect(poolPinch(4)).toBeLessThanOrEqual(0.4);
    const total = [...results.values()].reduce((n, r) => n + r.n, 0);
    expect(total).toBe(FULL ? 46464 : 5504);
    if (FULL) {
      console.log(`Spire validator: ${total} instances OK`);
      console.table(Object.fromEntries(SPIRE_PATTERNS.map((p) => {
        const r = results.get(p.kind)!;
        return [p.key, { n: r.n, first: r.first, last: r.last, D: p.duration, maxLive: r.maxLive, pinch: round2(r.pinch), court: round2(r.court), still: round2(r.still) }];
      })));
    }
  });

  it('is deterministic: two expansions are byte-equal and validation repeats exactly', () => {
    for (const p of SPIRE_PATTERNS) for (const s of [0, 31, 63]) {
      const a = spireBuildPattern(p.kind, 0, s, 72, 66), b = spireBuildPattern(p.kind, 0, s, 72, 66);
      expect(a).not.toBe(b);
      expect(Array.from(new Uint8Array(a.buffer))).toEqual(Array.from(new Uint8Array(b.buffer)));
    }
    expect(spireValidate(9, 17, 80, 57)).toEqual(spireValidate(9, 17, 80, 57));
    expect(spirePatternTableHash()).toBe(HASH);
  });

  it('has 144 aim classes sorted clockwise from east, one per reduced direction', () => {
    expect(AIMS.length).toBe(144);
    const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : Math.abs(x));
    const dirs = new Set(AIMS.map((t) => {
      const u = t.x - 77, v = t.z - 62, d = gcd(Math.abs(u), Math.abs(v));
      return `${u / d},${v / d}`;
    }));
    expect(dirs.size).toBe(144);
    // Upper half-plane on screen (+z south, angles [0, pi) clockwise from east) first, then cross products > 0.
    const halfOf = (t: { x: number; z: number }) => (t.z > 62 || (t.z === 62 && t.x > 77) ? 0 : 1);
    for (let i = 1; i < AIMS.length; i++) {
      const p = AIMS[i - 1], q = AIMS[i];
      expect(halfOf(p)).toBeLessThanOrEqual(halfOf(q));
      if (halfOf(p) === halfOf(q)) expect((p.x - 77) * (q.z - 62) - (p.z - 62) * (q.x - 77)).toBeGreaterThan(0);
    }
    expect(AIMS[0]).toEqual({ x: 79, z: 62 });
  });
});

describe('republish safety (SPIRE_VALIDATED history)', () => {
  it('has strictly increasing rules and distinct hashes', () => {
    expect(SPIRE_VALIDATED.length).toBeGreaterThan(0);
    for (let i = 1; i < SPIRE_VALIDATED.length; i++) expect(SPIRE_VALIDATED[i].rules).toBeGreaterThan(SPIRE_VALIDATED[i - 1].rules);
    expect(new Set(SPIRE_VALIDATED.map((e) => e.hash)).size).toBe(SPIRE_VALIDATED.length);
  });

  it('matches the current pattern table to the last entry and SPIRE_RULES_VERSION', () => {
    if (!KNOWN) {
      const next = (LAST?.rules ?? 0) + 1;
      if (passed.size !== SPIRE_PATTERNS.length) throw new Error(`The pattern table changed (hash ${HASH}) and the full sweep failed: fix the patterns first.`);
      throw new Error(`The pattern table changed and the full 46,464-instance sweep passed. Append\n  { hash: '${HASH}', rules: ${next} },\n`
        + `to shared/sim/__tests__/spireValidated.ts and set SPIRE_RULES_VERSION = ${next} in shared/sim/spire.ts.`);
    }
    expect(LAST.rules, 'SPIRE_RULES_VERSION must equal the rules of the last SPIRE_VALIDATED entry').toBe(SPIRE_RULES_VERSION);
  });
});
