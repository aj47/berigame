import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Identity } from 'spacetimedb';
import { EventKind, STICK_ITEM_ID, TICK_MS } from '@sim';
import { STICK_SWING_CLIP, STICK_SWING_IMPACT_MS } from '../animation/stickSwing';
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
  const base = { tick: 1, itemId: '', defenderHp: 26 };
  const hexA = idA.toHexString(), hexB = idB.toHexString();
  beforeEach(() => useCombatFxStore.setState({ seq: 0, numbers: {}, finds: {}, cues: {} }));

  it('floats punch damage over the defender and animates the attacker', () => {
    useCombatFxStore.getState().pushEvent({ ...base, kind: EventKind.Hit, attacker: idA, defender: idB, damage: 3 });
    const s = useCombatFxStore.getState();
    expect(s.numbers[hexB]).toMatchObject({ text: '3', itemId: '', delayMs: 160 });
    expect(s.numbers[hexA]).toBeUndefined();
    expect(s.cues[hexA]?.clip).toBe('Strike');
  });

  it('floats stick damage at the stick impact', () => {
    useCombatFxStore.getState().pushEvent({ ...base, kind: EventKind.Hit, attacker: idA, defender: idB, damage: 6, itemId: STICK_ITEM_ID });
    const s = useCombatFxStore.getState();
    expect(s.numbers[hexB]).toMatchObject({ text: '6', itemId: STICK_ITEM_ID, delayMs: STICK_SWING_IMPACT_MS });
    expect(s.cues[hexA]?.clip).toBe(STICK_SWING_CLIP);
  });

  it.each([
    ['harvest first', [EventKind.HarvestDone, EventKind.ItemFound]],
    ['find first', [EventKind.ItemFound, EventKind.HarvestDone]],
  ])('floats a found stick over the harvester alongside the berry, %s', (_order, kinds) => {
    for (const kind of kinds) {
      const itemId = kind === EventKind.ItemFound ? STICK_ITEM_ID : 'berry_blueberry';
      useCombatFxStore.getState().pushEvent({ ...base, kind, attacker: idA, defender: idA, damage: 0, itemId });
    }
    const s = useCombatFxStore.getState();
    expect(s.numbers[hexA]).toMatchObject({ text: '+1', kind: EventKind.HarvestDone });
    expect(s.finds[hexA]).toMatchObject({ text: '+ Stick', kind: EventKind.ItemFound, itemId: STICK_ITEM_ID });
    // It rises after the '+1' so the two never overlap, and neither animates the harvester.
    expect(s.finds[hexA].delayMs).toBeGreaterThan(s.numbers[hexA].delayMs);
    expect(s.cues[hexA]).toBeUndefined();
  });

  it('clears a found-item float after it has played', () => {
    vi.useFakeTimers();
    useCombatFxStore.getState().pushEvent({ ...base, kind: EventKind.ItemFound, attacker: idA, defender: idA, damage: 0, itemId: STICK_ITEM_ID });
    vi.runAllTimers();
    expect(useCombatFxStore.getState().finds).toEqual({});
    vi.useRealTimers();
  });
});
