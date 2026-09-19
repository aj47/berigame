import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { inBounds, nearestReachableTile } from '../../../shared/sim';
import { blockedTiles } from '../lib/blocked';
import { clearInteractions, currentTick, requireAlivePlayer, savePlayer, touchInput } from '../lib/players';

/** Click on the ground: walk to that tile (or the nearest reachable one). */
export const setTarget = spacetimedb.reducer(
  { x: t.i32(), z: t.i32() },
  (ctx, { x, z }) => {
    if (!inBounds({ x, z })) throw new SenderError('target out of bounds');
    const p = requireAlivePlayer(ctx);
    touchInput(p, currentTick(ctx));
    clearInteractions(ctx, p);
    const dest = nearestReachableTile(p, { x, z }, blockedTiles(ctx));
    p.targetX = dest.x;
    p.targetZ = dest.z;
    savePlayer(ctx, p);
  }
);

/** Stop whatever you are doing. */
export const cancel = spacetimedb.reducer((ctx) => {
  const p = requireAlivePlayer(ctx);
  touchInput(p, currentTick(ctx));
  clearInteractions(ctx, p);
  savePlayer(ctx, p);
});
