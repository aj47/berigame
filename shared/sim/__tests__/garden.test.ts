import { adventureTables } from './adventureHarness';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState } from '../types';
import { emptySlots } from '../inventory';
import { MAX_STACK } from '../constants';
import {
  GARDEN_BAG_FULL, GARDEN_BASE_PLOTS, GARDEN_CROPS, GARDEN_MAX_PLOTS, GARDEN_PLOT_TILES, GARDEN_TOO_FAR, GardenStage,
  countRipe, formatGardenTime, gardenPlotCount, gardenProgress, gardenRemainingMs, gardenStage, getGardenCrop, isGardenRipe,
} from '../garden';
import { TREE_SEEDS } from '../items';
import { chebyshev } from '../grid';
import { areaOf, inSafeRing, isBramble } from '../areas';
import { xpForLevel } from '../skills';

vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({
  t: new Proxy({}, { get: () => () => ({}) }),
  SenderError: class SenderError extends Error {},
}));
vi.mock('../../../spacetimedb/src/schema', () => ({
  default: { reducer: (...args: unknown[]) => args[args.length - 1] },
}));
vi.mock('../../../spacetimedb/src/tables', () => ({ tickSchedule: { rowType: {} } }));
import * as garden from '../../../spacetimedb/src/reducers/garden';

type Reducer = (ctx: any, args?: any) => void;
const plant = garden.plantGarden as unknown as Reducer;
const harvest = garden.harvestGarden as unknown as Reducer;
const devRipen = garden.gardenDevRipen as unknown as Reducer;

const HOUR = 3_600_000;
const green = getGardenCrop('berry_greenberry')!;

describe('garden growth math', () => {
  const p = { itemId: 'berry_greenberry', plantedAtMs: 1_000_000 };
  it('uses the shipped grow times', () => {
    expect(GARDEN_CROPS.map((c) => [c.itemId, c.growMs / HOUR, c.yield])).toEqual([
      ['berry_greenberry', 2, 3], ['berry_strawberry', 4, 3], ['berry_blueberry', 6, 3], ['berry_goldberry', 8, 2],
    ]);
  });
  it('stages seed, sprout, bush, ripe', () => {
    const at = (f: number) => gardenStage(p, p.plantedAtMs + f * green.growMs);
    expect(at(0)).toBe(GardenStage.Seed);
    expect(at(0.19)).toBe(GardenStage.Seed);
    expect(at(0.2)).toBe(GardenStage.Sprout);
    expect(at(0.59)).toBe(GardenStage.Sprout);
    expect(at(0.6)).toBe(GardenStage.Bush);
    expect(at(0.999)).toBe(GardenStage.Bush);
    expect(at(1)).toBe(GardenStage.Ripe);
    // Ripe plants wait forever: a year later it is still ripe, never withered.
    expect(gardenStage(p, p.plantedAtMs + 365 * 24 * HOUR)).toBe(GardenStage.Ripe);
  });
  it('remaining time, progress and clamping', () => {
    expect(gardenRemainingMs(p, p.plantedAtMs)).toBe(2 * HOUR);
    expect(gardenRemainingMs(p, p.plantedAtMs + 3 * HOUR)).toBe(0);
    expect(gardenProgress(p, p.plantedAtMs - 5000)).toBe(0);
    expect(gardenProgress(p, p.plantedAtMs + HOUR)).toBeCloseTo(0.5);
    expect(isGardenRipe(p, p.plantedAtMs + 2 * HOUR - 1)).toBe(false);
    expect(isGardenRipe({ itemId: 'stick', plantedAtMs: 0 }, 1e15)).toBe(false);
    expect(countRipe([p, { ...p, plantedAtMs: 1e13 }], p.plantedAtMs + 2 * HOUR)).toBe(1);
  });
  it('formats time left', () => {
    expect(formatGardenTime(0)).toBe('Ripe');
    expect(formatGardenTime(4_200)).toBe('5s');
    expect(formatGardenTime(12 * 60_000)).toBe('12m');
    expect(formatGardenTime(80 * 60_000)).toBe('1h 20m');
    expect(formatGardenTime(2 * HOUR)).toBe('2h');
  });
  it('4th plot opens at Foraging 5 only', () => {
    expect(gardenPlotCount(1)).toBe(GARDEN_BASE_PLOTS);
    expect(gardenPlotCount(4)).toBe(3);
    expect(gardenPlotCount(5)).toBe(GARDEN_MAX_PLOTS);
  });
  it('the terrace is in the Grove, off the safe ring, the hedge and every tree harvest tile', () => {
    for (const t of GARDEN_PLOT_TILES) {
      expect(areaOf(t)).toBe('grove');
      expect(inSafeRing(t)).toBe(false);
      expect(isBramble(t)).toBe(false);
      for (const tree of TREE_SEEDS) expect(chebyshev(t, tree)).toBeGreaterThan(1);
      // Off the four worn paths (x = 25 or z = 25).
      expect(t.x === 25 || t.z === 25).toBe(false);
    }
  });
});

