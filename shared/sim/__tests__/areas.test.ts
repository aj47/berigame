import { describe, expect, it } from 'vitest';
import {
  areaOf, brambleTiles, canEnter, enterRule, HEDGE_CROSSINGS, holdsItem, inGrace, inSafeRing, isBramble, isNewcomer, isSafe, ringOf,
} from '../areas';
import { FIRST_SPAWN_GRACE_TICKS, GRID_SIZE, HEDGE_RING, RESPAWN_GRACE_TICKS, SAFE_RADIUS, SPAWN_TILE, STICK_DROP_CHANCE } from '../constants';
import { blockedSetFromTiles, neighbors8, tileKey } from '../grid';
import { harvestFindsStick, TREE_SEEDS } from '../items';
import { bfsPath, goalIsTile, nearestReachableTile, reachableTiles } from '../pathfinding';
import { PlayerState, type Tile } from '../types';

const trees = blockedSetFromTiles(TREE_SEEDS);
const stick = enterRule(true);
const noStick = enterRule(false);
/** M2's driftwood piles and tide rocks, as single blocked tiles. */
const M2_NODES: Tile[] = [
  { x: 25, z: 3 }, { x: 46, z: 25 }, { x: 25, z: 46 }, { x: 3, z: 25 },
  { x: 3, z: 3 }, { x: 46, z: 3 }, { x: 3, z: 46 }, { x: 46, z: 46 },
];

function neighboursAllowed(from: Tile, rule = noStick): Tile[] {
  return neighbors8(from).filter((to) => bfsPath(from, goalIsTile(to), trees, rule)?.length === 1);
}

describe('Grove geometry', () => {
  it('has a one-tile hedge of 136 bramble tiles at ring 17', () => {
    expect(HEDGE_RING).toBe(17);
    const hedge = brambleTiles();
    expect(hedge).toHaveLength(136);
    expect(hedge.every((t) => ringOf(t) === HEDGE_RING)).toBe(true);
    let count = 0;
    for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) if (isBramble({ x, z })) count++;
    expect(count).toBe(136);
  });

  it('keeps every tree and its 8 neighbours inside the Grove, with spawn inside', () => {
    for (const tree of TREE_SEEDS) {
      expect(ringOf(tree)).toBeLessThanOrEqual(15);
      for (const n of neighbors8(tree)) expect(ringOf(n)).toBeLessThanOrEqual(HEDGE_RING - 1);
    }
    expect(areaOf(SPAWN_TILE)).toBe('grove');
    expect(areaOf({ x: 8, z: 25 })).toBe('hedge');
    expect(areaOf({ x: 7, z: 25 })).toBe('coast');
  });

  it('puts the four path crossings on the hedge', () => {
    expect(HEDGE_CROSSINGS).toEqual([{ x: 25, z: 8 }, { x: 42, z: 25 }, { x: 25, z: 42 }, { x: 8, z: 25 }]);
    expect(HEDGE_CROSSINGS.every(isBramble)).toBe(true);
  });

  it('safe ring is radius 2 (25 tiles); gold and blue trees stay outside', () => {
    expect(SAFE_RADIUS).toBe(2);
    let n = 0;
    for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) if (inSafeRing({ x, z })) n++;
    expect(n).toBe(25);
    expect(inSafeRing({ x: 30, z: 25 })).toBe(false);
    expect(inSafeRing({ x: 20, z: 30 })).toBe(false);
  });
});

describe('one-way brambles: reachability', () => {
  it('without a stick, spawn reaches exactly the 1083 walkable Grove tiles', () => {
    const seen = reachableTiles(SPAWN_TILE, trees, noStick);
    expect(seen.size).toBe(1083);
    for (const k of seen) expect(areaOf({ x: k % GRID_SIZE, z: Math.floor(k / GRID_SIZE) })).toBe('grove');
  });

  it('with a stick, spawn reaches all 2494 walkable tiles', () => {
    expect(reachableTiles(SPAWN_TILE, trees, stick).size).toBe(2494);
  });

  it('the Coast alone is connected: 1275 tiles, 1267 with the 8 M2 nodes', () => {
    const coast = (t: Tile) => ringOf(t) > HEDGE_RING;
    expect(reachableTiles({ x: 0, z: 0 }, trees, noStick, coast).size).toBe(1275);
    const withNodes = new Set([...trees, ...M2_NODES.map(tileKey)]);
    expect(reachableTiles({ x: 0, z: 0 }, withNodes, noStick, coast).size).toBe(1267);
  });

  it('without a stick, the Coast reaches everything: the way home is one-way', () => {
    expect(reachableTiles({ x: 0, z: 0 }, trees, noStick).size).toBe(2494);
  });

  it('canEnter: brambles only with a stick or from the Coast; stepping off is free', () => {
    expect(canEnter({ x: 9, z: 25 }, { x: 8, z: 25 }, false)).toBe(false);
    expect(canEnter({ x: 9, z: 25 }, { x: 8, z: 25 }, true)).toBe(true);
    expect(canEnter({ x: 7, z: 25 }, { x: 8, z: 25 }, false)).toBe(true);
    expect(canEnter({ x: 8, z: 25 }, { x: 9, z: 25 }, false)).toBe(true);
  });
});

