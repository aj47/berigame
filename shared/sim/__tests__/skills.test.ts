import { describe, expect, it } from 'vitest';
import {
  COSMETICS, Cosmetic, CosmeticSlot, SKILL_MAX_LEVEL, SKILL_MAX_XP, Skill, addXp, canWear, cosmeticsForLevelUp,
  harvestTickBonus, harvestTicksAtLevel, harvestXp, hasCosmetic, levelForXp, levelProgress, skillForNode, withCosmetic, xpForLevel,
} from '../skills';
import { NodeKind, RECIPES, craft, craftRejection, getRecipe, recipeStatus } from '../nodes';
import { ITEM_DEFS, getItemDef } from '../items';
import { emptySlots } from '../inventory';

describe('XP math', () => {
  it('xpForLevel(L) = 25·(L−1)², capped at L30', () => {
    expect([1, 2, 3, 10, 20, 30].map(xpForLevel)).toEqual([0, 25, 100, 2025, 9025, 21025]);
    expect(xpForLevel(31)).toBe(21025);
    expect(SKILL_MAX_XP).toBe(21025);
    expect(SKILL_MAX_LEVEL).toBe(30);
  });

  it('levelForXp inverts it exactly at every threshold', () => {
    for (let l = 1; l <= 30; l++) {
      expect(levelForXp(xpForLevel(l))).toBe(l);
      if (l > 1) expect(levelForXp(xpForLevel(l) - 1)).toBe(l - 1);
    }
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-5)).toBe(1);
    expect(levelForXp(10_000_000)).toBe(30);
  });

  it('addXp caps at L30 and ignores negatives', () => {
    expect(addXp(21000, 100)).toBe(21025);
    expect(addXp(10, -4)).toBe(10);
  });

  it('levelProgress reports the span to the next level', () => {
    expect(levelProgress(30)).toEqual({ level: 2, into: 5, span: 75, toNext: 70, max: false });
    expect(levelProgress(SKILL_MAX_XP).max).toBe(true);
  });

  it('about 5 hours of steady foraging reach L30', () => {
    const perSecond = harvestXp(NodeKind.Berry) / 6.6;
    const hours = SKILL_MAX_XP / perSecond / 3600;
    expect(hours).toBeGreaterThan(4);
    expect(hours).toBeLessThan(6);
  });
});

describe('harvest speed from levels', () => {
  it('at most -2 ticks (L10, L20), never below 3, never the gold tree', () => {
    expect([1, 9, 10, 19, 20, 30].map(harvestTickBonus)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(harvestTicksAtLevel(5, 30, 'berry_blueberry')).toBe(3);
    expect(harvestTicksAtLevel(6, 30, 'flint')).toBe(4);
    expect(harvestTicksAtLevel(4, 30, 'driftwood')).toBe(3);
    expect(harvestTicksAtLevel(5, 30, 'berry_goldberry')).toBe(5);
    expect(harvestTicksAtLevel(2, 30)).toBe(2);
  });

  it('nodes train the right skill', () => {
    expect(skillForNode(NodeKind.Berry)).toBe(Skill.Foraging);
    expect(skillForNode(NodeKind.Driftwood)).toBe(Skill.Beachcombing);
    expect(skillForNode(NodeKind.TideRock)).toBe(Skill.Beachcombing);
  });
});

describe('recipes and level gates', () => {
  const bag = (items: [string, number][]) => { const s = emptySlots(); items.forEach(([itemId, quantity], i) => { s[i] = { itemId, quantity }; }); return s; };

  it('power recipes are never gated above what a stick gives; only cosmetics and the stick-equal knife are', () => {
    for (const r of RECIPES) {
      const out = r.output ? getItemDef(r.output.itemId) : undefined;
      if (r.level > 1) expect(out?.weaponDamage ?? 0).toBeLessThanOrEqual(ITEM_DEFS.stick.weaponDamage);
      if (r.level > 1) expect(out?.healthRestore ?? 0).toBe(0);
    }
    expect(getItemDef('flint_knife')!.weaponDamage).toBeLessThan(getItemDef('stone_club')!.weaponDamage);
    expect(getItemDef('berry_mash')!.healthRestore).toBeLessThan(getItemDef('berry_goldberry')!.healthRestore);
  });

  it('recipeStatus marks locked recipes and craftRejection names the level', () => {
    const slots = bag([['driftwood', 3], ['flint', 2]]);
    const status = recipeStatus(slots, 1);
    expect(status.find((r) => r.id === 'flint_knife')).toMatchObject({ locked: true, canCraft: false, level: 2 });
    expect(status.find((r) => r.id === 'stone_club')).toMatchObject({ locked: false, canCraft: true });
    expect(recipeStatus(slots, 5).find((r) => r.id === 'driftwood_crown')).toMatchObject({ locked: false, canCraft: true, cosmetic: Cosmetic.DriftwoodCrown });
    expect(craftRejection(slots, getRecipe('flint_knife')!, 1)).toBe('Needs Crafting level 2');
    expect(craftRejection(slots, getRecipe('flint_knife')!, 2)).toBeNull();
  });

  it('a cosmetic recipe consumes its inputs and makes no item', () => {
    const made = craft(bag([['driftwood', 3], ['flint', 1]]), getRecipe('driftwood_crown')!)!;
    expect(made.slots.filter(Boolean)).toEqual([]);
    expect(made.overflow).toBe(0);
  });
});

describe('cosmetics', () => {
  it('ids are stable bit indexes and every recipe cosmetic exists', () => {
    COSMETICS.forEach((c, i) => expect(c.id).toBe(i));
    for (const r of RECIPES) if (r.cosmetic !== undefined) expect(COSMETICS[r.cosmetic]).toBeDefined();
  });

  it('level-ups unlock skill cosmetics once, crossing the threshold', () => {
    expect(cosmeticsForLevelUp(Skill.Foraging, 9, 10)).toEqual([Cosmetic.FlowerCrown]);
    expect(cosmeticsForLevelUp(Skill.Foraging, 10, 11)).toEqual([]);
    expect(cosmeticsForLevelUp(Skill.Beachcombing, 1, 30)).toEqual([Cosmetic.ShellNecklace]);
    expect(cosmeticsForLevelUp(Skill.Crafting, 9, 10)).toEqual([Cosmetic.WovenSash]);
  });

  it('canWear: earned, right slot, or nothing', () => {
    const mask = withCosmetic(0, Cosmetic.StrawHat);
    expect(hasCosmetic(mask, Cosmetic.StrawHat)).toBe(true);
    expect(canWear(mask, CosmeticSlot.Head, Cosmetic.StrawHat + 1)).toBe(true);
    expect(canWear(mask, CosmeticSlot.Neck, Cosmetic.StrawHat + 1)).toBe(false);
    expect(canWear(mask, CosmeticSlot.Head, Cosmetic.FlowerCrown + 1)).toBe(false);
    expect(canWear(0, CosmeticSlot.Neck, 0)).toBe(true);
    expect(canWear(0, 7, 0)).toBe(false);
    expect(canWear(0xffffffff, CosmeticSlot.Head, 99)).toBe(false);
  });
});
