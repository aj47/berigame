/**
 * The personal garden ("bring players back"): a small berry patch on the
 * garden terrace in the Grove. Every player tends the same few plot tiles,
 * but each player's plants are their own (the server only ever sends you your
 * own rows), so everyone sees their own garden there and bare soil otherwise.
 *
 * Growth is real time and computed lazily from the planting timestamp: no
 * per-tick writes, and it keeps growing while you are offline. Ripe plants
 * wait forever (they never wither). Numbers are modest on purpose (ROADMAP §8):
 * a full 4-plot goldberry cycle nets +4 goldberries per 8 hours.
 */
import type { Slot, Tile } from './types';
import { addItem, countItem } from './inventory';
import { chebyshev } from './grid';
import { levelForXp } from './skills';

export interface GardenCrop {
  itemId: string;
  /** Real time from planting to ripe. */
  growMs: number;
  /** Berries a ripe plant gives back (you planted one). */
  yield: number;
  /** Foraging XP for a harvest. */
  xp: number;
}

const HOUR_MS = 60 * 60 * 1000;

/** What can be planted. Order is the menu order. */
export const GARDEN_CROPS: readonly GardenCrop[] = [
  { itemId: 'berry_greenberry', growMs: 2 * HOUR_MS, yield: 3, xp: 12 },
  { itemId: 'berry_strawberry', growMs: 4 * HOUR_MS, yield: 3, xp: 16 },
  { itemId: 'berry_blueberry', growMs: 6 * HOUR_MS, yield: 3, xp: 20 },
  { itemId: 'berry_goldberry', growMs: 8 * HOUR_MS, yield: 2, xp: 24 },
];

export function getGardenCrop(itemId: string): GardenCrop | undefined {
  return GARDEN_CROPS.find((c) => c.itemId === itemId);
}

/**
 * The garden terrace: a 2x2 patch of soil north-west of the safe ring, off the
 * worn paths and clear of every tree's harvest tiles. Plots are walkable; you
 * tend a plot from any tile within GARDEN_REACH of it (standing on the patch
 * reaches all four).
 */
export const GARDEN_PLOT_TILES: readonly Tile[] = [
  { x: 21, z: 20 },
  { x: 22, z: 20 },
  { x: 21, z: 21 },
  { x: 22, z: 21 },
];
/** Where the "go to your garden" hints walk you: on the patch, reaching every plot. */
export const GARDEN_CENTER: Tile = { x: 22, z: 21 };
export const GARDEN_REACH = 1;
export const GARDEN_BASE_PLOTS = 3;
/** A convenience plot (never power): Foraging level that unlocks the 4th plot. */
export const GARDEN_EXTRA_PLOT_LEVEL = 5;
export const GARDEN_MAX_PLOTS = GARDEN_PLOT_TILES.length;

export const GARDEN_TOO_FAR = 'Walk to your garden first';
export const GARDEN_BAG_FULL = 'Your bag is full: make room, your berries will wait';

/** Plots you can use at this Foraging level. */
export function gardenPlotCount(foragingLevel: number): number {
  return foragingLevel >= GARDEN_EXTRA_PLOT_LEVEL ? GARDEN_MAX_PLOTS : GARDEN_BASE_PLOTS;
}
export function gardenPlotCountForXp(foragingXp: number): number {
  return gardenPlotCount(levelForXp(foragingXp));
}

export const GardenStage = { Seed: 0, Sprout: 1, Bush: 2, Ripe: 3 } as const;
export type GardenStage = (typeof GardenStage)[keyof typeof GardenStage];
export const GARDEN_STAGE_NAMES = ['seed', 'sprout', 'bush', 'ripe'] as const;

export interface GardenPlant {
  itemId: string;
  plantedAtMs: number;
}

/** When a plant ripens (ms since the epoch). Unknown crops never ripen. */
export function gardenRipeAtMs(plant: GardenPlant): number {
  const crop = getGardenCrop(plant.itemId);
  return crop ? plant.plantedAtMs + crop.growMs : Infinity;
}

export function gardenRemainingMs(plant: GardenPlant, nowMs: number): number {
  return Math.max(0, gardenRipeAtMs(plant) - nowMs);
}

export function isGardenRipe(plant: GardenPlant, nowMs: number): boolean {
  return nowMs >= gardenRipeAtMs(plant);
}

/** Growth 0..1 (1 = ripe). A clock that runs behind the planting time reads 0. */
export function gardenProgress(plant: GardenPlant, nowMs: number): number {
  const crop = getGardenCrop(plant.itemId);
  if (!crop) return 0;
  return Math.min(1, Math.max(0, (nowMs - plant.plantedAtMs) / crop.growMs));
}

/** seed below 20%, sprout below 60%, bush until ripe. */
export function gardenStage(plant: GardenPlant, nowMs: number): GardenStage {
  if (isGardenRipe(plant, nowMs)) return GardenStage.Ripe;
  const f = gardenProgress(plant, nowMs);
  if (f < 0.2) return GardenStage.Seed;
  if (f < 0.6) return GardenStage.Sprout;
  return GardenStage.Bush;
}

/** "1h 20m", "12m", "45s", "Ripe". */
export function formatGardenTime(ms: number): string {
  if (ms <= 0) return 'Ripe';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function inGardenReach(at: Tile, plot: number): boolean {
  const tile = GARDEN_PLOT_TILES[plot];
  return !!tile && chebyshev(at, tile) <= GARDEN_REACH;
}

/** The plot index on `tile`, or -1. */
export function gardenPlotAt(tile: Tile): number {
  return GARDEN_PLOT_TILES.findIndex((t) => t.x === tile.x && t.z === tile.z);
}

/** Why planting `itemId` in `plot` is refused, or null. `occupied`: the plot already has a plant. */
export function gardenPlantRejection(
  slots: readonly Slot[], at: Tile, plot: number, itemId: string, foragingLevel: number, occupied: boolean,
): string | null {
  if (!Number.isInteger(plot) || plot < 0 || plot >= GARDEN_MAX_PLOTS) return 'no such plot';
  if (plot >= gardenPlotCount(foragingLevel)) return `This plot opens at Foraging level ${GARDEN_EXTRA_PLOT_LEVEL}`;
  const crop = getGardenCrop(itemId);
  if (!crop) return 'Only berries grow here';
  if (!inGardenReach(at, plot)) return GARDEN_TOO_FAR;
  if (occupied) return 'Something is already growing there';
  if (countItem(slots, itemId) < 1) return 'You need a berry of that kind to plant';
  return null;
}

/** Why harvesting is refused, or null. */
export function gardenHarvestRejection(
  slots: readonly Slot[], at: Tile, plot: number, plant: GardenPlant | null, nowMs: number,
): string | null {
  if (!Number.isInteger(plot) || plot < 0 || plot >= GARDEN_MAX_PLOTS) return 'no such plot';
  if (!plant) return 'Nothing is growing there';
  if (!inGardenReach(at, plot)) return GARDEN_TOO_FAR;
  if (!isGardenRipe(plant, nowMs)) return `Not ripe yet: ${formatGardenTime(gardenRemainingMs(plant, nowMs))} to go`;
  const crop = getGardenCrop(plant.itemId)!;
  if (addItem(slots, plant.itemId, crop.yield).remaining > 0) return GARDEN_BAG_FULL;
  return null;
}

/** How many of these plants are ripe. */
export function countRipe(plants: Iterable<GardenPlant>, nowMs: number): number {
  let n = 0;
  for (const p of plants) if (isGardenRipe(p, nowMs)) n++;
  return n;
}
