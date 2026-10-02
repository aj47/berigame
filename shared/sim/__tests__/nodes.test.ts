import { describe, expect, it } from 'vitest';
import { areaOf, coastPastCrossing, enterRule, HEDGE_CROSSINGS, ringOf } from '../areas';
import { GRID_SIZE, HEDGE_RING, HOTBAR_SIZE, MAX_STACK, SPAWN_TILE } from '../constants';
import { blockedSetFromTiles, chebyshev } from '../grid';
import { emptySlots } from '../inventory';
import { getItemDef, swingDamage, TREE_SEEDS } from '../items';
import {
  craft, getRecipe, harvestTicksFor, missingNodeSeeds, NODE_SEEDS, COAST_NODE_SEEDS, NodeKind, recipeMissing, recipeStatus, regrowTicksFor,
} from '../nodes';
import { reachableTiles } from '../pathfinding';
import type { Slot, Tile } from '../types';

const club = getRecipe('stone_club')!;
const bag = (...items: [string, number][]): Slot[] => {
  const s = emptySlots();
  items.forEach(([itemId, quantity], i) => { s[i] = { itemId, quantity }; });
  return s;
};
const tileOf = (k: number): Tile => ({ x: k % GRID_SIZE, z: Math.floor(k / GRID_SIZE) });

describe('Coast nodes', () => {
  it('4 driftwood piles past the path crossings and 4 cove tide rocks, all on the Coast', () => {
    const wood = COAST_NODE_SEEDS.filter((n) => n.kind === NodeKind.Driftwood);
    const rocks = COAST_NODE_SEEDS.filter((n) => n.kind === NodeKind.TideRock);
    expect(wood.map(({ x, z }) => ({ x, z }))).toEqual([{ x: 25, z: 3 }, { x: 46, z: 25 }, { x: 25, z: 46 }, { x: 3, z: 25 }]);
    expect(rocks.map(({ x, z }) => ({ x, z }))).toEqual([{ x: 12, z: 6 }, { x: 39, z: 9 }, { x: 9, z: 40 }, { x: 46, z: 46 }]);
    for (const n of COAST_NODE_SEEDS) expect(areaOf(n)).toBe('coast');
    // Driftwood lies straight past a crossing.
    for (const [i, c] of HEDGE_CROSSINGS.entries()) {
      const past = coastPastCrossing(c);
      if (past.x === SPAWN_TILE.x) expect(wood[i].x).toBe(past.x);
      else expect(wood[i].z).toBe(past.z);
    }
    // Spread over the coves; ids 101+ and unique.
    for (const a of COAST_NODE_SEEDS) for (const b of COAST_NODE_SEEDS) if (a !== b) expect(chebyshev(a, b)).toBeGreaterThanOrEqual(12);
    expect(new Set(NODE_SEEDS.map((n) => n.id)).size).toBe(NODE_SEEDS.length);
    expect(Math.min(...NODE_SEEDS.map((n) => n.id))).toBe(101);
  });

  it('per-kind harvest and regrow: berry 5/50, driftwood 4/25, tide rock 6/40', () => {
    expect([harvestTicksFor(0), regrowTicksFor(0)]).toEqual([5, 50]);
    expect([harvestTicksFor(NodeKind.Driftwood), regrowTicksFor(NodeKind.Driftwood)]).toEqual([4, 25]);
    expect([harvestTicksFor(NodeKind.TideRock), regrowTicksFor(NodeKind.TideRock)]).toEqual([6, 40]);
    expect(harvestTicksFor(undefined)).toBe(5);
  });

  it('seeding twice is a no-op', () => {
    const ids = new Set<number>(TREE_SEEDS.map((t) => t.id));
    const first = missingNodeSeeds((id) => ids.has(id));
    expect(first).toHaveLength(NODE_SEEDS.length);
    for (const s of first) ids.add(s.id);
    expect(missingNodeSeeds((id) => ids.has(id))).toHaveLength(0);
    ids.delete(106);
    expect(missingNodeSeeds((id) => ids.has(id)).map((s) => s.id)).toEqual([106]);
  });

  it('BFS: the Coast stays connected with every node; each node is reachable with a stick, none without', () => {
    const blocked = blockedSetFromTiles([...TREE_SEEDS, ...COAST_NODE_SEEDS]);

    const all = reachableTiles(SPAWN_TILE, blocked, enterRule(true));
    expect(all.size).toBeGreaterThan(1500);
    for (const n of COAST_NODE_SEEDS) expect([...all].some((k) => chebyshev(tileOf(k), n) === 1)).toBe(true);
    const grove = reachableTiles(SPAWN_TILE, blocked, enterRule(false));
    for (const n of COAST_NODE_SEEDS) expect([...grove].some((k) => chebyshev(tileOf(k), n) <= 1)).toBe(false);
  });
});

describe('the stone club recipe', () => {
  it('items: driftwood and flint stack to 99, the club is a one-stack 8-damage weapon', () => {
    expect(getItemDef('driftwood')?.maxStack).toBe(MAX_STACK);
    expect(getItemDef('flint')?.maxStack).toBe(MAX_STACK);
    expect(getItemDef('stone_club')).toMatchObject({ maxStack: 1, weaponDamage: 8 });
    expect(swingDamage('stone_club')).toBe(8);
  });

  it('needs 1 driftwood + 2 flint and reports what is missing', () => {
    expect(club.inputs).toEqual([{ itemId: 'driftwood', quantity: 1 }, { itemId: 'flint', quantity: 2 }]);
    expect(recipeMissing(bag(['flint', 1]), club)).toEqual([{ itemId: 'driftwood', quantity: 1 }, { itemId: 'flint', quantity: 1 }]);
    expect(craft(bag(['driftwood', 1], ['flint', 1]), club)).toBeNull();
    expect(recipeStatus(bag(['driftwood', 3], ['flint', 2]))[0]).toMatchObject({ id: 'stone_club', canCraft: true, missing: [] });
  });

  it('consumes exactly the inputs and puts the club in a free bag slot', () => {
    const r = craft(bag(['stick', 1], ['driftwood', 2], ['flint', 5]), club)!;
    expect(r.overflow).toBe(0);
    expect(r.slots.slice(0, HOTBAR_SIZE)).toEqual([{ itemId: 'stick', quantity: 1 }, { itemId: 'driftwood', quantity: 1 }, { itemId: 'flint', quantity: 3 }]);
    expect(r.slots[HOTBAR_SIZE]).toEqual({ itemId: 'stone_club', quantity: 1 });
    expect(r.slots.filter((s) => s?.itemId === 'stone_club')).toHaveLength(1);
    const exact = craft(bag(['stick', 1], ['driftwood', 1], ['flint', 2]), club)!;
    expect(exact.slots[1]).toBeNull();
    expect(exact.slots[HOTBAR_SIZE]).toEqual({ itemId: 'stone_club', quantity: 1 });
  });

  it('overflows when the bag stays full', () => {
    const full = emptySlots().map((_, i) => ({ itemId: i === 0 ? 'driftwood' : i === 1 ? 'flint' : 'berry_blueberry', quantity: 5 }));
    const r = craft(full, club)!;
    expect(r.overflow).toBe(1);
    expect(r.slots[0]).toEqual({ itemId: 'driftwood', quantity: 4 });
    expect(r.slots[1]).toEqual({ itemId: 'flint', quantity: 3 });
  });
});