const identity = (value: string) => ({ toHexString: () => value });
const A = identity('a');

function harness() {
  const players = new Map<string, any>([['a', {
    identity: A, online: true, state: PlayerState.Alive, x: 22, z: 21, lastInputTick: 0, inputsThisTick: 0,
  }]]);
  const inventory = new Map<bigint, any>([[1n, { id: 1n, owner: A, slot: 0, itemId: 'berry_greenberry', quantity: 2 }]]);
  let nextInv = 100n;
  const plots = new Map<bigint, any>();
  let nextPlot = 1n;
  const skills = new Map<string, any>();
  const owner = { value: A };
  const ctx: any = {
    sender: A, timestamp: { microsSinceUnixEpoch: 1_000_000_000_000n },
    db: {
      ...adventureTables(),
      accessPolicy: { id: { find: () => ({ id: 0, owner: owner.value, gateway: identity('g'), requireAdmission: false }) } },
      playerGrant: { identity: { find: () => undefined } },
      world: { id: { find: () => ({ id: 0, tick: 10 }) } },
      player: { identity: { find: (id: any) => players.get(id.toHexString()), update: (p: any) => players.set(p.identity.toHexString(), p) } },
      inventorySlot: {
        owner: { filter: (o: any) => [...inventory.values()].filter((r) => r.owner.toHexString() === o.toHexString()) },
        insert: (row: any) => { const id = nextInv++; inventory.set(id, { ...row, id }); },
        id: { update: (row: any) => inventory.set(row.id, row), delete: (id: bigint) => inventory.delete(id) },
      },
      gardenPlot: {
        owner: { filter: (o: any) => [...plots.values()].filter((r) => r.owner.toHexString() === o.toHexString()) },
        insert: (row: any) => { const id = nextPlot++; plots.set(id, { ...row, id }); },
        id: { update: (row: any) => plots.set(row.id, row), delete: (id: bigint) => plots.delete(id) },
      },
      playerSkill: { insert: (r: any) => skills.set(r.identity.toHexString(), r), identity: { find: (id: any) => skills.get(id.toHexString()), update: (r: any) => skills.set(r.identity.toHexString(), r) } },
      playerCosmetic: { insert: () => {}, identity: { find: () => undefined, update: () => {} } },
    },
  };
  const advance = (ms: number) => { ctx.timestamp = { microsSinceUnixEpoch: ctx.timestamp.microsSinceUnixEpoch + BigInt(ms) * 1000n }; };
  const count = (itemId: string) => [...inventory.values()].filter((r) => r.itemId === itemId).reduce((n, r) => n + r.quantity, 0);
  return { ctx, players, inventory, plots, skills, owner, advance, count, me: () => players.get('a') };
}

let h: ReturnType<typeof harness>;
beforeEach(() => { h = harness(); });

