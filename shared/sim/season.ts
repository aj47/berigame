/**
 * The Long Season: content for a busy world played every day for a month.
 *
 * - Ten tiered gathering nodes (five Foraging plants inland, five Beachcombing
 *   finds on the shore), each needing a skill level to work and paying more XP
 *   per second of harvest the higher it sits. Tiers sit further from spawn, so
 *   a crowd spreads across the outer lands as it levels.
 * - Their materials and the goods made from them (recipes in nodes.ts).
 * - The level curve past 30 lives in skills.ts; the daily ledger in ledger.ts.
 *
 * Pure data and one deterministic placement pass shared by the server and the
 * client. Never reorder or reuse a kind, item or id published here.
 */
import { GRID_SIZE, SPAWN_TILE } from './constants';
import { BIOMES, biomeOf, type BiomeId } from './expanse';
import { GLADE_CLEARING, LANDMARKS, SCENERY_BLOCKERS, terrainField, trailDistance } from './terrain';
import { areaOf, bossNoPvpZone } from './areas';
import { inBossRect } from './bossZones';
import type { Tile } from './types';

/** Skill ids as in skills.ts (a literal here avoids an import cycle). */
const FORAGING = 0, BEACHCOMBING = 1;

export interface TierNodeDef {
  /** `tree.kind` on the wire; continues NodeKind (0..3). */
  kind: number;
  key: string;
  name: string;
  /** The material it yields. */
  itemId: string;
  /** shared/sim/skills Skill id it trains and is gated by. */
  skill: number;
  /** Level in that skill needed to work it. */
  minLevel: number;
  harvestTicks: number;
  regrowTicks: number;
  /** XP per finished harvest (before the energy payout). */
  xp: number;
  /** 1..5: placement band, rendering scale and wiki order. */
  tier: number;
  /** Shown on the node and in the gathering menu. */
  verb: string;
  regrowLabel: string;
  /** Minimap and harvest ring colour. */
  color: string;
  /** How many the world holds. */
  count: number;
}

/**
 * Pace: XP per second of harvest rises by tier (berries pay 2.7/s), and every
 * second of harvest still spends one energy point, so a higher tier is faster
 * levelling, never more gathering. Short regrows let one node keep one
 * gatherer busy, which is what lets hundreds gather at once.
 */
export const TIER_NODES: readonly TierNodeDef[] = [
  { kind: 4, key: 'honey_hive', name: 'Wild honey hive', itemId: 'honeycomb', skill: FORAGING, minLevel: 15, harvestTicks: 6, regrowTicks: 8, xp: 14, tier: 1, verb: 'Smoke', regrowLabel: 'Bees rebuilding in', color: '#E8B23A', count: 64 },
  { kind: 5, key: 'oyster_bed', name: 'Oyster bed', itemId: 'pearl', skill: BEACHCOMBING, minLevel: 15, harvestTicks: 6, regrowTicks: 8, xp: 14, tier: 1, verb: 'Pry', regrowLabel: 'Oysters settling in', color: '#E9E4D6', count: 64 },
  { kind: 6, key: 'glowcap_ring', name: 'Glowcap ring', itemId: 'glowcap', skill: FORAGING, minLevel: 30, harvestTicks: 7, regrowTicks: 9, xp: 21, tier: 2, verb: 'Pick', regrowLabel: 'Sprouting in', color: '#6FD0C0', count: 120 },
  { kind: 7, key: 'coral_shelf', name: 'Coral shelf', itemId: 'coral', skill: BEACHCOMBING, minLevel: 30, harvestTicks: 7, regrowTicks: 9, xp: 21, tier: 2, verb: 'Break', regrowLabel: 'Coral regrowing in', color: '#F06C6C', count: 120 },
  { kind: 8, key: 'sunpeach_tree', name: 'Sunpeach tree', itemId: 'sunpeach', skill: FORAGING, minLevel: 45, harvestTicks: 8, regrowTicks: 10, xp: 29, tier: 3, verb: 'Pick', regrowLabel: 'Ripening in', color: '#F49A5B', count: 110 },
  { kind: 9, key: 'amber_seam', name: 'Amber seam', itemId: 'amber', skill: BEACHCOMBING, minLevel: 45, harvestTicks: 8, regrowTicks: 10, xp: 29, tier: 3, verb: 'Chisel', regrowLabel: 'Resin hardening in', color: '#E59A2C', count: 110 },
  { kind: 10, key: 'starblossom', name: 'Starblossom', itemId: 'starpetal', skill: FORAGING, minLevel: 60, harvestTicks: 9, regrowTicks: 11, xp: 40, tier: 4, verb: 'Gather', regrowLabel: 'Reblooming in', color: '#F3E08E', count: 120 },
  { kind: 11, key: 'moonstone_vein', name: 'Moonstone vein', itemId: 'moonstone', skill: BEACHCOMBING, minLevel: 60, harvestTicks: 9, regrowTicks: 11, xp: 40, tier: 4, verb: 'Mine', regrowLabel: 'Glinting again in', color: '#AFC8F0', count: 120 },
  { kind: 12, key: 'dreamvine', name: 'Dreamvine', itemId: 'dreamplum', skill: FORAGING, minLevel: 80, harvestTicks: 10, regrowTicks: 12, xp: 54, tier: 5, verb: 'Pick', regrowLabel: 'Fruiting in', color: '#9A62D6', count: 100 },
  { kind: 13, key: 'fallen_star', name: 'Fallen star', itemId: 'star_iron', skill: BEACHCOMBING, minLevel: 80, harvestTicks: 10, regrowTicks: 12, xp: 54, tier: 5, verb: 'Hammer', regrowLabel: 'Cooling in', color: '#7F90B8', count: 100 },
];

