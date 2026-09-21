import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { validAppearance } from '../../../shared/sim';
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
