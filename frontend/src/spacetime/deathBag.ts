import { useMemo } from 'react';
import { create } from 'zustand';
import { GROUND_ITEM_TTL_TICKS, TICK_MS, type Tile } from '@sim';
import type { GroundItem } from '../module_bindings/types';
import { useGroundItems, useMyIdentityHex, useTick } from './hooks';

export interface DeathBag extends Tile {
  /** Piles still on the ground from your latest defeat. */
  piles: number;
  droppedTick: number;
  expiresTick: number;
}

/**
 * Where your latest defeat left your things: the piles you dropped on death
 * that still exist, from the most recent death (the centre tile of that ring).
 */
export function deathBagOf(items: readonly GroundItem[], me: string | null): DeathBag | null {
  if (!me) return null;
  const mine = items.filter((i) => i.droppedOnDeath && i.droppedBy.toHexString() === me);
  if (mine.length === 0) return null;
  const latest = Math.max(...mine.map((i) => i.droppedTick));
  const group = mine.filter((i) => i.droppedTick === latest);
  const x = Math.round(group.reduce((s, i) => s + i.x, 0) / group.length);
  const z = Math.round(group.reduce((s, i) => s + i.z, 0) / group.length);
  return { x, z, piles: group.length, droppedTick: latest, expiresTick: Math.max(...group.map((i) => i.expiresTick)) };
}

export function useMyDeathBag(): DeathBag | null {
  const items = useGroundItems();
  const me = useMyIdentityHex();
  return useMemo(() => deathBagOf(items, me), [items, me]);
}

/** 1 when just dropped, 0 at expiry. */
export function bagLifeLeft(bag: DeathBag, tick: number): number {
  return Math.max(0, Math.min(1, (bag.expiresTick - tick) / GROUND_ITEM_TTL_TICKS));
}

export function formatTicks(ticks: number): string {
  const s = Math.max(0, Math.ceil((ticks * TICK_MS) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

/**
 * Screen angle (radians, clockwise from straight up the screen) from one tile
 * to another, for a camera whose view direction on the ground is `look`.
 */
export function compassAngle(from: Tile, to: Tile, look: { x: number; z: number }): number {
  const tx = to.x - from.x, tz = to.z - from.z;
  // Screen right for a camera looking along (lx, lz) on the ground is (-lz, lx).
  return Math.atan2(tx * -look.z + tz * look.x, tx * look.x + tz * look.z);
}

/** The camera's view direction on the ground, published from inside the canvas so DOM overlays can orient a compass. */
export const useCameraLook = create<{ x: number; z: number }>(() => ({ x: 0, z: -1 }));
