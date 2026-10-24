import { worldBlockedSet } from '../../../shared/sim';
import { instanceState } from './activePlayers';
import type { Ctx } from './types';

/**
 * Tiles nothing can walk onto: every tree and node, the dummy and the static
 * scenery. Reducers (move, harvest, pickup, ...) ask for it on every call, and
 * scanning ~1100 nodes each time was the single largest per-call cost at 1000
 * players. Node rows change position only when the tick seeds or moves them,
 * and the tick rebuilds this set whenever their positions change, so a reducer
 * reuses the tick's set while the node count still matches. Read-only: no
 * caller modifies it.
 */
export function blockedTiles(ctx: Ctx): Set<number> {
  const cached = instanceState(ctx).blocked;
  const table = ctx.db.tree as unknown as { count?: () => number | bigint };
  if (cached && typeof table.count === 'function' && Number(table.count()) === cached.trees) return cached.set;
  return worldBlockedSet(ctx.db.tree.iter());
}
