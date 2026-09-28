/**
 * Plain numeric codes rather than TS enums so values round-trip through
 * SpacetimeDB `t.u8()` columns with no conversion on either side.
 */

export interface Tile {
  x: number;
  z: number;
}

export const PlayerState = { Alive: 0, Dead: 1 } as const;
export type PlayerState = (typeof PlayerState)[keyof typeof PlayerState];

/** A "walk there, then do X" interaction queued on the server. */
export const Pending = { None: 0, Harvest: 1, Pickup: 2 } as const;
export type Pending = (typeof Pending)[keyof typeof Pending];

/**
 * `combat_event.kind` is a raw u8 on the wire, so retired kinds keep their
 * numbers: 1-3 were the rock-paper-scissors Clash, Counter and Knockback.
 */
export const EventKind = {
  Hit: 0,
  Death: 4,
  Eat: 5,
  HarvestDone: 6,
  /** A harvest also turned up a bonus item (`itemId`), e.g. a stick. */
  ItemFound: 7,
} as const;
export type EventKind = (typeof EventKind)[keyof typeof EventKind];

/** 0 = +z (south), increasing clockwise when viewed from above: 0 S, 1 SW, 2 W, 3 NW, 4 N, 5 NE, 6 E, 7 SE. */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ItemStack {
  itemId: string;
  quantity: number;
}
export type Slot = ItemStack | null;
