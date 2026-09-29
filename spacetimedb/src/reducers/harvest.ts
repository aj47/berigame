import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { MELEE_RANGE, Pending, chebyshev } from '../../../shared/sim';
import { harvestTicksForPlayer } from '../lib/progress';
import { blockedTiles } from '../lib/blocked';
import { interactionTile } from '../lib/brambles';
import { clearInteractions, currentTick, requireAlivePlayer, sameId, savePlayer, touchInput } from '../lib/players';

/**
 * Walk next to a berry tree (or a Coast node: driftwood pile, tide rock) and pick from it. A regrowing or claimed tree is
 * not an error: the player waits next to it and claims it when it ripens
 * (newcomers first, then whoever has waited longest).
 */
export const startHarvest = spacetimedb.reducer(
  { treeId: t.u32() },
  (ctx, { treeId }) => {
    const tree = ctx.db.tree.id.find(treeId);
    if (!tree) throw new SenderError('no such tree');
    const T = currentTick(ctx);
    const p = requireAlivePlayer(ctx);
    touchInput(p, T);
    // Picking the tree you are already harvesting keeps the harvest going. Releasing
    // it first (below) would requeue you and restart the harvest from zero.
    if (p.harvestTreeId === tree.id && sameId(tree.harvester, p.identity)) {
      savePlayer(ctx, p);
      return;
    }
    clearInteractions(ctx, p);
    const free = tree.harvester === undefined && tree.cooldownUntilTick <= T;
    if (chebyshev(p, tree) <= MELEE_RANGE) {
      if (free) {
        ctx.db.tree.id.update({ ...tree, harvester: p.identity });
        p.harvestTreeId = tree.id;
        p.harvestEndTick = T + harvestTicksForPlayer(ctx, p.identity, tree);
      } else {
        p.pending = Pending.Harvest;
        p.pendingId = BigInt(tree.id);
      }
    } else {
      const dest = interactionTile(ctx, p, tree, blockedTiles(ctx), MELEE_RANGE);
      p.pending = Pending.Harvest;
      p.pendingId = BigInt(tree.id);
      p.targetX = dest.x;
      p.targetZ = dest.z;
    }
    savePlayer(ctx, p);
  }
);
