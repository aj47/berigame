import { blockedSetFromTiles } from '../../../shared/sim';
import type { Ctx } from './types';

/** Tiles nothing can walk onto: every tree. Six rows, so recomputing per call is cheap. */
export function blockedTiles(ctx: Ctx): Set<number> {
  return blockedSetFromTiles(ctx.db.tree.iter());
}
