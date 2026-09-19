import {
  DAMAGE,
  OUT_OF_RANGE_DECAY_TICKS,
  RETALIATE_OFFSET_TICKS,
  STATE_DECAY_TICKS,
  SWING_INTERVAL_TICKS,
} from './constants';
import { EventKind, FightState, Stance } from './types';
import type { Combatant, RpsResult, SwingOutcome } from './types';

/** Strike beats Grab, Grab beats Guard, Guard beats Strike (the Smash triangle). */
export function beats(a: Stance, b: Stance): boolean {
  return (a === Stance.Strike && b === Stance.Grab)
    || (a === Stance.Grab && b === Stance.Guard)
    || (a === Stance.Guard && b === Stance.Strike);
}

export function rpsResult(attacker: Stance, defender: Stance): RpsResult {
  if (attacker === defender) return 'draw';
  return beats(attacker, defender) ? 'win' : 'lose';
}

function hitDamageFor(state: FightState): number {
  switch (state) {
    case FightState.Advantage: return DAMAGE.ADVANTAGE;
    case FightState.Disadvantage: return DAMAGE.DISADVANTAGE;
    default: return DAMAGE.NEUTRAL;
  }
}

/**
 * Resolve one swing of `attacker` at `defender`. Pure: the caller applies the
 * outcome (damage, knockback, state changes) to its own rows.
 */
export function resolveSwing(attacker: Combatant, defender: Combatant): SwingOutcome {
  const result = rpsResult(attacker.stance, defender.stance);
  if (result === 'win') {
    return {
      kind: EventKind.Hit,
      damageToDefender: hitDamageFor(attacker.fightState),
      damageToAttacker: 0,
      knockback: attacker.fightState === FightState.Advantage,
      attackerState: FightState.Advantage,
      defenderState: FightState.Disadvantage,
    };
  }
  if (result === 'lose') {
    return {
      kind: EventKind.Counter,
      damageToDefender: 0,
      damageToAttacker: DAMAGE.COUNTER,
      knockback: false,
      attackerState: FightState.Disadvantage,
      defenderState: FightState.Advantage,
    };
  }
  return {
    kind: EventKind.Clash,
    damageToDefender: 0,
    damageToAttacker: 0,
    knockback: false,
    attackerState: attacker.fightState,
    defenderState: defender.fightState,
  };
}

/** Fight state after `ticksSinceExchange` idle ticks / `outOfRangeTicks` consecutive out-of-range ticks. */
export function decayFightState(state: FightState, ticksSinceExchange: number, outOfRangeTicks: number): FightState {
  if (state === FightState.Neutral) return state;
  if (ticksSinceExchange >= STATE_DECAY_TICKS) return FightState.Neutral;
  if (outOfRangeTicks >= OUT_OF_RANGE_DECAY_TICKS) return FightState.Neutral;
  return state;
}

/**
 * Tick on which a retaliating player should first swing so that the pair
 * alternates: opponent's next swing + half a swing interval, advanced by whole
 * intervals until it is in the future.
 */
export function retaliationSwingTick(now: number, opponentNextSwing: number): number {
  let t = opponentNextSwing + RETALIATE_OFFSET_TICKS;
  while (t <= now) t += SWING_INTERVAL_TICKS;
  return t;
}

export function isSwingDue(now: number, nextSwingTick: number): boolean {
  return now >= nextSwingTick;
}
