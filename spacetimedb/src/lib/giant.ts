import type { Identity } from 'spacetimedb';
import { GIANT_ID, freshGiant } from '../../../shared/sim';
import type { Ctx } from './types';

/** Insert the Boulders' Giant if it is missing (idempotent; the tick calls it too). */
export function ensureGiant(ctx: Ctx, tick = 0) {
  const row = ctx.db.giant.id.find(GIANT_ID);
  if (row) return row;
  return ctx.db.giant.insert({ id: GIANT_ID, ...freshGiant(tick) });
}

export interface GiantEventInput {
  tick: number;
  kind: number;
  player?: Identity;
  damage?: number;
  itemId?: string;
  quantity?: number;
  hp?: number;
  x?: number;
  z?: number;
}

export function emitGiantEvent(ctx: Ctx, e: GiantEventInput): void {
  ctx.db.giantEvent.insert({
    tick: e.tick,
    giantId: GIANT_ID,
    kind: e.kind,
    player: e.player ?? ctx.identity,
    damage: Math.min(255, e.damage ?? 0),
    itemId: e.itemId ?? '',
    quantity: Math.min(255, e.quantity ?? 0),
    hp: e.hp ?? 0,
    x: e.x ?? 0,
    z: e.z ?? 0,
  });
}