export const FIRST_TIER_KIND = 4;
export const LAST_TIER_KIND = TIER_NODES[TIER_NODES.length - 1].kind;

export function tierNode(kind: number | undefined): TierNodeDef | undefined {
  return kind !== undefined && kind >= FIRST_TIER_KIND ? TIER_NODES[kind - FIRST_TIER_KIND] : undefined;
}

/** Season materials and goods. Healing stays below a blueberry and nothing is a weapon: levels never buy strength. */
export interface SeasonItemDef { id: string; name: string; description: string; color: string; healthRestore?: number }
export const SEASON_ITEMS: readonly SeasonItemDef[] = [
  // Raw materials, one per tier node.
  { id: 'honeycomb', name: 'Honeycomb', description: 'Smoked from wild hives on the Coast (Foraging 15). Melts into beeswax candles.', color: '#E8B23A' },
  { id: 'pearl', name: 'Pearl', description: 'Pried from oyster beds along the shore (Beachcombing 15). Strung into charms and strands.', color: '#F2EEE4' },
  { id: 'glowcap', name: 'Glowcap', description: 'A softly glowing mushroom from Hearthvale’s woods and the Glimmerfen marsh (Foraging 30). Fills lanterns.', color: '#7FD3C4' },
  { id: 'coral', name: 'Coral', description: 'Broken from coral shelves on Hearthvale’s bays and Glimmerfen’s shores (Beachcombing 30). Carved into totems.', color: '#F26B6B' },
  { id: 'sunpeach', name: 'Sunpeach', description: 'Sweet fruit from the groves of the Sunscorch Dunes (Foraging 45). A small snack, best bottled as preserves.', color: '#F49A5B', healthRestore: 4 },
  { id: 'amber', name: 'Amber', description: 'Old resin chiselled from the red bluffs of the Sunscorch Dunes (Beachcombing 45). Set into inlays and amulets.', color: '#E59A2C' },
  { id: 'starpetal', name: 'Starpetal', description: 'A petal that keeps its glow after dark, from the snowfields of Frostpine Heights (Foraging 60). Burned as incense.', color: '#F6E7A1' },
  { id: 'moonstone', name: 'Moonstone', description: 'A pale stone from veins along Frostpine’s icy shores (Beachcombing 60). Ground into lenses.', color: '#BFD4F2' },
  { id: 'dreamplum', name: 'Dreamplum', description: 'The rarest fruit in the world, from vines on Starfall Reach (Foraging 80). Brewed into dream tonic.', color: '#8E5BD0', healthRestore: 4 },
  { id: 'star_iron', name: 'Star Iron', description: 'Metal from the fallen stars of Starfall Reach (Beachcombing 80). Smelted into ingots.', color: '#5E6E8F' },
  // Crafted goods: each feeds the next tier, the ledger and the season keepsakes.
  { id: 'beeswax_candle', name: 'Beeswax Candle', description: 'Two honeycombs and a driftwood wick. Lights glowcap lanterns; the ledger asks for them.', color: '#F1D27A' },
  { id: 'pearl_charm', name: 'Pearl Charm', description: 'Two pearls knotted onto flint. Set into coral totems; the ledger asks for them.', color: '#E7E1F0' },
  { id: 'glow_lantern', name: 'Glowcap Lantern', description: 'A candle and two glowcaps in a driftwood frame.', color: '#8EE0D2' },
  { id: 'coral_totem', name: 'Coral Totem', description: 'Three coral pieces around a pearl charm.', color: '#E8746E' },
  { id: 'sunpeach_preserves', name: 'Sunpeach Preserves', description: 'Sunpeaches sealed with honey. A ledger favourite.', color: '#F0A060' },
  { id: 'amber_inlay', name: 'Amber Inlay', description: 'Amber set into a coral totem.', color: '#E9A640' },
  { id: 'starpetal_incense', name: 'Starpetal Incense', description: 'Starpetals and a lantern’s glow, pressed into sticks.', color: '#F8EBB5' },
  { id: 'moonstone_lens', name: 'Moonstone Lens', description: 'Moonstone ground around an amber inlay.', color: '#C9DBF5' },
  { id: 'dream_tonic', name: 'Dream Tonic', description: 'Dreamplums steeped with starpetal incense.', color: '#A47BE0' },
  { id: 'star_iron_ingot', name: 'Star Iron Ingot', description: 'Star iron smelted through a moonstone lens.', color: '#7A8AAE' },
  // The ledger's token: earned only by finishing daily commissions.
  { id: 'ledger_seal', name: 'Ledger Seal', description: 'Pressed by a ledger clerk for each finished daily commission. Spent on the season’s finest keepsakes.', color: '#C0392B' },
];

