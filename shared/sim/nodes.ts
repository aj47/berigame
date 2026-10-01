/**
 * M2 "The Coast": gathering nodes and the one recipe.
 *
 * Nodes share the server's `tree` table (a `kind` column tells them apart), so
 * they block their tile and use the same claim / wait-and-claim machinery as
 * berry trees. Node ids start at 101 and the tick seeds any that are missing,
 * so an existing database picks them up with no version column.
 */
import { HARVEST_TICKS, TREE_COOLDOWN_TICKS } from './constants';
import { addItem, countItem, removeFromSlot } from './inventory';
import { BERRY_MASH_ITEM_ID, DRIFTWOOD_ITEM_ID, FLINT_ITEM_ID, FLINT_KNIFE_ITEM_ID, OBSIDIAN_ITEM_ID, STONE_CLUB_ITEM_ID, getItemDef } from './items';
import type { Slot, Tile } from './types';

/** `tree.kind` on the wire (u8). */
export const NodeKind = { Berry: 0, Driftwood: 1, TideRock: 2, /** M3: the Boulders' rare resource. */ Obsidian: 3 } as const;
export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

export interface NodeKindDef {
  name: string;
  harvestTicks: number;
  regrowTicks: number;
}

export const NODE_KINDS: Record<NodeKind, NodeKindDef> = {
  [NodeKind.Berry]: { name: 'Berry tree', harvestTicks: HARVEST_TICKS, regrowTicks: TREE_COOLDOWN_TICKS },
  [NodeKind.Driftwood]: { name: 'Driftwood pile', harvestTicks: 4, regrowTicks: 25 },
  [NodeKind.TideRock]: { name: 'Tide rock', harvestTicks: 6, regrowTicks: 40 },
  // Rare: two outcrops, 8 ticks to chip, 150 to reform (about 1.3 a minute world-wide).
  [NodeKind.Obsidian]: { name: 'Obsidian outcrop', harvestTicks: 8, regrowTicks: 150 },
};

/** Unknown kinds (a newer server) harvest like berry trees. */
export function nodeKindDef(kind: number | undefined): NodeKindDef {
  return NODE_KINDS[(kind ?? 0) as NodeKind] ?? NODE_KINDS[NodeKind.Berry];
}

export function harvestTicksFor(kind: number | undefined): number {
  return nodeKindDef(kind).harvestTicks;
}

export function regrowTicksFor(kind: number | undefined): number {
  return nodeKindDef(kind).regrowTicks;
}

export function isBerryNode(node: { kind?: number }): boolean {
  return (node.kind ?? NodeKind.Berry) === NodeKind.Berry;
}

export interface NodeSeed extends Tile {
  id: number;
  kind: NodeKind;
  itemId: string;
}

/** First node id; 1-100 stay berry trees. */
export const FIRST_NODE_ID = 101;

/**
 * Driftwood straight past each path crossing (N, E, S, W), tide rocks in the
 * four coves along the natural shoreline.
 */
export const NODE_SEEDS: readonly NodeSeed[] = [
  { id: 101, x: 25, z: 3, kind: NodeKind.Driftwood, itemId: DRIFTWOOD_ITEM_ID },
  { id: 102, x: 46, z: 25, kind: NodeKind.Driftwood, itemId: DRIFTWOOD_ITEM_ID },
  { id: 103, x: 25, z: 46, kind: NodeKind.Driftwood, itemId: DRIFTWOOD_ITEM_ID },
  { id: 104, x: 3, z: 25, kind: NodeKind.Driftwood, itemId: DRIFTWOOD_ITEM_ID },
  { id: 105, x: 12, z: 6, kind: NodeKind.TideRock, itemId: FLINT_ITEM_ID },
  { id: 106, x: 39, z: 9, kind: NodeKind.TideRock, itemId: FLINT_ITEM_ID },
  { id: 107, x: 9, z: 40, kind: NodeKind.TideRock, itemId: FLINT_ITEM_ID },
  { id: 108, x: 46, z: 46, kind: NodeKind.TideRock, itemId: FLINT_ITEM_ID },
  // M3: obsidian at the far ends of the Boulders' L, well away from the Giant.
  { id: 109, x: 60, z: 40, kind: NodeKind.Obsidian, itemId: OBSIDIAN_ITEM_ID },
  { id: 110, x: 40, z: 60, kind: NodeKind.Obsidian, itemId: OBSIDIAN_ITEM_ID },
];

/** The M2 Coast nodes (driftwood and tide rocks). */
export const COAST_NODE_SEEDS: readonly NodeSeed[] = NODE_SEEDS.filter((s) => s.kind === NodeKind.Driftwood || s.kind === NodeKind.TideRock);

/** The seeds whose id is not in `existing`: what the tick inserts. Seeding twice is a no-op. */
export function missingNodeSeeds(existing: (id: number) => boolean): NodeSeed[] {
  return NODE_SEEDS.filter((s) => !existing(s.id));
}

// ---- Crafting (the verb "make") --------------------------------------------

export interface RecipeInput { itemId: string; quantity: number }

