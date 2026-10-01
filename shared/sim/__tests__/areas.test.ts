import { canFindStick } from '../adventure';
import { describe, expect, it } from 'vitest';
import {
  areaOf, brambleTiles, canEnter, enterRule, HEDGE_CROSSINGS, holdsItem, inGrace, inSafeRing, isBramble, isNewcomer, isSafe, ringOf,
} from '../areas';
import { FIRST_SPAWN_GRACE_TICKS, GRID_SIZE, HEDGE_RING, RESPAWN_GRACE_TICKS, SAFE_RADIUS, SPAWN_TILE, STICK_DROP_CHANCE } from '../constants';
import { blockedSetFromTiles, neighbors8, tileKey, isLandTile } from '../grid';
import { NODE_SEEDS } from '../nodes';
import { insideGrove } from '../terrain';
import { TREE_SEEDS } from '../items';
import { bfsPath, goalIsTile, nearestReachableTile, reachableTiles } from '../pathfinding';
import { PlayerState, type Tile } from '../types';

const trees = blockedSetFromTiles(TREE_SEEDS);
const stick = enterRule(true);
const noStick = enterRule(false);
/** M2's driftwood piles and tide rocks, as single blocked tiles. */
const M2_NODES = NODE_SEEDS;
const allTiles: Tile[] = Array.from({length:GRID_SIZE*GRID_SIZE},(_,i)=>({x:i%GRID_SIZE,z:Math.floor(i/GRID_SIZE)}));

function neighboursAllowed(from: Tile, rule = noStick): Tile[] {
  return neighbors8(from).filter((to) => bfsPath(from, goalIsTile(to), trees, rule)?.length === 1);
}

describe('Grove geometry', () => {
  it('follows a rounded boundary, with no straight square corners', () => {
    const hedge = brambleTiles();
    expect(hedge.length).toBeGreaterThan(80);
    expect(hedge.every(t=>isLandTile(t)&&insideGrove(t))).toBe(true);
    expect(hedge.some(t=>ringOf(t)<HEDGE_RING)).toBe(true);
    expect(isBramble({x:8,z:8})).toBe(false);
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
  it('without a stick, spawn reaches every walkable Grove tile and cannot escape', () => {
    const seen=reachableTiles(SPAWN_TILE,trees,noStick);
    const grove=allTiles.filter(t=>areaOf(t)==='grove'&&!trees.has(tileKey(t)));
    expect(seen.size).toBe(grove.length);
    for(const k of seen)expect(areaOf({x:k%GRID_SIZE,z:Math.floor(k/GRID_SIZE)})).toBe('grove');
  });

  it('with a stick, every dry tile up to the boulder line is reachable', () => {
    const land=allTiles.filter(t=>['grove','hedge','coast'].includes(areaOf(t))&&!trees.has(tileKey(t)));
    expect(reachableTiles(SPAWN_TILE,trees,stick).size).toBe(land.length);
  });

  it('every Coast resource has a stickless route home, including either side of the river mouth', () => {
    for(const node of M2_NODES.filter(t=>areaOf(t)==='coast')) {
      const start=neighbors8(node).find(t=>!trees.has(tileKey(t)))!;
      expect(bfsPath(start,goalIsTile(SPAWN_TILE),trees,noStick)).not.toBeNull();
    }
  });

  it('canEnter: brambles only with a stick or from the Coast; stepping off is free', () => {
    expect(canEnter({ x: 9, z: 25 }, { x: 8, z: 25 }, false)).toBe(false);
    expect(canEnter({ x: 9, z: 25 }, { x: 8, z: 25 }, true)).toBe(true);
    expect(canEnter({ x: 7, z: 25 }, { x: 8, z: 25 }, false)).toBe(true);
    expect(canEnter({ x: 8, z: 25 }, { x: 9, z: 25 }, false)).toBe(true);
  });
});

describe('walking through the hedge', () => {
  it('a stick holder crosses the brook and hedge on the route to the western beach', () => {
    const path = bfsPath(SPAWN_TILE, goalIsTile({ x: 2, z: 25 }), trees, stick)!;
    expect(path).toHaveLength(23);
    expect(Math.ceil(path.length / 2)).toBe(12);
    expect(path.some(isBramble)).toBe(true);
    expect(path.every(isLandTile)).toBe(true);
  });

  it('without a stick the target clamps to ring 16 and the path stops there', () => {
    const dest = nearestReachableTile(SPAWN_TILE, { x: 2, z: 25 }, trees, noStick);
    expect(areaOf(dest)).toBe('grove');
    expect(dest.x).toBe(9);
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

  it('rounded corners never let a stickless player enter brambles from the Grove', () => {
    for(const hedge of brambleTiles())for(const n of neighbors8(hedge))if(areaOf(n)==='grove')expect(canEnter(n,hedge,false)).toBe(false);
  });

  it('a stickless player on the Coast walks home', () => {
    const path = bfsPath({ x: 2, z: 25 }, goalIsTile(SPAWN_TILE), trees, noStick);
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual(SPAWN_TILE);
  });
});

describe('stick finds and safety helpers', () => {
  it('stick discovery unlocks at level 2, then spares use roll < 0.25', () => {
    expect(STICK_DROP_CHANCE).toBe(0.25);
    expect(canFindStick(1, true, 0)).toBe(false);
    expect(canFindStick(2, true, 0.2499)).toBe(true);
    expect(canFindStick(2, true, 0.25)).toBe(false);
    expect(canFindStick(2, false, 0.999)).toBe(true);
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
