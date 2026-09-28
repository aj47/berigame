import { HOTBAR_SIZE, MAX_STACK, PUNCH_DAMAGE, STICK_DROP_CHANCE } from './constants';
import type { Slot, Tile } from './types';

export interface ItemDef {
  id: string;
  name: string;
  icon: string;
  /** HP restored when eaten; 0 for non-consumables. */
  healthRestore: number;
  /** Damage per swing while wielded; 0 for items that cannot be wielded. */
  weaponDamage: number;
  maxStack: number;
  color: string;
}

export const STICK_ITEM_ID = 'stick';
export const DRIFTWOOD_ITEM_ID = 'driftwood';
export const FLINT_ITEM_ID = 'flint';
export const STONE_CLUB_ITEM_ID = 'stone_club';

/**
 * Berries started as a copy of shared/itemDefinitions.js (the legacy CommonJS
 * file used by the retired Lambda backend); the stick exists only here.
 */
export const ITEM_DEFS: Record<string, ItemDef> = {
  berry_blueberry: { id: 'berry_blueberry', name: 'Blueberry', icon: '/items/blueberry.png', healthRestore: 5, weaponDamage: 0, maxStack: MAX_STACK, color: '#4F46E5' },
  berry_strawberry: { id: 'berry_strawberry', name: 'Strawberry', icon: '/items/strawberry.png', healthRestore: 3, weaponDamage: 0, maxStack: MAX_STACK, color: '#EF4444' },
  berry_greenberry: { id: 'berry_greenberry', name: 'Greenberry', icon: '/items/greenberry.png', healthRestore: 2, weaponDamage: 0, maxStack: MAX_STACK, color: '#22C55E' },
  berry_goldberry: { id: 'berry_goldberry', name: 'Goldberry', icon: '/items/goldberry.png', healthRestore: 10, weaponDamage: 0, maxStack: MAX_STACK, color: '#F59E0B' },
  [STICK_ITEM_ID]: { id: STICK_ITEM_ID, name: 'Stick', icon: '/items/stick.png', healthRestore: 0, weaponDamage: 6, maxStack: 1, color: '#8A6A45' },
  [DRIFTWOOD_ITEM_ID]: { id: DRIFTWOOD_ITEM_ID, name: 'Driftwood', icon: '/items/driftwood.png', healthRestore: 0, weaponDamage: 0, maxStack: MAX_STACK, color: '#9C8468' },
  [FLINT_ITEM_ID]: { id: FLINT_ITEM_ID, name: 'Flint Shard', icon: '/items/flint.png', healthRestore: 0, weaponDamage: 0, maxStack: MAX_STACK, color: '#5B6470' },
  [STONE_CLUB_ITEM_ID]: { id: STONE_CLUB_ITEM_ID, name: 'Stone Club', icon: '/items/stone_club.png', healthRestore: 0, weaponDamage: 8, maxStack: 1, color: '#6E6A62' },
};

export function getItemDef(itemId: string): ItemDef | undefined {
  return ITEM_DEFS[itemId];
}

export function isValidItemId(itemId: string): boolean {
  return itemId in ITEM_DEFS;
}

export function isWeapon(itemId: string): boolean {
  return (getItemDef(itemId)?.weaponDamage ?? 0) > 0;
}

/** Damage of one swing with `weapon` wielded ('' = bare fists). */
export function swingDamage(weapon: string): number {
  return weapon ? getItemDef(weapon)?.weaponDamage || PUNCH_DAMAGE : PUNCH_DAMAGE;
}

/** Whether `itemId` sits in one of the quick-access slots, where it can stay wielded. */
export function inHotbar(slots: readonly Slot[], itemId: string): boolean {
  for (let i = 0; i < HOTBAR_SIZE && i < slots.length; i++) if (slots[i]?.itemId === itemId) return true;
  return false;
}

/**
 * `roll` is a uniform [0, 1) draw from the server's deterministic ctx.random,
 * drawn on every finished berry harvest. A player already holding a stick never
 * finds a spare one.
 */
export function harvestFindsStick(roll: number, holdsStick = false): boolean {
  return !holdsStick && roll < STICK_DROP_CHANCE;
}

export interface TreeSeed extends Tile {
  id: number;
  itemId: string;
}

/**
 * The six berry trees. World coords from the old AlphaIsland.tsx and
 * GameComponent.tsx, converted to tiles (tile = world + 25).
 */
export const TREE_SEEDS: readonly TreeSeed[] = [
  { id: 1, x: 40, z: 30, itemId: 'berry_strawberry' }, // [15, 0, 5]
  { id: 2, x: 30, z: 35, itemId: 'berry_greenberry' }, // [5, 0, 10]
  { id: 3, x: 20, z: 30, itemId: 'berry_goldberry' },  // [-5, 0, 5]
  { id: 4, x: 30, z: 25, itemId: 'berry_blueberry' },  // [5, 0, 0]
  { id: 5, x: 15, z: 20, itemId: 'berry_strawberry' }, // [-10, 0, -5]
  { id: 6, x: 25, z: 15, itemId: 'berry_greenberry' }, // [0, 0, -10]
];
