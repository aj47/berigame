import { SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { CLATTERHORN_ID, CLATTER_REACH, ClatterState, Pending, chebyshev } from '../../../shared/sim';
import { carrying } from '../lib/adventure';
import { blockedTiles } from '../lib/blocked';
import { interactionTile } from '../lib/brambles';
import { clearInteractions, currentTick, requireAlivePlayer, savePlayer, touchInput } from '../lib/players';
import { activityAction } from '../lib/activity';
import { readBossConfig } from '../lib/rows';
import { refuseOnSpireFloor } from '../lib/spireGuards';

/**
 * Walk up to Clatterhorn in its glade and keep swinging from within
 * Chebyshev 2 of its centre (Pending.Clatterhorn). PvE, open to everyone; a
 * landed swing ends spawn grace; its blows never clear the swing loop.
 */
export const attackClatterhorn = spacetimedb.reducer((ctx) => {
  const p = requireAlivePlayer(ctx);
  refuseOnSpireFloor(p);
  if (carrying(ctx, p.identity)) throw new SenderError('Put down the giant berry first; it needs both hands');
  const T = currentTick(ctx);
  const row = ctx.db.clatterhorn.id.find(CLATTERHORN_ID);
  if (!row || row.state === ClatterState.Closed || !readBossConfig(ctx).clatterhornOpen) {
    throw new SenderError('The glade is quiet: Clatterhorn is away');
  }
  if (row.state === ClatterState.Burrowed) {
    const s = Math.max(1, Math.ceil(((row.stateUntilTick - T) * 6) / 10));
    throw new SenderError(`The beetle has burrowed away. Clatterhorn returns in ${s} s`);
  }
  touchInput(p, T);
  activityAction(ctx, p.identity, 'clatterhorn');
  // Re-selecting the beetle you are already swinging at in reach keeps the rhythm (and drops a stale walk
  // target left from before a charge moved it).
  const inReach = chebyshev(p, row) <= CLATTER_REACH;
  if (p.pending === Pending.Clatterhorn && !p.combatTarget && inReach) {
    p.targetX = undefined; p.targetZ = undefined;
    savePlayer(ctx, p);
    return;
  }
  const readyAt = p.nextSwingTick;
  clearInteractions(ctx, p);
  if (!inReach) {
    const dest = interactionTile(ctx, p, row, blockedTiles(ctx), CLATTER_REACH);
    p.targetX = dest.x;
    p.targetZ = dest.z;
  }
  p.pending = Pending.Clatterhorn;
  p.pendingId = BigInt(CLATTERHORN_ID);
  p.nextSwingTick = Math.max(readyAt, T + 1);
  savePlayer(ctx, p);
});
