import { MAX_STACK } from './constants';
import type { Tile } from './types';

export interface ItemDef {
  id: string;
  name: string;
  icon: string;
  /** HP restored when eaten; 0 for non-consumables. */
  healthRestore: number;
  maxStack: number;
  color: string;
}

/** Mirrors shared/itemDefinitions.js (the legacy CommonJS copy used by the Lambda backend). */
export const ITEM_DEFS: Record<string, ItemDef> = {
  berry_blueberry: { id: 'berry_blueberry', name: 'Blueberry', icon: '/items/blueberry.png', healthRestore: 5, maxStack: MAX_STACK, color: '#4F46E5' },
  berry_strawberry: { id: 'berry_strawberry', name: 'Strawberry', icon: '/items/strawberry.png', healthRestore: 3, maxStack: MAX_STACK, color: '#EF4444' },
  berry_greenberry: { id: 'berry_greenberry', name: 'Greenberry', icon: '/items/greenberry.png', healthRestore: 2, maxStack: MAX_STACK, color: '#22C55E' },
  berry_goldberry: { id: 'berry_goldberry', name: 'Goldberry', icon: '/items/goldberry.png', healthRestore: 10, maxStack: MAX_STACK, color: '#F59E0B' },
};

export function getItemDef(itemId: string): ItemDef | undefined {
  return ITEM_DEFS[itemId];
}

export function isValidItemId(itemId: string): boolean {
  return itemId in ITEM_DEFS;
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