export interface Recipe {
  id: string;
  name: string;
  inputs: readonly RecipeInput[];
  /** The item made. Absent for a cosmetic recipe (see `cosmetic`). */
  output?: RecipeInput;
  /** shared/sim/skills Cosmetic id this recipe unlocks instead of making an item. */
  cosmetic?: number;
  /** Crafting level needed (F2). 1 = everyone. Only non-power recipes are gated. */
  level: number;
  /** Crafting XP per make. */
  xp: number;
}

/**
 * Recipe balance (ROADMAP §1.4, §8): anything that adds combat power (the
 * club, the knife, food) is open at level 1 or gated only when it adds nothing
 * a stick does not, so levels never buy strength; level gates cover cosmetics
 * and conveniences. Future Area 3 recipes (obsidian) append here with their own level.
 */
export const RECIPES: readonly Recipe[] = [
  {
    id: STONE_CLUB_ITEM_ID,
    name: 'Stone Club',
    inputs: [{ itemId: DRIFTWOOD_ITEM_ID, quantity: 1 }, { itemId: FLINT_ITEM_ID, quantity: 2 }],
    output: { itemId: STONE_CLUB_ITEM_ID, quantity: 1 },
    level: 1,
    xp: 40,
  },
  {
    id: BERRY_MASH_ITEM_ID,
    name: 'Berry Mash',
    inputs: [{ itemId: 'berry_greenberry', quantity: 2 }, { itemId: 'berry_strawberry', quantity: 1 }],
    output: { itemId: BERRY_MASH_ITEM_ID, quantity: 1 },
    level: 1,
    xp: 15,
  },
  {
    id: FLINT_KNIFE_ITEM_ID,
    name: 'Flint Knife',
    inputs: [{ itemId: DRIFTWOOD_ITEM_ID, quantity: 1 }, { itemId: FLINT_ITEM_ID, quantity: 1 }],
    output: { itemId: FLINT_KNIFE_ITEM_ID, quantity: 1 },
    level: 2,
    xp: 25,
  },
  {
    id: 'driftwood_crown',
    name: 'Driftwood Crown',
    inputs: [{ itemId: DRIFTWOOD_ITEM_ID, quantity: 3 }, { itemId: FLINT_ITEM_ID, quantity: 1 }],
    // Cosmetic.DriftwoodCrown in skills.ts (a literal here avoids an import cycle).
    cosmetic: 4,
    level: 5,
    xp: 30,
  },
];

export function getRecipe(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

/** What is still missing for `recipe` (empty when it can be made). */
export function recipeMissing(slots: readonly Slot[], recipe: Recipe): RecipeInput[] {
  const out: RecipeInput[] = [];
  for (const input of recipe.inputs) {
    const have = countItem(slots, input.itemId);
    if (have < input.quantity) out.push({ itemId: input.itemId, quantity: input.quantity - have });
  }
  return out;
}

export function canCraft(slots: readonly Slot[], recipe: Recipe): boolean {
  return recipeMissing(slots, recipe).length === 0;
}

/** Recipe status for the agent API, the bag and the chip. `craftingLevel` defaults to 1. */
export function recipeStatus(slots: readonly Slot[], craftingLevel = 1) {
  return RECIPES.map((r) => {
    const missing = recipeMissing(slots, r);
    const locked = craftingLevel < r.level;
    return {
      id: r.id,
      name: r.name,
      inputs: r.inputs.map((i) => ({ itemId: i.itemId, name: getItemDef(i.itemId)?.name ?? i.itemId, quantity: i.quantity })),
      output: r.output ? { itemId: r.output.itemId, name: getItemDef(r.output.itemId)?.name ?? r.output.itemId, quantity: r.output.quantity } : null,
      cosmetic: r.cosmetic ?? null,
      level: r.level,
      xp: r.xp,
      locked,
      canCraft: missing.length === 0 && !locked,
      missing,
    };
  });
}

/** Why `recipe` cannot be made (null when it can), in the server's words. */
export function craftRejection(slots: readonly Slot[], recipe: Recipe, craftingLevel: number): string | null {
  if (craftingLevel < recipe.level) return `Needs Crafting level ${recipe.level}`;
  if (!canCraft(slots, recipe)) return `You need ${recipe.inputs.map((i) => `${i.quantity} ${(getItemDef(i.itemId)?.name ?? i.itemId).toLowerCase()}`).join(' and ')}`;
  return null;
}

/**
 * Consume the inputs (from the last matching slots first, so the quick bar
 * keeps its stacks) and add the output. `overflow` is how many outputs did not
 * fit: the caller drops them on the ground. Returns null when inputs are missing.
 */
export function craft(slots: readonly Slot[], recipe: Recipe): { slots: Slot[]; overflow: number } | null {
  if (!canCraft(slots, recipe)) return null;
  let out = slots.slice();
  for (const input of recipe.inputs) {
    let left = input.quantity;
    for (let i = out.length - 1; i >= 0 && left > 0; i--) {
      if (out[i]?.itemId !== input.itemId) continue;
      const r = removeFromSlot(out, i, left);
      out = r.slots;
      left -= r.removed;
    }
  }
  if (!recipe.output) return { slots: out, overflow: 0 };
  const added = addItem(out, recipe.output.itemId, recipe.output.quantity);
  return { slots: added.slots, overflow: added.remaining };
}
