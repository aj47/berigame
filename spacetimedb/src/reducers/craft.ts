import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { statsCraft } from '../lib/stats';
import { Skill, craft as craftSlots, craftRejection, getItemDef, getRecipe, hasCosmetic } from '../../../shared/sim';
import { dropOnGround, readSlots, writeSlots } from '../lib/inventory';
import { currentTick, requireAlivePlayer, savePlayer, touchInput } from '../lib/players';
import { cosmeticRow, grantXp, skillLevel, unlockCosmetic } from '../lib/progress';

/**
 * The verb "make": turn a recipe's inputs into its output, instantly.
 * Rejected while dead or attacking someone, or below the recipe's Crafting
 * level. An output that does not fit in the bag lands on the ground under
 * you. A cosmetic recipe records its cosmetic instead of making an item.
 * Every make earns Crafting XP.
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
    const why = craftRejection(snap.slots, def, skillLevel(ctx, p.identity, Skill.Crafting));
    if (why) throw new SenderError(why);
    if (def.cosmetic !== undefined && hasCosmetic(cosmeticRow(ctx, p.identity).unlocked, def.cosmetic)) {
      throw new SenderError(`You already have the ${def.name}`);
    }
    const made = craftSlots(snap.slots, def)!;
    writeSlots(ctx, p.identity, snap, made.slots);
    if (def.output && made.overflow > 0) dropOnGround(ctx, p.identity, def.output.itemId, made.overflow, p, T);
    if (def.cosmetic !== undefined) unlockCosmetic(ctx, p.identity, def.cosmetic);
    grantXp(ctx, p.identity, Skill.Crafting, def.xp);
    savePlayer(ctx, p);
    statsCraft(ctx, p.identity);
  }
);
