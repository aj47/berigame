import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { PlayerState, retaliationSwingTick } from '../../../shared/sim';
import { clearInteractions, currentTick, findPlayer, requireAlivePlayer, sameId, savePlayer, touchInput } from '../lib/players';

/** Strike / Grab / Guard. Takes effect at the next swing that resolves. */
export const setStance = spacetimedb.reducer(
  { stance: t.u8() },
  (ctx, { stance }) => {
    if (stance > 2) throw new SenderError('unknown stance');
    const p = requireAlivePlayer(ctx);
    if (p.stance === stance) return;
    p.stance = stance;
    savePlayer(ctx, p);
  }
);

/** Walk up to `target` and start swinging at them. */
export const attack = spacetimedb.reducer(
  { target: t.identity() },
  (ctx, { target }) => {
    const p = requireAlivePlayer(ctx);
    if (sameId(target, p.identity)) throw new SenderError('cannot attack yourself');
    const tgt = findPlayer(ctx, target);
    if (!tgt || !tgt.online || tgt.state !== PlayerState.Alive) throw new SenderError('target unavailable');
    const T = currentTick(ctx);
    touchInput(p, T);
    clearInteractions(ctx, p);
    p.combatTarget = target;
    p.hostile = true;
    p.outOfRangeTicks = 0;
    // If they are already swinging at us, slot our swings between theirs (the rally).
    if (tgt.hostile && tgt.combatTarget && sameId(tgt.combatTarget, p.identity)) {
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
