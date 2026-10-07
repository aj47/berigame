import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_COUNTERS, DAY_MS, activeUsers, coinFlows, coinReasons, dailySeries, distribution, funnel, reasonGroup, retentionCohorts,
  type ActivityDay, type LedgerEntry,
} from '../adminStats';

const row = (day: number, identity: string, extra: Partial<ActivityDay> = {}): ActivityDay => ({
  day, identity, agent: false, actions: {},
  ...(Object.fromEntries(ACTIVITY_COUNTERS.map((k) => [k, 0])) as Record<(typeof ACTIVITY_COUNTERS)[number], number>),
  ...extra,
});

describe('daily series', () => {
  it('fills empty days and splits humans from agents', () => {
    const series = dailySeries([
      row(10, 'a', { harvests: 3, playSeconds: 1800, actions: { gather: 2 } }),
      row(10, 'b', { agent: true, harvests: 1, playSeconds: 1800, actions: { gather: 1, build: 1 } }),
      row(12, 'a', { deaths: 1 }),
    ], [10, 10, 12], 10, 12);
    expect(series.map((p) => p.day)).toEqual([10, 11, 12]);
    expect(series[0]).toMatchObject({ dau: 2, humans: 1, agents: 1, newPlayers: 2, playHours: 1 });
    expect(series[0].totals.harvests).toBe(4);
    expect(series[0].actions).toEqual({ gather: 3, build: 1 });
    expect(series[1]).toMatchObject({ dau: 0, newPlayers: 0 });
    expect(series[2]).toMatchObject({ dau: 1, newPlayers: 1 });
  });

  it('ignores rows outside the window', () => {
    expect(dailySeries([row(5, 'a')], [5], 10, 10)[0].dau).toBe(0);
  });
});

describe('active users', () => {
  it('counts each identity once per trailing window', () => {
    const rows = [row(100, 'a'), row(99, 'a'), row(95, 'b'), row(80, 'c'), row(60, 'd'), row(101, 'e')];
    expect(activeUsers(rows, 100)).toEqual({ dau: 1, wau: 2, mau: 3 });
  });
});

describe('retention cohorts', () => {
  it('counts returns on day N and leaves future days unknown', () => {
    const joins = new Map([['a', 10], ['b', 10], ['c', 12]]);
    const rows = [row(10, 'a'), row(11, 'a'), row(13, 'b'), row(10, 'b'), row(12, 'c'), row(13, 'c')];
    const cohorts = retentionCohorts(joins, rows, 0, 13);
    expect(cohorts).toEqual([
      { day: 10, size: 2, returned: { d1: 1, d3: 1, d7: null } },
      { day: 12, size: 1, returned: { d1: 1, d3: null, d7: null } },
    ]);
  });
});

describe('coin flows', () => {
  const at = (day: number) => day * DAY_MS + 1000;
  const ledger: LedgerEntry[] = [
    { owner: 'a', amount: 50, reason: 'quest:first', at: at(1) },
    { owner: 'a', amount: 10, reason: 'order:3', at: at(2) },
    { owner: 'a', amount: -20, reason: 'deed and first week', at: at(2) },
    { owner: 'a', amount: -5, reason: 'player trade', at: at(3) },
    { owner: 'b', amount: 5, reason: 'player trade', at: at(3) },
  ];

  it('separates sources, sinks and transfers and carries the opening supply', () => {
    const days = coinFlows(ledger, 2, 3);
    expect(days[0]).toMatchObject({ day: 2, minted: 10, burned: 20, transferred: 0, supply: 40 });
    expect(days[0].byReason).toEqual({ order: 10, 'deed and first week': -20 });
    expect(days[1]).toMatchObject({ day: 3, minted: 0, burned: 0, transferred: 5, supply: 40 });
  });

  it('totals lifetime reasons', () => {
    expect(coinReasons(ledger)).toEqual([
      { reason: 'quest', minted: 50, burned: 0, entries: 1 },
      { reason: 'deed and first week', minted: 0, burned: 20, entries: 1 },
      { reason: 'order', minted: 10, burned: 0, entries: 1 },
      { reason: 'player trade', minted: 5, burned: 5, entries: 2 },
    ]);
    expect(reasonGroup('quest:meadow-1')).toBe('quest');
  });
});

describe('distribution', () => {
  it('is zero for an empty or equal holding and near one when one player holds everything', () => {
    expect(distribution([])).toMatchObject({ holders: 0, total: 0, gini: 0 });
    expect(distribution([5, 5, 5, 5]).gini).toBe(0);
    const skewed = distribution([1, 1, 1, 1, 1, 1, 1, 1, 1, 991]);
    expect(skewed.gini).toBeGreaterThan(0.85);
    expect(skewed).toMatchObject({ holders: 10, total: 1000, median: 1, max: 991 });
    expect(skewed.top10Share).toBeCloseTo(0.991);
  });

  it('skips empty wallets', () => {
    expect(distribution([0, 0, 10]).holders).toBe(1);
  });
});

describe('funnel', () => {
  it('treats a later step as reaching every earlier one', () => {
    const steps = funnel(['join', 'berry', 'craft', 'coast', 'unknown']);
    expect(steps.map((s) => s.reached)).toEqual([5, 3, 2, 2, 2, 1]);
    expect(steps.map((s) => s.stopped)).toEqual([2, 1, 0, 0, 1, 1]);
  });
});