// ---- Placement -------------------------------------------------------------

/**
 * Where each tier grows (expanse.ts biomes): the island's Coast and outer
 * lands, then Hearthvale and Glimmerfen, the Dunes, Frostpine and Starfall.
 * Walk time rises with tier too: the nearest tier-5 node is a long road out.
 */
export const TIER_BIOMES: readonly (readonly BiomeId[])[] = [['isle'], ['hearthvale', 'glimmerfen'], ['dunes'], ['frostpine'], ['starfall']];
/** Tier 1 stays out of the Grove's first ring: the hedge is 17 tiles out. */
const TIER_ONE_MIN_DISTANCE = 17;
export function tierBiomeNames(tier: number): string[] {
  return (TIER_BIOMES[tier - 1] ?? []).map((b) => BIOMES[b].name);
}
/** Shore tiles (terrain field below this) take Beachcombing nodes; inland tiles take Foraging. */
const SHORE_FIELD = 3;
/** Chebyshev gap between tier nodes: a one-tile lane always runs between two of them. */
const NODE_GAP = 2;
/** The hand-placed trees and nodes keep a wider berth, so their familiar spots stay open. */
const EXISTING_GAP = 3;
const SCENERY_GAP = 2;
/** Drop boxes and other service spots keep every node more than this far away. */
const KEEP_CLEAR_GAP = 3;

/** First tier node id; each kind gets a block of TIER_ID_BLOCK stable ids. */
export const TIER_ID_BLOCK = 1000;
export const FIRST_TIER_NODE_ID = 1000;
export function tierNodeId(kind: number, index: number): number {
  return FIRST_TIER_NODE_ID + (kind - FIRST_TIER_KIND) * TIER_ID_BLOCK + index;
}

