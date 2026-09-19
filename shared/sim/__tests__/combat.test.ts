import { describe, expect, it } from 'vitest';
import { beats, decayFightState, isSwingDue, resolveSwing, retaliationSwingTick, rpsResult } from '../combat';
import { DAMAGE, OUT_OF_RANGE_DECAY_TICKS, STATE_DECAY_TICKS } from '../constants';
import { EventKind, FightState, Stance } from '../types';

describe('rock paper scissors', () => {
  it('Strike > Grab > Guard > Strike, everything else draws or loses', () => {
    const table: Array<[Stance, Stance, string]> = [
      [Stance.Strike, Stance.Grab, 'win'], [Stance.Grab, Stance.Guard, 'win'], [Stance.Guard, Stance.Strike, 'win'],
      [Stance.Grab, Stance.Strike, 'lose'], [Stance.Guard, Stance.Grab, 'lose'], [Stance.Strike, Stance.Guard, 'lose'],
      [Stance.Strike, Stance.Strike, 'draw'], [Stance.Grab, Stance.Grab, 'draw'], [Stance.Guard, Stance.Guard, 'draw'],
    ];
    for (const [a, b, r] of table) expect(rpsResult(a, b)).toBe(r);
    expect(beats(Stance.Strike, Stance.Grab)).toBe(true);
    expect(beats(Stance.Grab, Stance.Strike)).toBe(false);
  });
});

describe('resolveSwing', () => {
  const c = (stance: Stance, fightState: FightState) => ({ stance, fightState });

  it('neutral hit deals 4 and flips states', () => {
    const o = resolveSwing(c(Stance.Strike, FightState.Neutral), c(Stance.Grab, FightState.Neutral));
    expect(o.kind).toBe(EventKind.Hit);
    expect(o.damageToDefender).toBe(DAMAGE.NEUTRAL);
    expect(o.damageToAttacker).toBe(0);
    expect(o.knockback).toBe(false);
    expect(o.attackerState).toBe(FightState.Advantage);
    expect(o.defenderState).toBe(FightState.Disadvantage);
  });

  it('advantage hit deals 6 with knockback', () => {
    const o = resolveSwing(c(Stance.Guard, FightState.Advantage), c(Stance.Strike, FightState.Disadvantage));
    expect(o.damageToDefender).toBe(DAMAGE.ADVANTAGE);
    expect(o.knockback).toBe(true);
  });

  it('disadvantage (escape) hit deals 3 and takes advantage back', () => {
    const o = resolveSwing(c(Stance.Grab, FightState.Disadvantage), c(Stance.Guard, FightState.Advantage));
    expect(o.damageToDefender).toBe(DAMAGE.DISADVANTAGE);
    expect(o.knockback).toBe(false);
    expect(o.attackerState).toBe(FightState.Advantage);
    expect(o.defenderState).toBe(FightState.Disadvantage);
  });

  it('counter hurts the attacker and gives the defender advantage', () => {
    const o = resolveSwing(c(Stance.Strike, FightState.Advantage), c(Stance.Guard, FightState.Disadvantage));
    expect(o.kind).toBe(EventKind.Counter);
    expect(o.damageToDefender).toBe(0);
    expect(o.damageToAttacker).toBe(DAMAGE.COUNTER);
    expect(o.attackerState).toBe(FightState.Disadvantage);
    expect(o.defenderState).toBe(FightState.Advantage);
  });

  it('clash does nothing and keeps states', () => {
    const o = resolveSwing(c(Stance.Guard, FightState.Advantage), c(Stance.Guard, FightState.Neutral));
    expect(o.kind).toBe(EventKind.Clash);
    expect(o.damageToDefender).toBe(0);
    expect(o.damageToAttacker).toBe(0);
    expect(o.attackerState).toBe(FightState.Advantage);
    expect(o.defenderState).toBe(FightState.Neutral);
  });
});

describe('state decay', () => {
  it('drops to neutral after the idle threshold', () => {
    expect(decayFightState(FightState.Advantage, STATE_DECAY_TICKS - 1, 0)).toBe(FightState.Advantage);
    expect(decayFightState(FightState.Advantage, STATE_DECAY_TICKS, 0)).toBe(FightState.Neutral);
  });
  it('drops to neutral after being out of range', () => {
    expect(decayFightState(FightState.Disadvantage, 1, OUT_OF_RANGE_DECAY_TICKS - 1)).toBe(FightState.Disadvantage);
    expect(decayFightState(FightState.Disadvantage, 1, OUT_OF_RANGE_DECAY_TICKS)).toBe(FightState.Neutral);
  });
  it('neutral stays neutral', () => {
    expect(decayFightState(FightState.Neutral, 0, 0)).toBe(FightState.Neutral);
  });
});

describe('rally timing', () => {
  it('retaliator swings 2 ticks after the opponent', () => {
    expect(retaliationSwingTick(10, 12)).toBe(14);
  });
  it('advances into the future when the opponent swing is stale', () => {
    expect(retaliationSwingTick(20, 12)).toBe(22);
    expect(retaliationSwingTick(22, 12)).toBe(26);
  });
  it('isSwingDue', () => {
    expect(isSwingDue(5, 5)).toBe(true);
    expect(isSwingDue(4, 5)).toBe(false);
  });
});
