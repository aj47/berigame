import { carrying, duelFor } from '../lib/adventure';
import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { MELEE_RANGE, Pending, chebyshev } from '../../../shared/sim';
import { blockedTiles } from '../lib/blocked';
import { interactionTile } from '../lib/brambles';
import { clearInteractions, currentTick, requireAlivePlayer, sameId, savePlayer, touchInput } from '../lib/players';
import { refuseOnSpireFloor } from '../lib/spireGuards';

/**
 * Walk next to a berry tree (or a Coast node: driftwood pile, tide rock) and pick from it. A regrowing or claimed tree is
 * not an error: the player waits next to it. Claims are never made here, only by the tick, which draws among everyone
 * beside a free node (newcomers first), so a fast client or bot cannot win by calling first.
 */
export const startHarvest = spacetimedb.reducer(
  { treeId: t.u32() },
  (ctx, { treeId }) => {
    const tree = ctx.db.tree.id.find(treeId);
    if (!tree) throw new SenderError('no such tree');
    const T = currentTick(ctx);
    const p = requireAlivePlayer(ctx);
    refuseOnSpireFloor(p);
    if (carrying(ctx, p.identity)) throw new SenderError("Put down the giant berry first; it needs both hands");
    touchInput(p, T);
    // Picking the tree you are already harvesting keeps the harvest going. Releasing
    // it first (below) would requeue you and restart the harvest from zero.
    if (p.harvestTreeId === tree.id && sameId(tree.harvester, p.identity)) {
      savePlayer(ctx, p);
      return;
    }
    clearInteractions(ctx, p);
    p.pending = Pending.Harvest;
    p.pendingId = BigInt(tree.id);
    if (chebyshev(p, tree) > MELEE_RANGE) {
      const dest = interactionTile(ctx, p, tree, blockedTiles(ctx), MELEE_RANGE);
      p.targetX = dest.x;
      p.targetZ = dest.z;
    }
    savePlayer(ctx, p);
  }
);
