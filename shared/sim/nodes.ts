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
import { BERRY_MASH_ITEM_ID, DRIFTWOOD_ITEM_ID, FLINT_ITEM_ID, FLINT_KNIFE_ITEM_ID, OBSIDIAN_ITEM_ID, STONE_CLUB_ITEM_ID, TREE_SEEDS, getItemDef } from './items';
import { TIER_NODES, placeTierNodes, tierNode } from './season';
import { DROP_BOXES } from './banking';
import { WAYSTONES } from './expanse';
import { worldBlockedSet } from './social';
import { reachableTiles } from './pathfinding';
import { enterRule } from './areas';
import { inSpireFloor } from './bossZones';
import { GRID_SIZE, SPAWN_TILE } from './constants';
import { isLandTile, tileKey } from './grid';
import type { Slot, Tile } from './types';

/** `tree.kind` on the wire (u8). */
export const NodeKind = {
  Berry: 0, Driftwood: 1, TideRock: 2, /** M3: the Boulders' rare resource. */ Obsidian: 3,
  // The Long Season's tiered nodes (season.ts TIER_NODES), each gated by a skill level.
  HoneyHive: 4, OysterBed: 5, GlowcapRing: 6, CoralShelf: 7, SunpeachTree: 8, AmberSeam: 9, Starblossom: 10, MoonstoneVein: 11, Dreamvine: 12, FallenStar: 13,
} as const;
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
  ...Object.fromEntries(TIER_NODES.map((d) => [d.kind, { name: d.name, harvestTicks: d.harvestTicks, regrowTicks: d.regrowTicks }])),
} as Record<NodeKind, NodeKindDef>;

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

/** The skill level needed to work a node (1 for the original kinds). */
export function nodeMinLevel(kind: number | undefined): number {
  return tierNode(kind)?.minLevel ?? 1;
}

/** Why a harvester at `level` in the node's skill cannot work it, or null. */
export function nodeLevelRejection(kind: number | undefined, level: number): string | null {
  const def = tierNode(kind);
  if (!def || level >= def.minLevel) return null;
  return `Needs ${def.skill === 0 ? 'Foraging' : 'Beachcombing'} level ${def.minLevel}`;
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

const OUTER_BERRIES = ['berry_greenberry', 'berry_strawberry', 'berry_blueberry', 'berry_greenberry', 'berry_strawberry', 'berry_goldberry'] as const;
const NODE_ITEM: Record<number, string> = {
  [NodeKind.Berry]: 'berry_greenberry', [NodeKind.Driftwood]: DRIFTWOOD_ITEM_ID, [NodeKind.TideRock]: FLINT_ITEM_ID, [NodeKind.Obsidian]: OBSIDIAN_ITEM_ID,
};
/** Consecutive stable ids from `first`; never reorder a published list, only append. */
function outerSeeds(first: number, seeds: readonly (Tile & { kind: NodeKind; itemId?: string })[]): NodeSeed[] {
  return seeds.map((s, i) => ({ id: first + i, x: s.x, z: s.z, kind: s.kind, itemId: s.itemId ?? NODE_ITEM[s.kind] }));
}

/**
 * Driftwood straight past each path crossing (N, E, S, W), tide rocks in the
 * four coves along the natural shoreline.
 */
const BASE_NODE_SEEDS: readonly NodeSeed[] = [
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
  // Eastreach, the causeway and the southern wilds: driftwood and tide rocks
  // alternate around the new shores, each at least 13 tiles from its neighbours.
  ...outerSeeds(111, [[69, 113], [75, 36], [71, 23], [16, 80], [93, 76], [53, 112], [118, 90], [54, 81], [36, 75], [22, 119], [83, 6], [32, 106], [70, 83], [111, 115], [9, 93], [94, 124], [120, 21], [15, 106], [93, 110], [108, 71], [120, 37], [16, 66], [35, 121], [106, 8], [110, 53], [93, 47]].map(([x, z], i) => ({ x, z, kind: i % 2 ? NodeKind.TideRock : NodeKind.Driftwood }))),
  // Berry thickets beside the trails: the original Coast gets its own, and the
  // outer lands are dotted with them. Goldberries stay one in six.
  ...outerSeeds(137, [[114, 110], [93, 17], [81, 20], [52, 99], [24, 104], [42, 88], [66, 101], [98, 82], [28, 80], [116, 21], [111, 101], [101, 39], [74, 89], [102, 20], [25, 95], [109, 91], [84, 96], [74, 112], [19, 115], [61, 91], [30, 7], [37, 40], [15, 96], [77, 30], [90, 28], [114, 30], [100, 98], [108, 82], [21, 42], [75, 98], [22, 7], [28, 118], [8, 22], [46, 42], [14, 41], [37, 97], [29, 43], [42, 21], [87, 8], [51, 90], [19, 84]].map(([x, z], i) => ({ x, z, kind: NodeKind.Berry, itemId: OUTER_BERRIES[i % OUTER_BERRIES.length] }))),
];

/**
 * Every node: the hand-placed ones above, then the Long Season's tiered nodes
 * (ids from 1000), placed deterministically around them.
 */
export const NODE_SEEDS: readonly NodeSeed[] = [
  ...BASE_NODE_SEEDS,
  ...keepLandConnected(placeTierNodes([...TREE_SEEDS, ...BASE_NODE_SEEDS], [...DROP_BOXES, ...WAYSTONES]).map((s) => ({ ...s, kind: s.kind as NodeKind }))),
];

/**
 * Drop any tier node that walls off walkable land (with a stick and a club,
 * as the terrain tests walk it). The gaps placement keeps make this rare; the
 * flood fill makes it certain. The survivors keep their ids.
 */
function keepLandConnected(tier: NodeSeed[]): NodeSeed[] {
  let kept = tier;
  for (let pass = 0; pass < 8; pass++) {
    const blocked = worldBlockedSet([...TREE_SEEDS, ...BASE_NODE_SEEDS, ...kept]);
    const seen = reachableTiles(SPAWN_TILE, blocked, enterRule(true, true));
    const stranded: { x: number; z: number }[] = [];
    for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) {
      const t = { x, z }, k = tileKey(t);
      if (isLandTile(t) && !blocked.has(k) && !inSpireFloor(t) && !seen.has(k)) stranded.push(t);
    }
    if (!stranded.length) break;
    kept = kept.filter((n) => !stranded.some((t) => Math.max(Math.abs(t.x - n.x), Math.abs(t.z - n.z)) <= 1));
  }
  return kept;
}