describe('walking through the hedge', () => {
  it('a stick holder walks (25,25) to (2,25) crossing at (8,25): 23 steps, 12 ticks', () => {
    const path = bfsPath(SPAWN_TILE, goalIsTile({ x: 2, z: 25 }), trees, stick)!;
    expect(path).toHaveLength(23);
    expect(Math.ceil(path.length / 2)).toBe(12);
    expect(path.filter(isBramble)).toEqual([{ x: 8, z: 25 }]);
  });

  it('without a stick the target clamps to ring 16 and the path stops there', () => {
    const dest = nearestReachableTile(SPAWN_TILE, { x: 2, z: 25 }, trees, noStick);
    expect(dest).toEqual({ x: 9, z: 25 });
    expect(ringOf(dest)).toBe(16);
    expect(bfsPath(SPAWN_TILE, goalIsTile({ x: 2, z: 25 }), trees, noStick)).toBeNull();
  });

  it('stickless on a hedge tile: straight across to ring 16 or 18, never along or diagonally', () => {
    const allowed = neighboursAllowed({ x: 8, z: 25 });
    expect(allowed).toEqual(expect.arrayContaining([{ x: 9, z: 25 }, { x: 7, z: 25 }]));
    expect(allowed.some((t) => t.x === 7 && t.z !== 25)).toBe(false);
    expect(allowed.some((t) => t.x === 9 && t.z !== 25)).toBe(false);
    expect(allowed.some(isBramble)).toBe(false);
    expect(allowed).toHaveLength(2);
  });

  it('stickless on a hedge corner: only outward', () => {
    const allowed = neighboursAllowed({ x: 8, z: 8 });
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.every((t) => ringOf(t) === HEDGE_RING + 1)).toBe(true);
  });

  it('a stickless player on the Coast walks home', () => {
    const path = bfsPath({ x: 2, z: 25 }, goalIsTile(SPAWN_TILE), trees, noStick);
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual(SPAWN_TILE);
  });
});

describe('stick finds and safety helpers', () => {
  it('harvestFindsStick: holders never find; otherwise roll < 0.25', () => {
    expect(STICK_DROP_CHANCE).toBe(0.25);
    expect(harvestFindsStick(0, true)).toBe(false);
    expect(harvestFindsStick(0.2499, false)).toBe(true);
    expect(harvestFindsStick(0.25, false)).toBe(false);
    expect(harvestFindsStick(0.1)).toBe(true);
  });

  it('holdsItem counts the bag and the wielded weapon', () => {
    expect(holdsItem([null, { itemId: 'stick', quantity: 1 }], '', 'stick')).toBe(true);
    expect(holdsItem([null], 'stick', 'stick')).toBe(true);
    expect(holdsItem([{ itemId: 'berry_blueberry', quantity: 1 }], '', 'stick')).toBe(false);
  });

  it('grace: respawn grace lasts 10 ticks; first spawn uses respawnTick in the future', () => {
    const alive = PlayerState.Alive;
    expect(inGrace({ state: alive, respawnTick: 100 }, 100 + RESPAWN_GRACE_TICKS - 1)).toBe(true);
    expect(inGrace({ state: alive, respawnTick: 100 }, 100 + RESPAWN_GRACE_TICKS)).toBe(false);
    const first = { state: alive, respawnTick: 50 + FIRST_SPAWN_GRACE_TICKS - RESPAWN_GRACE_TICKS };
    expect(inGrace(first, 50 + FIRST_SPAWN_GRACE_TICKS - 1)).toBe(true);
    expect(inGrace(first, 50 + FIRST_SPAWN_GRACE_TICKS)).toBe(false);
    expect(isNewcomer(first, 60)).toBe(true);
    expect(isNewcomer({ state: alive, respawnTick: 0 }, 60)).toBe(false);
    expect(isSafe({ state: alive, respawnTick: 0, x: 26, z: 26 }, 60)).toBe(true);
    expect(isSafe({ state: alive, respawnTick: 0, x: 30, z: 26 }, 60)).toBe(false);
  });
});
