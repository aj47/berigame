import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { GIANT_ID, GIANT_REACH, GiantState, Pending, chebyshev } from '../../../shared/sim';
import { blockedTiles } from '../lib/blocked';
import { interactionTile } from '../lib/brambles';
import { ensureGiant } from '../lib/giant';
import { clearInteractions, currentTick, requireAlivePlayer, savePlayer, touchInput } from '../lib/players';

/**
 * Walk up to the Giant and keep swinging at it with whatever you hold. Open to
 * everyone (no combat grant): it is not a player, so it never ends grace and
 * never makes you hostile. Reaching it needs the Boulders' key (a stone club).
 * Moving, harvesting, attacking a player or being hit by it stops the swings.
 */
export const attackGiant = spacetimedb.reducer(
  { giantId: t.u32() },
  (ctx, { giantId }) => {
    const p = requireAlivePlayer(ctx);
    const T = currentTick(ctx);
    const giant = giantId === GIANT_ID ? ensureGiant(ctx, T) : ctx.db.giant.id.find(giantId);
    if (!giant) throw new SenderError('no such giant');
    if (giant.state === GiantState.Defeated) throw new SenderError('The Giant is down. It rises again soon');
    touchInput(p, T);
    // Re-selecting the Giant you are already hitting keeps the swing rhythm.
    if (p.pending === Pending.Giant && p.pendingId === BigInt(giant.id) && !p.combatTarget) {
      savePlayer(ctx, p);
      return;
    }
    const readyAt = p.nextSwingTick;
    clearInteractions(ctx, p);
    if (chebyshev(p, giant) > GIANT_REACH) {
      const dest = interactionTile(ctx, p, giant, blockedTiles(ctx), GIANT_REACH);
      p.targetX = dest.x;
      p.targetZ = dest.z;
    }
    p.pending = Pending.Giant;
    p.pendingId = BigInt(giant.id);
    p.nextSwingTick = Math.max(readyAt, T + 1);
    savePlayer(ctx, p);
  }
);
