import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { statsCraft } from '../lib/stats';
import { craft as craftSlots, getItemDef, getRecipe } from '../../../shared/sim';
import { dropOnGround, readSlots, writeSlots } from '../lib/inventory';
import { currentTick, requireAlivePlayer, savePlayer, touchInput } from '../lib/players';

/**
 * The verb "make": turn a recipe's inputs into its output, instantly.
 * Rejected while dead or attacking someone. An output that does not fit in the
 * bag lands on the ground under you.
 */
export const craft = spacetimedb.reducer(
  { recipe: t.string() },
  (ctx, { recipe }) => {
    const def = getRecipe(recipe);
    if (!def) throw new SenderError('no such recipe');
    const p = requireAlivePlayer(ctx);
    const T = currentTick(ctx);
    touchInput(p, T);
    if (p.hostile) throw new SenderError('Not while fighting');
    const snap = readSlots(ctx, p.identity);
    const made = craftSlots(snap.slots, def);
    if (!made) throw new SenderError(`You need ${def.inputs.map((i) => `${i.quantity} ${(getItemDef(i.itemId)?.name ?? i.itemId).toLowerCase()}`).join(' and ')}`);
    writeSlots(ctx, p.identity, snap, made.slots);
    if (made.overflow > 0) dropOnGround(ctx, p.identity, def.output.itemId, made.overflow, p, T);
    savePlayer(ctx, p);
    statsCraft(ctx, p.identity);
  }
);
