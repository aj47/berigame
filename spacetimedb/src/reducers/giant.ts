import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { GIANT_ID, GIANT_REACH, GiantState, Pending, chebyshev, formatCountdown } from '../../../shared/sim';
import { requireOwner } from '../lib/access';
import { countRaiders, ensureRaid, nowMs, wakeGiant } from '../lib/raid';
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
    if (giant.state === GiantState.Asleep) {
      const raid = ensureRaid(ctx, T);
      throw new SenderError(`The Giant is asleep. It wakes in ${formatCountdown(Number(raid.nextWakeAtMicros / 1000n), nowMs(ctx))}`);
    }
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

/**
 * World owner only (testing): `delaySeconds` 0 wakes the Giant now (raid HP
 * from the players in the Boulders); more schedules the next wake that far
 * ahead, so the T-10 / T-1 announcements can be seen. Refused mid-raid.
 */
export const triggerGiantRaid = spacetimedb.reducer(
  { delaySeconds: t.u32() },
  (ctx, { delaySeconds }) => {
    requireOwner(ctx);
    const T = currentTick(ctx);
    const raid = ensureRaid(ctx, T);
    if (raid.awake) throw new SenderError('A raid is already on');
    if (delaySeconds === 0) { wakeGiant(ctx, T, countRaiders(ctx.db.player.iter())); return; }
    const wake = ctx.timestamp.microsSinceUnixEpoch + BigInt(delaySeconds) * 1_000_000n;
    ctx.db.giantRaid.id.update({ ...raid, nextWakeAtMicros: wake, announced: 0 });
  }
);
