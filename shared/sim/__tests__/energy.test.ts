import { describe, expect, it } from 'vitest';
import {
  ENERGY_MAX, ENERGY_ONLINE_REFILL_SHARE, ENERGY_REGEN_MS, ENERGY_SEASON_MS, ENERGY_START_MAX, ENERGY_TIRED_EVERY,
  energyAt, energyBand, energyCost, energyMax, energyRestedLine, energyView, newEnergy, settleEnergy, spendEnergy,
  type EnergyState,
} from '../energy';

const HOUR = 60 * 60 * 1000;
const SEASONED = -ENERGY_SEASON_MS;

describe('energy meter size', () => {
  it('grows from the starting size to full over the first three days', () => {
    expect(energyMax(0, 0)).toBe(ENERGY_START_MAX);
    expect(energyMax(0, ENERGY_SEASON_MS / 2)).toBe((ENERGY_START_MAX + ENERGY_MAX) / 2);
    expect(energyMax(0, ENERGY_SEASON_MS)).toBe(ENERGY_MAX);
    expect(energyMax(0, 10 * ENERGY_SEASON_MS)).toBe(ENERGY_MAX);
  });

  it('starts every meter at the rested line, paying normally', () => {
    const fresh = newEnergy('a', 0);
    expect(fresh.points).toBe(energyRestedLine(ENERGY_START_MAX));
    expect(energyBand(fresh.points, ENERGY_START_MAX)).toBe('normal');
    const seasoned = newEnergy('b', 0, SEASONED);
    expect(seasoned.points).toBe(energyRestedLine(ENERGY_MAX));
    expect(spendEnergy(seasoned, 0, 3).payout).toBe(1);
  });
});

describe('refill', () => {
  const line = energyRestedLine(ENERGY_MAX);
  it('online time does not refill, and is used up so a later logout never counts it as time away', () => {
    expect(ENERGY_ONLINE_REFILL_SHARE).toBe(0);
    const s: EnergyState = { id: 'a', points: 0, at: 0, born: SEASONED, tired: 0 };
    const online = energyAt(s, 100 * HOUR);
    expect(online).toMatchObject({ points: 0, at: 100 * HOUR });
    expect(settleEnergy(online, 100 * HOUR + ENERGY_REGEN_MS, false).points).toBe(1);
    expect(settleEnergy(s, 12 * HOUR, true)).toMatchObject({ points: 0, at: 12 * HOUR });
    expect(energyAt({ ...s, points: line - 1 }, 100 * HOUR).points).toBe(line - 1);
  });

  it('time logged out returns one point per ENERGY_REGEN_MS up to the top and keeps partial progress', () => {
    const s: EnergyState = { id: 'a', points: 0, at: 0, born: SEASONED, tired: 0 };
    expect(settleEnergy(s, ENERGY_REGEN_MS - 1, false).points).toBe(0);
    const later = settleEnergy(s, ENERGY_REGEN_MS * 10 + 500, false);
    expect(later).toMatchObject({ points: 10, at: ENERGY_REGEN_MS * 10 });
    // An empty seasoned meter is full after 12 hours away.
    expect(settleEnergy(s, 12 * HOUR, false).points).toBe(ENERGY_MAX);
    expect(settleEnergy(s, 12 * HOUR - ENERGY_REGEN_MS, false).points).toBe(ENERGY_MAX - 1);
  });

  it('online refills never take away points earned while away', () => {
    const s: EnergyState = { id: 'a', points: ENERGY_MAX, at: 0, born: SEASONED, tired: 0 };
    expect(energyAt(s, HOUR).points).toBe(ENERGY_MAX);
  });

  it('never mutates its input', () => {
    const s: EnergyState = { id: 'a', points: 5, at: 0, born: SEASONED, tired: 0 };
    energyAt(s, HOUR);
    spendEnergy(s, HOUR, 3);
    settleEnergy(s, HOUR, false);
    expect(s).toEqual({ id: 'a', points: 5, at: 0, born: SEASONED, tired: 0 });
  });
});

