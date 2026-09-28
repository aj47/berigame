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
import { DRIFTWOOD_ITEM_ID, FLINT_ITEM_ID, STONE_CLUB_ITEM_ID, getItemDef } from './items';
import type { Slot, Tile } from './types';

/** `tree.kind` on the wire (u8). */
export const NodeKind = { Berry: 0, Driftwood: 1, TideRock: 2 } as const;
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
 * four corners, 4-5 tiles past the hedge corners.
 */
export const NODE_SEEDS: readonly NodeSeed[] = [
  { id: 101, x: 25, z: 3, kind: NodeKind.Driftwood, itemId: DRIFTWOOD_ITEM_ID },
  { id: 102, x: 46, z: 25, kind: NodeKind.Driftwood, itemId: DRIFTWOOD_ITEM_ID },
  { id: 103, x: 25, z: 46, kind: NodeKind.Driftwood, itemId: DRIFTWOOD_ITEM_ID },
  { id: 104, x: 3, z: 25, kind: NodeKind.Driftwood, itemId: DRIFTWOOD_ITEM_ID },
  { id: 105, x: 3, z: 3, kind: NodeKind.TideRock, itemId: FLINT_ITEM_ID },
  { id: 106, x: 46, z: 3, kind: NodeKind.TideRock, itemId: FLINT_ITEM_ID },
  { id: 107, x: 3, z: 46, kind: NodeKind.TideRock, itemId: FLINT_ITEM_ID },
  { id: 108, x: 46, z: 46, kind: NodeKind.TideRock, itemId: FLINT_ITEM_ID },
];

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
  output: RecipeInput;
}

export const RECIPES: readonly Recipe[] = [
  {
    id: STONE_CLUB_ITEM_ID,
    name: 'Stone Club',
    inputs: [{ itemId: DRIFTWOOD_ITEM_ID, quantity: 1 }, { itemId: FLINT_ITEM_ID, quantity: 2 }],
    output: { itemId: STONE_CLUB_ITEM_ID, quantity: 1 },
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

/** Recipe status for the agent API and the chip. */
export function recipeStatus(slots: readonly Slot[]) {
  return RECIPES.map((r) => {
    const missing = recipeMissing(slots, r);
    return {
      id: r.id,
      name: r.name,
      inputs: r.inputs.map((i) => ({ itemId: i.itemId, name: getItemDef(i.itemId)?.name ?? i.itemId, quantity: i.quantity })),
      canCraft: missing.length === 0,
      missing,
    };
  });
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
  const added = addItem(out, recipe.output.itemId, recipe.output.quantity);
  return { slots: added.slots, overflow: added.remaining };
}