/** The Long Season's tiered nodes. */
export const TIER_NODE_SEEDS: readonly NodeSeed[] = NODE_SEEDS.filter((s) => tierNode(s.kind));

/** The Coast's driftwood and tide rocks, including the outer lands' shores. */
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
 * The Long Season's recipes (season.ts goods). Crafting XP is half the
 * gathering XP of the raw materials a make consumes, so Crafting keeps pace
 * with the average of the two gathering skills. Nothing here heals or hits.
 * Cosmetic ids are literals (skills.ts Cosmetic) to avoid an import cycle.
 */
const r = (id: string, name: string, level: number, xp: number, inputs: [string, number][], out?: string, cosmetic?: number): Recipe => ({
  id, name, level, xp, inputs: inputs.map(([itemId, quantity]) => ({ itemId, quantity })), ...(out ? { output: { itemId: out, quantity: 1 } } : {}), ...(cosmetic !== undefined ? { cosmetic } : {}),
});
export const SEASON_RECIPES: readonly Recipe[] = [
  r('beeswax_candle', 'Beeswax Candle', 12, 17, [['honeycomb', 2], [DRIFTWOOD_ITEM_ID, 1]], 'beeswax_candle'),
  r('pearl_charm', 'Pearl Charm', 15, 19, [['pearl', 2], [FLINT_ITEM_ID, 1]], 'pearl_charm'),
  r('pearl_strand', 'Pearl Strand', 20, 45, [['pearl', 6], [DRIFTWOOD_ITEM_ID, 1]], undefined, 25),
  r('glow_lantern', 'Glowcap Lantern', 28, 24, [['glowcap', 2], ['beeswax_candle', 1], [DRIFTWOOD_ITEM_ID, 1]], 'glow_lantern'),
  r('coral_totem', 'Coral Totem', 32, 32, [['coral', 3], ['pearl_charm', 1]], 'coral_totem'),
  r('sunpeach_preserves', 'Sunpeach Preserves', 42, 50, [['sunpeach', 3], ['honeycomb', 1]], 'sunpeach_preserves'),
  r('amber_inlay', 'Amber Inlay', 46, 44, [['amber', 3], ['coral_totem', 1]], 'amber_inlay'),
  r('amber_amulet', 'Amber Amulet', 50, 58, [['amber', 4], ['pearl_charm', 2]], undefined, 26),
  r('starpetal_incense', 'Starpetal Incense', 58, 60, [['starpetal', 3], ['glow_lantern', 1]], 'starpetal_incense'),
  r('moonstone_lens', 'Moonstone Lens', 62, 60, [['moonstone', 3], ['amber_inlay', 1]], 'moonstone_lens'),
  r('dream_tonic', 'Dream Tonic', 78, 81, [['dreamplum', 3], ['starpetal_incense', 1]], 'dream_tonic'),
  r('star_iron_ingot', 'Star Iron Ingot', 82, 81, [['star_iron', 3], ['moonstone_lens', 1]], 'star_iron_ingot'),
  r('star_iron_helm', 'Star Iron Helm', 85, 120, [['star_iron_ingot', 3], ['ledger_seal', 20]], undefined, 27),
  r('tidewrights_medallion', "Tidewright's Medallion", 95, 250, [['star_iron_ingot', 2], ['dream_tonic', 2], ['pearl', 10], ['ledger_seal', 40]], undefined, 28),
];

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
  {
    // One per member per Sunken Spire run, spent at the start: obsidian's repeatable sink.
    id: 'spire_key',
    name: 'Spire Key',
    inputs: [{ itemId: 'obsidian', quantity: 3 }, { itemId: 'gleamshell', quantity: 1 }],
    output: { itemId: 'spire_key', quantity: 1 },
    level: 1,
    xp: 30,
  },
  {
    id: 'shard_circlet',
    name: 'Shard Circlet',
    inputs: [{ itemId: 'prism_shard', quantity: 5 }, { itemId: 'obsidian', quantity: 2 }],
    // Cosmetic.ShardCirclet in skills.ts (a literal here avoids an import cycle).
    cosmetic: 15,
    level: 10,
    xp: 60,
  },
  ...SEASON_RECIPES,
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
