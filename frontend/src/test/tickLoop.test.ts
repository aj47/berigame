import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Identity } from 'spacetimedb';
import { EventKind, TICK_MS } from '@sim';
import { onWorldTick, tickClock } from '../spacetime/tickClock';
import { useCombatFxStore } from '../spacetime/stores/combatFxStore';

const idA = Identity.fromString('0'.repeat(63) + 'a');
const idB = Identity.fromString('0'.repeat(63) + 'b');

describe('tickClock', () => {
  beforeEach(() => {
    tickClock.tick = 0;
    tickClock.arrivedAt = 0;
    tickClock.period = TICK_MS;
  });

  it('tracks the tick and smooths the observed period', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    onWorldTick(10);
    expect(tickClock.tick).toBe(10);
    expect(tickClock.period).toBe(TICK_MS);
    now += 700;
    onWorldTick(11);
    expect(tickClock.period).toBeGreaterThan(TICK_MS);
    expect(tickClock.period).toBeLessThan(700);
    vi.restoreAllMocks();
  });

  it('clamps absurd intervals', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    onWorldTick(1);
    now += 10_000;
    onWorldTick(2);
    expect(tickClock.period).toBeLessThanOrEqual(900);
    vi.restoreAllMocks();
  });
});

describe('combatFxStore', () => {
  const base = { tick: 1, attackerStance: 0, defenderStance: 1, attackerState: 0, defenderState: 0, defenderHp: 26 };

  it('floats damage over the defender and animates the attacker on a hit', () => {
    useCombatFxStore.getState().pushEvent({ ...base, kind: EventKind.Hit, attacker: idA, defender: idB, damage: 4 });
    const s = useCombatFxStore.getState();
    expect(s.attackSeq[idA.toHexString()]).toBe(1);
    expect(s.numbers[idB.toHexString()]?.text).toBe('4');
  });

  it('floats the counter over the attacker', () => {
    useCombatFxStore.getState().pushEvent({ ...base, kind: EventKind.Counter, attacker: idA, defender: idB, damage: 2 });
    expect(useCombatFxStore.getState().numbers[idA.toHexString()]?.text).toBe('2');
  });
});
