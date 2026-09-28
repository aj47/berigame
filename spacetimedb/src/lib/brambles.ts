import { SenderError } from 'spacetimedb/server';
import {
  BRAMBLE_MESSAGE, STICK_ITEM_ID, bfsPath, enterRule, goalAdjacentTo, holdsItem,
  type EnterRule, type Tile,
} from '../../../shared/sim';
import { readSlots } from './inventory';
import type { Ctx, PlayerRow } from './types';

/**
 * Whether `p` holds the bramble key. A wielded stick always sits in the quick
 * bar, so the weapon check skips the slot read for most armed players.
 */
export function holdsStick(ctx: Ctx, p: PlayerRow): boolean {
  if (p.weapon === STICK_ITEM_ID) return true;
  return holdsItem(readSlots(ctx, p.identity).slots, '', STICK_ITEM_ID);
}

/** The per-player movement predicate: one-way brambles. */
export function playerEnterRule(ctx: Ctx, p: PlayerRow): EnterRule {
  return enterRule(holdsStick(ctx, p));
}

/**
 * The tile `p` should walk to so they end within `range` of `target`. Throws
 * the brambles message (queueing nothing) when only the hedge is in the way.
 */
export function interactionTile(ctx: Ctx, p: PlayerRow, target: Tile, blocked: Set<number>, range = 1): Tile {
  const path = bfsPath(p, goalAdjacentTo(target, blocked, range), blocked, playerEnterRule(ctx, p));
  if (path) return path.length > 0 ? path[path.length - 1] : { x: p.x, z: p.z };
  if (bfsPath(p, goalAdjacentTo(target, blocked, range), blocked)) throw new SenderError(BRAMBLE_MESSAGE);
  throw new SenderError('cannot reach that');
}
