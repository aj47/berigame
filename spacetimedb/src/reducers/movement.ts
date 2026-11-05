import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { enterRule, inBounds, nearestReachableTile } from '../../../shared/sim';
import { blockedTiles } from '../lib/blocked';
import { heldKeys } from '../lib/brambles';
import { seedRoute } from '../lib/routes';
import { clearInteractions, currentTick, requireAlivePlayer, savePlayer, touchInput } from '../lib/players';

/**
 * Click on the ground: walk to that tile, or the nearest reachable one. Without
 * a stick that stops short of the bramble hedge (clients explain why).
 */
export const setTarget = spacetimedb.reducer(
  { x: t.i32(), z: t.i32() },
  (ctx, { x, z }) => {
    if (!inBounds({ x, z })) throw new SenderError('target out of bounds');
    const p = requireAlivePlayer(ctx);
    touchInput(p, currentTick(ctx));
    clearInteractions(ctx, p);
    const blocked = blockedTiles(ctx), keys = heldKeys(ctx, p);
    // The route found here is the tick's first walk step too (lib/routes.ts): searched once, not twice.
    const dest = nearestReachableTile(p, { x, z }, blocked, enterRule(keys.stick, keys.club), (path) => seedRoute(ctx, p, { x, z }, path, keys, blocked));
    p.targetX = dest.x;
    p.targetZ = dest.z;
    savePlayer(ctx, p);
  }
);

/** Stop whatever you are doing. */
export const cancel = spacetimedb.reducer((ctx) => {
  const p = requireAlivePlayer(ctx, true);
  touchInput(p, currentTick(ctx));
  clearInteractions(ctx, p);
  savePlayer(ctx, p);
});
