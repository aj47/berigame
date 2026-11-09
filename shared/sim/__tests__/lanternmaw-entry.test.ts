/**
 * Lanternmaw entry, fee, bait and rewards (BOSSES.md 9.2, 9.10): every member
 * needs a weapon and pays one Fen Bait plus the coin fee; fenlight pays out for
 * at most LANTERN_DAILY_PAID_CLEARS qualifying clears per character per UTC
 * day, then Fighting XP only.
 */
import { describe, expect, it } from 'vitest';
import {
  LANTERN_BAIT, LANTERN_BITE_DAMAGE, LANTERN_DAILY_PAID_CLEARS, LANTERN_ENTRY_FEE, LANTERN_HP_BASE, LANTERN_HP_PER_MEMBER,
  LANTERN_KEEPSAKE_RECIPE, LANTERN_MIN_WEAPON_DAMAGE, LANTERN_REWARD,
} from '../constants';
import { getRecipe, NODE_KINDS, nodeMinLevel } from '../nodes';
import { TIER_NODES } from '../season';
import { getItemDef } from '../items';
import { lanternClearReward, lanternEntryRejection, lanternUtcDay } from '../lanternmaw';
import type { Slot } from '../types';

const bag = (...items: [string, number][]): Slot[] => items.map(([itemId, quantity]) => ({ itemId, quantity }));
const BAIT = LANTERN_BAIT.itemId;

describe('Lanternmaw entry', () => {
  it('admits a member with a weapon (wielded or in the bag), a bait and the fee', () => {
    expect(lanternEntryRejection(bag(['stone_club', 1], [BAIT, 1]), LANTERN_ENTRY_FEE, '')).toBeNull();
    expect(lanternEntryRejection(bag([BAIT, 1]), LANTERN_ENTRY_FEE, 'stone_club')).toBeNull();
  });

  it('refuses bare fists and weapons below the floor the validator proves winnable', () => {
    expect(lanternEntryRejection(bag([BAIT, 1]), 100, '')).toMatch(/weapon/);
    expect(LANTERN_MIN_WEAPON_DAMAGE).toBeGreaterThan(3);
    const weak = ['stick', 'flint_knife', 'stone_club', 'iron_club'].filter((w) => (getItemDef(w)?.weaponDamage ?? 0) < LANTERN_MIN_WEAPON_DAMAGE);
    for (const w of weak) expect(lanternEntryRejection(bag([w, 1], [BAIT, 1]), 100, '')).toMatch(/weapon/);
  });

  it('refuses a member without a bait or the coins', () => {
    expect(lanternEntryRejection(bag(['stone_club', 1]), 100, '')).toMatch(/Fen Bait/);
    expect(lanternEntryRejection(bag(['stone_club', 1], [BAIT, 1]), LANTERN_ENTRY_FEE - 1, '')).toMatch(/coins/);
  });

  it('charges a small coin fee: at most a twelfth of the daily order cap', () => {
    expect(LANTERN_ENTRY_FEE).toBeGreaterThan(0);
    expect(LANTERN_ENTRY_FEE * 12).toBeLessThanOrEqual(60);
  });

  it('makes the bait at Crafting 1 from obsidian, driftwood and honeycomb (no gleamshell)', () => {
    expect(LANTERN_BAIT.level).toBe(1);
    expect(LANTERN_BAIT.inputs).toEqual([{ itemId: 'obsidian', quantity: 1 }, { itemId: 'driftwood', quantity: 2 }, { itemId: 'honeycomb', quantity: 3 }]);
    expect(getRecipe(BAIT)?.inputs).toEqual(LANTERN_BAIT.inputs);
    expect(getRecipe(BAIT)?.level).toBe(LANTERN_BAIT.level);
    // Gleamshell has one source (Clatterhorn), so the bait no longer competes with Spire keys for it.
    expect(LANTERN_BAIT.inputs.map((i): string => i.itemId).includes('gleamshell')).toBe(false);
    for (const input of LANTERN_BAIT.inputs) expect(getItemDef(input.itemId), input.itemId).toBeDefined();
  });

  it('uses one tier material, honeycomb (Foraging 15 to gather, tradeable), and nothing above tier 1', () => {
    const tier = LANTERN_BAIT.inputs.map((i) => TIER_NODES.find((d) => d.itemId === i.itemId)).filter((d) => d !== undefined);
    expect(tier.map((d) => d.itemId)).toEqual(['honeycomb']);
    expect(tier[0]).toMatchObject({ key: 'honey_hive', tier: 1, minLevel: 15 });
    // Every other input comes from a node anyone can work at level 1.
    for (const kind of Object.keys(NODE_KINDS).map(Number)) {
      const node = TIER_NODES.find((d) => d.kind === kind);
      if (nodeMinLevel(kind) > 1 && node?.itemId !== 'honeycomb') expect(LANTERN_BAIT.inputs.some((i) => node?.itemId === i.itemId)).toBe(false);
    }
  });
});

describe('Lanternmaw rewards and the daily cap', () => {
  it('pays fenlight and Fighting XP, no goldberries', () => {
    const r = lanternClearReward(120, true, 0);
    expect(r.items).toEqual(LANTERN_REWARD.items);
    expect(r.items.some((i) => i.itemId === 'berry_goldberry')).toBe(false);
    expect(r.fightingXp).toBe(LANTERN_REWARD.fightingXp);
    expect(r.paid).toBe(true);
  });

  it('pays materials for the first N qualifying clears of a UTC day, then XP only', () => {
    expect(LANTERN_DAILY_PAID_CLEARS).toBe(4);
    for (let k = 0; k < LANTERN_DAILY_PAID_CLEARS; k++) expect(lanternClearReward(120, true, k).paid).toBe(true);
    const capped = lanternClearReward(120, true, LANTERN_DAILY_PAID_CLEARS);
    expect(capped.paid).toBe(false);
    expect(capped.items).toEqual([]);
    expect(capped.fightingXp).toBe(LANTERN_REWARD.fightingXp);
  });

  it('pays nothing to a member who does not qualify', () => {
    expect(lanternClearReward(39, true, 0)).toEqual({ items: [], fightingXp: 0, paid: false });
    expect(lanternClearReward(400, false, 0)).toEqual({ items: [], fightingXp: 0, paid: false });
  });

  it('counts days in UTC', () => {
    expect(lanternUtcDay(0)).toBe(0);
    expect(lanternUtcDay(86_400_000 - 1)).toBe(0);
    expect(lanternUtcDay(86_400_000)).toBe(1);
  });

  it('fenlight feeds the keepsake recipe (no weapon recipe)', () => {
    expect(LANTERN_KEEPSAKE_RECIPE.cosmetic).toBe(LANTERN_REWARD.keepsake);
    expect(LANTERN_KEEPSAKE_RECIPE.inputs.some((i) => i.itemId === 'fenlight')).toBe(true);
    expect('output' in LANTERN_KEEPSAKE_RECIPE).toBe(false);
  });

  it('keeps its tunables in constants.ts', () => {
    for (const v of [LANTERN_BITE_DAMAGE, LANTERN_HP_BASE, LANTERN_HP_PER_MEMBER]) expect(v).toBeGreaterThan(0);
  });
});
