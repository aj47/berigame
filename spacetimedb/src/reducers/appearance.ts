import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { CosmeticSlot, canWear, validAppearance } from '../../../shared/sim';
import { currentTick, requirePlayer, savePlayer, touchInput } from '../lib/players';

/** The sender can change only their own cosmetics; gameplay fields stay intact. */
export const setAppearance = spacetimedb.reducer(
  { hairStyle: t.u8(), skinTone: t.u8(), hairColor: t.u8(), robeColor: t.u8(), wrapColor: t.u8() },
  (ctx, choices) => {
    if (!validAppearance(choices)) throw new SenderError('Choose one of the available styles');
    const player = requirePlayer(ctx);
    touchInput(player, currentTick(ctx));
    const row = { identity: ctx.sender, ...choices };
    if (ctx.db.appearance.identity.find(ctx.sender)) ctx.db.appearance.identity.update(row);
    else ctx.db.appearance.insert(row);
    savePlayer(ctx, player);
  }
);

/**
 * Wear (or take off, cosmetic 0) an earned milestone cosmetic. `slot` is
 * shared/sim CosmeticSlot (0 head, 1 neck); `cosmetic` is its id + 1. Purely
 * visual: nothing reads it but the renderer.
 */
export const wearCosmetic = spacetimedb.reducer(
  { slot: t.u8(), cosmetic: t.u8() },
  (ctx, { slot, cosmetic }) => {
    const player = requirePlayer(ctx);
    touchInput(player, currentTick(ctx));
    const existing = ctx.db.playerCosmetic.identity.find(ctx.sender);
    const row = existing ?? { identity: ctx.sender, unlocked: 0, head: 0, neck: 0 };
    if (!canWear(row.unlocked, slot, cosmetic)) throw new SenderError('You have not earned that yet');
    const next = slot === CosmeticSlot.Head ? { ...row, head: cosmetic } : { ...row, neck: cosmetic };
    if (existing) ctx.db.playerCosmetic.identity.update(next);
    else ctx.db.playerCosmetic.insert(next);
    savePlayer(ctx, player);
  }
);
