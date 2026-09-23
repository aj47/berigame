import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { PlayerState, retaliationSwingTick } from '../../../shared/sim';
import { clearInteractions, currentTick, findPlayer, requireAlivePlayer, sameId, savePlayer, touchInput } from '../lib/players';
import { requireCapability } from '../lib/access';

/** Strike / Grab / Guard. Takes effect at the next swing that resolves. */
export const setStance = spacetimedb.reducer(
  { stance: t.u8() },
  (ctx, { stance }) => {
    if (stance > 2) throw new SenderError('unknown stance');
    const p = requireAlivePlayer(ctx);
    if (p.stance === stance) return;
    touchInput(p, currentTick(ctx));
    p.stance = stance;
    savePlayer(ctx, p);
  }
);

/** Walk up to `target` and start swinging at them. */
export const attack = spacetimedb.reducer(
  { target: t.identity() },
  (ctx, { target }) => {
    requireCapability(ctx, ctx.sender, 'combat');
    requireCapability(ctx, target, 'combat');
    const p = requireAlivePlayer(ctx);
    if (sameId(target, p.identity)) throw new SenderError('cannot attack yourself');
    const tgt = findPlayer(ctx, target);
    if (!tgt || !tgt.online || tgt.state !== PlayerState.Alive) throw new SenderError('target unavailable');
    const T = currentTick(ctx);
    touchInput(p, T);
    // Re-selecting the current opponent must not reset or postpone the rally.
    if (p.hostile && sameId(p.combatTarget, target)) {
      savePlayer(ctx, p);
      return;
    }
    const readyAt = p.nextSwingTick;
    clearInteractions(ctx, p);
    p.combatTarget = target;
    p.hostile = true;
    p.outOfRangeTicks = 0;
    // Cooldowns belong to the attacker, not the target. Preserve a swing or
    // eating delay across cancel, movement, following, and target changes.
    if (readyAt > T) {
      p.nextSwingTick = readyAt;
    } else if (tgt.hostile && tgt.combatTarget && sameId(tgt.combatTarget, p.identity)) {
      // A fresh retaliator starts between the opponent's swings (the rally).
      p.nextSwingTick = retaliationSwingTick(T, tgt.nextSwingTick);
    } else {
      p.nextSwingTick = T + 1;
    }
    savePlayer(ctx, p);
  }
);

/** Walk up to `target` and keep next to them without attacking. */
export const follow = spacetimedb.reducer(
  { target: t.identity() },
  (ctx, { target }) => {
    const p = requireAlivePlayer(ctx);
    if (sameId(target, p.identity)) throw new SenderError('cannot follow yourself');
    const tgt = findPlayer(ctx, target);
    if (!tgt || !tgt.online) throw new SenderError('target unavailable');
    touchInput(p, currentTick(ctx));
    clearInteractions(ctx, p);
    p.combatTarget = target;
    p.hostile = false;
    savePlayer(ctx, p);
  }
);
