import { worldBlockedSet } from '../../../shared/sim';
import type { Ctx } from './types';

/** Tiles nothing can walk onto: every tree and node, and the training dummy. Six rows, so recomputing per call is cheap. */
export function blockedTiles(ctx: Ctx): Set<number> {
  return worldBlockedSet(ctx.db.tree.iter());
}