describe('payouts', () => {
  it('pays double above the rested line, then normal, then one in four when tired', () => {
    const line = energyRestedLine(ENERGY_MAX);
    const rested: EnergyState = { id: 'a', points: line + 3, at: 0, born: SEASONED, tired: 0 };
    const first = spendEnergy(rested, 0, 3);
    expect(first).toMatchObject({ band: 'rested', payout: 2 });
    expect(first.state.points).toBe(line);
    const second = spendEnergy(first.state, 0, 3);
    expect(second).toMatchObject({ band: 'normal', payout: 1 });

    let tired: EnergyState = { id: 'a', points: 0, at: 0, born: SEASONED, tired: 0 };
    const payouts: number[] = [];
    for (let i = 0; i < ENERGY_TIRED_EVERY * 3; i++) {
      const spent = spendEnergy(tired, 0, 3);
      expect(spent.band).toBe('tired');
      payouts.push(spent.payout);
      tired = spent.state;
    }
    expect(payouts.filter((p) => p === 1)).toHaveLength(3);
    expect(payouts.filter((p) => p === 0)).toHaveLength(ENERGY_TIRED_EVERY * 3 - 3);
  });

  it('an action that costs more than what is left is paid as tired, so trickling points never buy full actions', () => {
    const s: EnergyState = { id: 'a', points: 2, at: 0, born: SEASONED, tired: 0 };
    const spent = spendEnergy(s, 0, 3);
    expect(spent).toMatchObject({ band: 'tired', payout: 0 });
    expect(spent.state.points).toBe(2);
    expect(spendEnergy({ ...s, points: 3 }, 0, 3)).toMatchObject({ band: 'normal', payout: 1 });
  });

  it('charges seconds of gathering, at least one', () => {
    expect(energyCost(3000)).toBe(3);
    expect(energyCost(2400)).toBe(2);
    expect(energyCost(100)).toBe(1);
  });

  it('only time logged out earns the rested band: staying online never does', () => {
    const line = energyRestedLine(ENERGY_MAX);
    const s: EnergyState = { id: 'a', points: line, at: 0, born: SEASONED, tired: 0 };
    expect(spendEnergy(s, 0, 3).payout).toBe(1);
    expect(spendEnergy(s, 10 * HOUR, 3).payout).toBe(1);
    expect(spendEnergy(settleEnergy(s, HOUR, false), HOUR, 3).payout).toBe(2);
  });
});

describe('a session and a bot day', () => {
  /** Gather 3 s actions back to back for `ms`, returning the paid units. */
  function gather(s: EnergyState, from: number, ms: number, everyMs: number): { paid: number; state: EnergyState } {
    let paid = 0;
    for (let t = from; t < from + ms; t += everyMs) {
      const spent = spendEnergy(s, t, 3);
      paid += spent.payout;
      s = spent.state;
    }
    return { paid, state: s };
  }

  it('a two-hour session that finishes a harvest every 10 s never gets tired, even for a new character', () => {
    const { state } = gather(newEnergy('a', 0), 0, 2 * HOUR, 10_000);
    expect(state.points).toBeGreaterThan(0);
    expect(state.tired).toBe(0);
  });

  it('a character that gathers nonstop for a day earns well under its nonstop rate', () => {
    const { paid } = gather(newEnergy('bot', 0, SEASONED), 0, 24 * HOUR, 3000);
    const nonstop = (24 * HOUR) / 3000;
    // The meter (from the rested line), then one tired action in four: nothing refills while online.
    expect(paid).toBe(energyRestedLine(ENERGY_MAX) / 3 + Math.floor((nonstop - energyRestedLine(ENERGY_MAX) / 3) / ENERGY_TIRED_EVERY));
    expect(paid).toBeLessThan(nonstop * 0.3);
  });

  it('the view reports band, line and refill times', () => {
    const v = energyView({ id: 'a', points: 0, at: 0, born: SEASONED, tired: 0 }, 1000);
    expect(v).toMatchObject({ points: 0, max: ENERGY_MAX, band: 'tired', restedLine: energyRestedLine(ENERGY_MAX) });
    // Online time does not refill: only time logged out does.
    expect(v).toMatchObject({ nextPointInMs: 0, refillInMs: 0 });
    expect(v.restToLineInMs).toBe(energyRestedLine(ENERGY_MAX) * ENERGY_REGEN_MS);
    expect(v.restToFullInMs).toBe(ENERGY_MAX * ENERGY_REGEN_MS);
    expect(energyView({ id: 'a', points: ENERGY_MAX, at: 0, born: SEASONED, tired: 0 }, 1000)).toMatchObject({ restToLineInMs: 0, restToFullInMs: 0 });
    expect(energyView(undefined, 0, 'x').band).toBe('normal');
  });
});