describe('plant_garden / harvest_garden reducers', () => {
  it('plants one berry, grows offline, harvests 3 with Foraging XP', () => {
    plant(h.ctx, { plot: 0, itemId: 'berry_greenberry' });
    expect(h.count('berry_greenberry')).toBe(1);
    expect([...h.plots.values()]).toMatchObject([{ plot: 0, itemId: 'berry_greenberry', plantedAtMicros: 1_000_000_000_000n }]);
    expect(() => harvest(h.ctx, { plot: 0 })).toThrow('Not ripe yet: 2h to go');
    h.advance(green.growMs - 60_000);
    expect(() => harvest(h.ctx, { plot: 0 })).toThrow('Not ripe yet: 1m to go');
    h.advance(10 * HOUR); // long after ripe: still waiting, never withered
    harvest(h.ctx, { plot: 0 });
    expect(h.count('berry_greenberry')).toBe(4);
    expect(h.plots.size).toBe(0);
    expect(h.skills.get('a')).toMatchObject({ foragingXp: green.xp });
  });

  it('validates reach, plot, item, occupancy and the berry in the bag', () => {
    expect(() => plant(h.ctx, { plot: 7, itemId: 'berry_greenberry' })).toThrow('no such plot');
    expect(() => plant(h.ctx, { plot: 3, itemId: 'berry_greenberry' })).toThrow('Foraging level 5');
    expect(() => plant(h.ctx, { plot: 0, itemId: 'stick' })).toThrow('Only berries grow here');
    expect(() => plant(h.ctx, { plot: 0, itemId: 'berry_goldberry' })).toThrow('You need a berry');
    Object.assign(h.me(), { x: 25, z: 25 });
    expect(() => plant(h.ctx, { plot: 0, itemId: 'berry_greenberry' })).toThrow(GARDEN_TOO_FAR);
    Object.assign(h.me(), { x: 22, z: 21 });
    plant(h.ctx, { plot: 0, itemId: 'berry_greenberry' });
    expect(() => plant(h.ctx, { plot: 0, itemId: 'berry_greenberry' })).toThrow('already growing');
    expect(() => harvest(h.ctx, { plot: 1 })).toThrow('Nothing is growing there');
    h.me().state = PlayerState.Dead;
    expect(() => harvest(h.ctx, { plot: 0 })).toThrow('you are dead');
    expect(h.count('berry_greenberry')).toBe(1);
  });

  it('opens the 4th plot at Foraging 5', () => {
    h.skills.set('a', { identity: A, foragingXp: xpForLevel(5), beachcombingXp: 0, craftingXp: 0 });
    plant(h.ctx, { plot: 3, itemId: 'berry_greenberry' });
    expect(h.plots.size).toBe(1);
  });

  it('harvesting another player\'s plot is impossible: plots are keyed by owner', () => {
    h.plots.set(99n, { id: 99n, owner: identity('b'), plot: 0, itemId: 'berry_greenberry', plantedAtMicros: 0n });
    expect(() => harvest(h.ctx, { plot: 0 })).toThrow('Nothing is growing there');
    expect(h.plots.has(99n)).toBe(true);
  });

  it('a full bag keeps the ripe plant and says so', () => {
    plant(h.ctx, { plot: 0, itemId: 'berry_greenberry' });
    for (let s = 0; s < 28; s++) h.inventory.set(BigInt(500 + s), { id: BigInt(500 + s), owner: A, slot: s, itemId: 'flint', quantity: MAX_STACK });
    for (const [id, r] of h.inventory) if (r.itemId === 'berry_greenberry') h.inventory.delete(id);
    h.advance(green.growMs);
    expect(() => harvest(h.ctx, { plot: 0 })).toThrow(GARDEN_BAG_FULL);
    expect(h.plots.size).toBe(1);
  });

  it('dev ripen is owner-only and only moves the clock of existing plants', () => {
    plant(h.ctx, { plot: 0, itemId: 'berry_greenberry' });
    h.owner.value = identity('z');
    expect(() => devRipen(h.ctx, { target: A, aheadMs: 0 })).toThrow('world owner required');
    h.owner.value = A;
    devRipen(h.ctx, { target: A, aheadMs: 0 });
    harvest(h.ctx, { plot: 0 });
    expect(h.count('berry_greenberry')).toBe(4);
  });
});