export interface TierSeed extends Tile { id: number; kind: number; itemId: string }

function hash(x: number, z: number, salt: number): number {
  let h = (x * 374761393 + z * 668265263 + salt * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Deterministic placement: walk the Coast tiles of each tier's band in a fixed
 * hashed order and keep those clear of trails, landmarks, boss zones and every
 * other blocker. Kinds of a tier take turns so neither crowds the other out.
 * `existing` are the published trees and nodes (they keep their tiles);
 * `keepClear` are service spots (drop boxes) no node may crowd.
 */
export function placeTierNodes(existing: readonly Tile[], keepClear: readonly Tile[] = []): TierSeed[] {
  // Forbidden-tile mask: each blocker marks the square around it that no new node may use.
  const forbid = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const mark = (t: Tile, r: number) => {
    for (let z = Math.max(0, t.z - r); z <= Math.min(GRID_SIZE - 1, t.z + r); z++)
      for (let x = Math.max(0, t.x - r); x <= Math.min(GRID_SIZE - 1, t.x + r); x++) forbid[z * GRID_SIZE + x] = 1;
  };
  for (const o of existing) mark(o, EXISTING_GAP - 1);
  for (const o of SCENERY_BLOCKERS) mark(o, SCENERY_GAP - 1);
  for (const o of keepClear) mark(o, KEEP_CLEAR_GAP);
  for (const l of LANDMARKS) mark(l, 3);
  // Per-tile facts, computed once: biome, open Coast ground off the roads, and shore or inland.
  const biomeAt: BiomeId[] = new Array(GRID_SIZE * GRID_SIZE);
  const open = new Uint8Array(GRID_SIZE * GRID_SIZE), shoreAt = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) {
    const t = { x, z }, k = z * GRID_SIZE + x;
    if (forbid[k] || areaOf(t) !== 'coast' || bossNoPvpZone(t) || inBossRect(t, GLADE_CLEARING) || trailDistance(x, z) < 2) continue;
    open[k] = 1;
    biomeAt[k] = biomeOf(t);
    shoreAt[k] = terrainField(x, z) < SHORE_FIELD ? 1 : 0;
  }
  const out: TierSeed[] = [];
  for (let tier = 1; tier <= TIER_BIOMES.length; tier++) {
    const biomes = TIER_BIOMES[tier - 1];
    const kinds = TIER_NODES.filter((d) => d.tier === tier);
    const pools = kinds.map((def) => {
      const pool: Tile[] = [], spare: Tile[] = [];
      for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) {
        const k = z * GRID_SIZE + x;
        if (!open[k] || !biomes.includes(biomeAt[k])) continue;
        if (tier === 1 && Math.hypot(x - SPAWN_TILE.x, z - SPAWN_TILE.z) < TIER_ONE_MIN_DISTANCE) continue;
        ((shoreAt[k] === 1) === (def.skill === BEACHCOMBING) ? pool : spare).push({ x, z });
      }
      // Its own ground (shore or inland) first; the other kind's ground only once that runs out.
      const order = (a: Tile, b: Tile) => hash(a.x, a.z, def.kind) - hash(b.x, b.z, def.kind) || a.z - b.z || a.x - b.x;
      return [...pool.sort(order), ...spare.sort(order)];
    });
    const cursor = kinds.map(() => 0), placed = kinds.map(() => 0);
    let progress = true;
    while (progress) {
      progress = false;
      kinds.forEach((def, k) => {
        if (placed[k] >= def.count) return;
        const pool = pools[k];
        while (cursor[k] < pool.length) {
          const t = pool[cursor[k]++];
          if (forbid[t.z * GRID_SIZE + t.x]) continue;
          mark(t, NODE_GAP - 1);
          out.push({ id: tierNodeId(def.kind, placed[k]), x: t.x, z: t.z, kind: def.kind, itemId: def.itemId });
          placed[k]++;
          progress = true;
          break;
        }
      });
    }
  }
  return out.sort((a, b) => a.id - b.id);
}
