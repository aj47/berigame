import { describe, expect, it } from 'vitest';
import {
  ENERGY_MAX, ENERGY_REGEN_MS, ENERGY_SEASON_MS, ENERGY_START_MAX, ENERGY_TIRED_EVERY,
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
  it('online, returns one point per ENERGY_REGEN_MS up to the rested line and keeps partial progress', () => {
    const s: EnergyState = { id: 'a', points: 0, at: 0, born: SEASONED, tired: 0 };
    expect(energyAt(s, ENERGY_REGEN_MS - 1).points).toBe(0);
    const later = energyAt(s, ENERGY_REGEN_MS * 10 + 500);
    expect(later.points).toBe(10);
    expect(later.at).toBe(ENERGY_REGEN_MS * 10);
    expect(energyAt(s, 100 * HOUR).points).toBe(line);
  });

  it('time logged out refills to the top: an empty seasoned meter in 12 hours', () => {
    const s: EnergyState = { id: 'a', points: 0, at: 0, born: SEASONED, tired: 0 };
    expect(settleEnergy(s, 12 * HOUR, false).points).toBe(ENERGY_MAX);
    expect(settleEnergy(s, 12 * HOUR - ENERGY_REGEN_MS, false).points).toBe(ENERGY_MAX - 1);
    expect(settleEnergy(s, 12 * HOUR, true).points).toBe(line);
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

  it('a two-hour session that gathers half the time never gets tired, even for a new character', () => {
    const fresh = newEnergy('a', 0);
    let s = fresh, tired = false;
    for (let t = 0; t < 2 * HOUR; t += 6000) {
      const spent = spendEnergy(s, t, 3);
      if (spent.band === 'tired') tired = true;
      s = spent.state;
    }
    expect(tired).toBe(false);
  });

  it('a character that gathers nonstop for a day earns well under its nonstop rate', () => {
    const { paid } = gather(newEnergy('bot', 0, SEASONED), 0, 24 * HOUR, 3000);
    const nonstop = (24 * HOUR) / 3000;
    // Refill (one point per 6 s buys one 3 s action per 18 s) plus one tired action in four.
    expect(paid).toBeLessThan(nonstop * 0.45);
  });

  it('the view reports band, line and refill times', () => {
    const v = energyView({ id: 'a', points: 0, at: 0, born: SEASONED, tired: 0 }, 1000);
    expect(v).toMatchObject({ points: 0, max: ENERGY_MAX, band: 'tired', restedLine: energyRestedLine(ENERGY_MAX) });
    expect(v.nextPointInMs).toBe(ENERGY_REGEN_MS - 1000);
    expect(v.refillInMs).toBe(ENERGY_REGEN_MS - 1000 + (energyRestedLine(ENERGY_MAX) - 1) * ENERGY_REGEN_MS);
    expect(energyView(undefined, 0, 'x').band).toBe('normal');
  });
});
