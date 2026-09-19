/**
 * Plain numeric codes rather than TS enums so values round-trip through
 * SpacetimeDB `t.u8()` columns with no conversion on either side.
 */

export interface Tile {
  x: number;
  z: number;
}

export const Stance = { Strike: 0, Grab: 1, Guard: 2 } as const;
export type Stance = (typeof Stance)[keyof typeof Stance];
export const STANCE_NAMES = ['Strike', 'Grab', 'Guard'] as const;

export const FightState = { Neutral: 0, Advantage: 1, Disadvantage: 2 } as const;
export type FightState = (typeof FightState)[keyof typeof FightState];
export const FIGHT_STATE_NAMES = ['Neutral', 'Advantage', 'Disadvantage'] as const;

export const PlayerState = { Alive: 0, Dead: 1 } as const;
export type PlayerState = (typeof PlayerState)[keyof typeof PlayerState];

/** A "walk there, then do X" interaction queued on the server. */
export const Pending = { None: 0, Harvest: 1, Pickup: 2 } as const;
export type Pending = (typeof Pending)[keyof typeof Pending];

export const EventKind = {
  Hit: 0,
  Clash: 1,
  Counter: 2,
  Knockback: 3,
  Death: 4,
  Eat: 5,
  HarvestDone: 6,
} as const;
export type EventKind = (typeof EventKind)[keyof typeof EventKind];

/** 0 = +z (south), increasing clockwise when viewed from above: 0 S, 1 SW, 2 W, 3 NW, 4 N, 5 NE, 6 E, 7 SE. */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Combatant {
  stance: Stance;
  fightState: FightState;
}

export type RpsResult = 'win' | 'draw' | 'lose';

export interface SwingOutcome {
  kind: typeof EventKind.Hit | typeof EventKind.Clash | typeof EventKind.Counter;
  damageToDefender: number;
  damageToAttacker: number;
  knockback: boolean;
  attackerState: FightState;
  defenderState: FightState;
}

export interface ItemStack {
  itemId: string;
  quantity: number;
}
export type Slot = ItemStack | null;
