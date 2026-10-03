import { carrying, duelFor } from '../lib/adventure';
import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { HOTBAR_SIZE, PlayerState, inGrace, inSafeRing, isWeapon, retaliationSwingTick } from '../../../shared/sim';
import { readSlots } from '../lib/inventory';
import { clearInteractions, currentTick, findPlayer, requireAlivePlayer, sameId, savePlayer, touchInput } from '../lib/players';
import { requireCapability } from '../lib/access';

/**
 * Hold the weapon in quick slot `slot` (0..HOTBAR_SIZE-1). Takes effect at the
 * next swing and does not interrupt a fight, so the rally timing is kept.
 */
export const wieldItem = spacetimedb.reducer(
  { slot: t.u8() },
  (ctx, { slot }) => {
    if (slot >= HOTBAR_SIZE) throw new SenderError('weapons are wielded from quick slots 1-3');
    const p = requireAlivePlayer(ctx, true);
    if (carrying(ctx, p.identity)) throw new SenderError("Put down the giant berry first; it needs both hands");
    touchInput(p, currentTick(ctx));
    const item = readSlots(ctx, p.identity).slots[slot];
    if (!item) throw new SenderError('empty slot');
    if (!isWeapon(item.itemId)) throw new SenderError('not a weapon');
    p.weapon = item.itemId;
    savePlayer(ctx, p);
  }
);

/** Put the weapon away and fight with bare fists. */
export const unwield = spacetimedb.reducer(
  (ctx) => {
    const p = requireAlivePlayer(ctx, true);
    if (carrying(ctx, p.identity)) throw new SenderError("Put down the giant berry first; it needs both hands");
    touchInput(p, currentTick(ctx));
    p.weapon = '';
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
    if (carrying(ctx, p.identity)) throw new SenderError("Put down the giant berry first; it needs both hands");
    if (duelFor(ctx, p.identity) || duelFor(ctx, target)) throw new SenderError('Finish the friendly duel before starting ordinary combat');
    if (sameId(target, p.identity)) throw new SenderError('cannot attack yourself');
    const tgt = findPlayer(ctx, target);
    if (!tgt || (tgt.region && tgt.region !== (p.region || 'bramblewild')) || !tgt.online || tgt.state !== PlayerState.Alive) throw new SenderError('target unavailable');
    const T = currentTick(ctx);
    if (inSafeRing(p) || inSafeRing(tgt)) throw new SenderError('No fighting in the safe ring');
    if (inGrace(tgt, T)) throw new SenderError(`They are protected for ${Math.max(1, Math.ceil((tgt.respawnTick + 10 - T) * .6))} more seconds. Invite them to a friendly duel instead.`);
    touchInput(p, T);
    // An accepted attack ends your own grace.
    p.respawnTick = 0;
    // Re-selecting the current opponent must not reset or postpone the rally.
    if (p.hostile && sameId(p.combatTarget, target)) {
      savePlayer(ctx, p);
      return;
    }
    const readyAt = p.nextSwingTick;
    clearInteractions(ctx, p);
    p.combatTarget = target;
    p.hostile = true;
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
    if (carrying(ctx, p.identity)) throw new SenderError("Put down the giant berry first; it needs both hands");
    if (sameId(target, p.identity)) throw new SenderError('cannot follow yourself');
    const tgt = findPlayer(ctx, target);
    if (!tgt || (tgt.region && tgt.region !== (p.region || 'bramblewild')) || !tgt.online) throw new SenderError('target unavailable');
    touchInput(p, currentTick(ctx));
    clearInteractions(ctx, p);
    p.combatTarget = target;
    p.hostile = false;
    savePlayer(ctx, p);
  }
);
