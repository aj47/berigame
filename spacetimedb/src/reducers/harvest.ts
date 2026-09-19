import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { HARVEST_TICKS, MELEE_RANGE, Pending, chebyshev, nearestReachableTile } from '../../../shared/sim';
import { blockedTiles } from '../lib/blocked';
import { clearInteractions, currentTick, requireAlivePlayer, savePlayer, touchInput } from '../lib/players';

/** Walk next to a berry tree and pick from it. */
export const startHarvest = spacetimedb.reducer(
  { treeId: t.u32() },
  (ctx, { treeId }) => {
    const tree = ctx.db.tree.id.find(treeId);
    if (!tree) throw new SenderError('no such tree');
    const T = currentTick(ctx);
    if (tree.cooldownUntilTick > T) throw new SenderError('tree is regrowing');
    if (tree.harvester !== undefined) throw new SenderError('someone is already harvesting');
    const p = requireAlivePlayer(ctx);
    touchInput(p, T);
    clearInteractions(ctx, p);
    if (chebyshev(p, tree) <= MELEE_RANGE) {
      ctx.db.tree.id.update({ ...tree, harvester: p.identity });
      p.harvestTreeId = tree.id;
      p.harvestEndTick = T + HARVEST_TICKS;
    } else {
      p.pending = Pending.Harvest;
      p.pendingId = BigInt(tree.id);
      const dest = nearestReachableTile(p, tree, blockedTiles(ctx));
      p.targetX = dest.x;
      p.targetZ = dest.z;
    }
    savePlayer(ctx, p);
  }
);
