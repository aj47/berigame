import { SenderError } from 'spacetimedb/server';
import {
  BOULDER_KEY_ITEM, BOULDER_MESSAGE, BRAMBLE_MESSAGE, STICK_ITEM_ID, bfsPath, enterRule, goalAdjacentTo, holdsItem,
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

/** Both area keys: the stick (brambles) and the stone club (the boulder line), with at most one slot read. */
export function heldKeys(ctx: Ctx, p: PlayerRow): { stick: boolean; club: boolean } {
  const wieldStick = p.weapon === STICK_ITEM_ID, wieldClub = p.weapon === BOULDER_KEY_ITEM;
  if (wieldStick && wieldClub) return { stick: true, club: true };
  const slots = readSlots(ctx, p.identity).slots;
  return {
    stick: wieldStick || holdsItem(slots, '', STICK_ITEM_ID),
    club: wieldClub || holdsItem(slots, '', BOULDER_KEY_ITEM),
  };
}

/** The per-player movement predicate: one-way brambles and the one-way boulder line. */
export function playerEnterRule(ctx: Ctx, p: PlayerRow): EnterRule {
  const k = heldKeys(ctx, p);
  return enterRule(k.stick, k.club);
}

/**
 * The tile `p` should walk to so they end within `range` of `target`. Throws
 * the brambles or boulders message (queueing nothing) when only a barrier is
 * in the way: brambles when the player lacks a stick and a stick alone would
 * do, otherwise boulders.
 */
export function interactionTile(ctx: Ctx, p: PlayerRow, target: Tile, blocked: Set<number>, range = 1): Tile {
  const k = heldKeys(ctx, p);
  const goal = goalAdjacentTo(target, blocked, range);
  const path = bfsPath(p, goal, blocked, enterRule(k.stick, k.club));
  if (path) return path.length > 0 ? path[path.length - 1] : { x: p.x, z: p.z };
  if (!k.stick && bfsPath(p, goal, blocked, enterRule(true, k.club))) throw new SenderError(BRAMBLE_MESSAGE);
  if (bfsPath(p, goal, blocked, enterRule(true, true))) throw new SenderError(k.stick ? BOULDER_MESSAGE : BRAMBLE_MESSAGE);
  throw new SenderError('cannot reach that');
}
