import { wikiUrl } from './siteUrls';
import { ITEM_DEFS, xpForLevel } from '@sim';
import type { Recipe } from '@sim';

export const MAX_PLAN_QUANTITY = 999;

export function recipeQuantityLimit(recipe: Recipe): number {
  // The server refuses a cosmetic recipe once its keepsake is unlocked.
  return recipe.cosmetic !== undefined ? 1 : MAX_PLAN_QUANTITY;
}

export function parseRecipeQuantity(value: string, limit = MAX_PLAN_QUANTITY): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= limit ? quantity : null;
}

const itemHref = (itemId: string) => wikiUrl(`item-${itemId.replaceAll('_', '-')}`);

export function planRecipe(recipe: Recipe, value: string) {
  const quantity = parseRecipeQuantity(value, recipeQuantityLimit(recipe));
  if (quantity === null) return null;
  return {
    quantity,
    xp: recipe.xp * quantity,
    requiredXp: xpForLevel(recipe.level),
    outputQuantity: recipe.output ? recipe.output.quantity * quantity : 1,
    outputHref: recipe.output ? itemHref(recipe.output.itemId) : wikiUrl('skills-progression#keepsakes'),
    ingredients: recipe.inputs.map(input => ({
      ...input,
      quantity: input.quantity * quantity,
      name: ITEM_DEFS[input.itemId].name,
      icon: ITEM_DEFS[input.itemId].icon,
      href: itemHref(input.itemId),
    })),
  };
}
