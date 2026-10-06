import { describe, expect, it } from 'vitest';
import { areaOf, bossNoPvpZone, enterRule, inBoulders } from '../areas';
import {
  CLATTER_GLADE, CLATTER_HOME, CLATTER_STONES, SPIRE_CENTRE, SPIRE_DAIS, SPIRE_EXIT, SPIRE_FLOOR, SPIRE_GATE,
  inBossRect, inClatterGlade, inSpireFloor, inSpireGateZone, spireSeesPlayer, spireStandable,
} from '../bossZones';
import { GRID_SIZE, SPAWN_TILE } from '../constants';
import { chatVisible, joinSpot } from '../friends';
import { GIANT_AGGRO_RANGE, GIANT_TILE } from '../giant';
import { chebyshev, isLandTile, tileKey } from '../grid';
import { TREE_SEEDS } from '../items';
import { NODE_SEEDS } from '../nodes';
import { bfsPath, goalIsTile, reachableTiles } from '../pathfinding';
import { worldBlockedSet } from '../social';
import { SPIRE_STAR_TILES } from '../spire';
import { FOREST_TREES, LANDMARKS, SCENERY_BLOCKERS, TERRAIN_MAP, nearestDryTile, terrainField, terrainLand, trailDistance } from '../terrain';
import type { Tile } from '../types';

const blocked = worldBlockedSet([...TREE_SEEDS, ...NODE_SEEDS]);
const tilesIn = (r: { x0: number; z0: number; x1: number; z1: number }) => {
  const out: Tile[] = [];
  for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) out.push({ x, z });
  return out;
};
const club = enterRule(true, true), stick = enterRule(true, false);

describe("Clatterhorn's Glade", () => {
  const glade = tilesIn(CLATTER_GLADE);

  it('is 289 open Coast tiles with no nodes or trunks, 4+ tiles from every trail', () => {
    expect(glade).toHaveLength(289);
    for (const t of glade) {
      expect(terrainLand(t), `${t.x},${t.z}`).toBe(true);
      expect(areaOf(t)).toBe('coast');
      expect(trailDistance(t.x, t.z)).toBeGreaterThanOrEqual(4);
    }
    expect([...TREE_SEEDS, ...NODE_SEEDS].filter(inClatterGlade)).toEqual([]);
    expect(FOREST_TREES.filter(inClatterGlade)).toEqual([]);
    expect(inClatterGlade(CLATTER_HOME)).toBe(true);
  });

  it('rings home with 8 standing stones that block, on Coast land, and disconnect nothing', () => {
    expect(CLATTER_STONES).toHaveLength(8);
    for (const s of CLATTER_STONES) {
      expect(inClatterGlade(s)).toBe(true);
      expect(areaOf(s)).toBe('coast');
      expect(blocked.has(tileKey(s))).toBe(true);
      const [dx, dz] = [Math.abs(s.x - CLATTER_HOME.x), Math.abs(s.z - CLATTER_HOME.z)].sort((a, b) => a - b);
      expect([dx, dz]).toEqual([3, 6]);
    }
    const seen = reachableTiles(SPAWN_TILE, blocked, stick);
    for (const t of glade) if (!blocked.has(tileKey(t))) expect(seen.has(tileKey(t)), `${t.x},${t.z}`).toBe(true);
  });

  it('is reachable from spawn with a stick', () => {
    expect(bfsPath(SPAWN_TILE, goalIsTile(CLATTER_HOME), blocked, stick)).not.toBeNull();
  });
});

describe('the Sunken Spire floor', () => {
  const floor = tilesIn(SPIRE_FLOOR);

  it('is 225 land tiles that are never rendered (terrainField stays sea)', () => {
    expect(floor).toHaveLength(225);
    for (const t of floor) {
      expect(terrainLand(t)).toBe(true);
      expect(isLandTile(t)).toBe(true);
      expect(terrainField(t.x, t.z)).toBeLessThan(0);
      expect(areaOf(t)).toBe('spire');
      expect(TERRAIN_MAP.rows[t.z][t.x]).toBe('%');
    }
    expect(TERRAIN_MAP.rows.join('').split('%')).toHaveLength(226);
  });

  it('has 216 standable tiles around a blocked dais, 72 court tiles and 200 star tiles', () => {
    expect(SPIRE_DAIS).toHaveLength(9);
    for (const t of SPIRE_DAIS) { expect(blocked.has(tileKey(t))).toBe(true); expect(spireStandable(t)).toBe(false); }
    const standable = floor.filter(spireStandable);
    expect(standable).toHaveLength(216);
    expect(standable.every((t) => !blocked.has(tileKey(t)))).toBe(true);
    expect(standable.filter((t) => chebyshev(t, SPIRE_CENTRE) <= 4)).toHaveLength(72);
    expect(SPIRE_STAR_TILES).toHaveLength(200);
    for (const t of SPIRE_STAR_TILES) { expect(spireStandable(t)).toBe(true); expect(chebyshev(t, SPIRE_CENTRE)).toBeGreaterThanOrEqual(3); }
  });

  it('is sealed: unreachable from spawn, 7+ tiles from real land, and one component inside', () => {
    const seen = reachableTiles(SPAWN_TILE, blocked, club);
    for (const t of floor) expect(seen.has(tileKey(t))).toBe(false);
    let nearest = Infinity;
    for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) {
      if (inSpireFloor({ x, z }) || !terrainLand({ x, z })) continue;
      nearest = Math.min(nearest, Math.max(SPIRE_FLOOR.x0 - x, 0, x - SPIRE_FLOOR.x1, SPIRE_FLOOR.z0 - z, 0, z - SPIRE_FLOOR.z1));
    }
    expect(nearest).toBeGreaterThanOrEqual(7);
    const inside = reachableTiles({ x: 72, z: 68 }, blocked, undefined, inSpireFloor);
    expect(inside.size).toBe(216);
  });

  it('never relocates anyone onto the floor', () => {
    for (const from of [SPIRE_CENTRE, { x: 70, z: 55 }, { x: 84, z: 69 }, { x: 77, z: 50 }]) {
      const t = nearestDryTile(from, blocked);
      expect(inSpireFloor(t)).toBe(false);
      expect(isLandTile(t)).toBe(true);
    }
  });

  it('only counts whole tiles', () => {
    expect(inSpireFloor({ x: 77, z: 62 })).toBe(true);
    expect(inSpireFloor({ x: 77.5, z: 62 })).toBe(false);
    expect(inSpireFloor({ x: 69, z: 62 })).toBe(false);
    expect(inBossRect({ x: 84, z: 69 }, SPIRE_FLOOR)).toBe(true);
  });
});

describe('the Spire Gate', () => {
  it('is a blocked Boulders tile 12 from the Giant with a 28-tile lobby outside its aggro', () => {
    expect(inBoulders(SPIRE_GATE)).toBe(true);
    expect(SCENERY_BLOCKERS.some((t) => t.x === SPIRE_GATE.x && t.z === SPIRE_GATE.z)).toBe(true);
    expect(blocked.has(tileKey(SPIRE_GATE))).toBe(true);
    expect(chebyshev(SPIRE_GATE, GIANT_TILE)).toBe(12);
    const lobby = tilesIn({ x0: SPIRE_GATE.x - 3, z0: SPIRE_GATE.z - 3, x1: SPIRE_GATE.x + 3, z1: SPIRE_GATE.z + 3 })
      .filter((t) => terrainLand(t) && !blocked.has(tileKey(t)));
    expect(lobby).toHaveLength(28);
    for (const t of lobby) { expect(inSpireGateZone(t)).toBe(true); expect(chebyshev(t, GIANT_TILE)).toBeGreaterThan(GIANT_AGGRO_RANGE); }
  });

  it('exits onto an open Boulders tile reachable with a club and not with a stick only', () => {
    expect(areaOf(SPIRE_EXIT)).toBe('boulders');
    expect(blocked.has(tileKey(SPIRE_EXIT))).toBe(false);
    expect(bfsPath(SPAWN_TILE, goalIsTile(SPIRE_EXIT), blocked, club)).not.toBeNull();
    expect(bfsPath(SPAWN_TILE, goalIsTile(SPIRE_EXIT), blocked, stick)).toBeNull();
  });

  it('with the stones, disconnects no land tile', () => {
    const scenery = new Set([...CLATTER_STONES, SPIRE_GATE].map(tileKey));
    const without = new Set([...blocked].filter((k) => !scenery.has(k)));
    const before = reachableTiles(SPAWN_TILE, without, club), after = reachableTiles(SPAWN_TILE, blocked, club);
    for (const k of before) if (!scenery.has(k)) expect(after.has(k), `${k % GRID_SIZE},${Math.floor(k / GRID_SIZE)}`).toBe(true);
  });
});

describe('registries and shared rules', () => {
  it('appends the glade and the gate as landmarks 16 and 17', () => {
    expect(LANDMARKS[16]).toMatchObject({ id: 'glade', x: 84, z: 106, access: 'coast' });
    expect(LANDMARKS[17]).toMatchObject({ id: 'spire', x: 62, z: 45, access: 'boulders' });
    expect(TERRAIN_MAP.version).toBe('bramblewild-expanse-v2');
  });

  it('names the no-PvP boss zones', () => {
    expect(bossNoPvpZone(CLATTER_HOME)).toBe('glade');
    expect(bossNoPvpZone({ x: 60, z: 47 })).toBe('gate');
    expect(bossNoPvpZone(SPIRE_CENTRE)).toBe('spire');
    expect(bossNoPvpZone(SPAWN_TILE)).toBeNull();
    expect(bossNoPvpZone({ x: 58, z: 45 })).toBeNull();
  });

  it('applies one visibility rule across the floor boundary', () => {
    const over = { x: 61, z: 45 }, floorA = { x: 72, z: 68 }, floorB = { x: 75, z: 68 };
    expect(spireSeesPlayer(over, over, false)).toBe(true);
    expect(spireSeesPlayer(over, floorA, false)).toBe(false);
    expect(spireSeesPlayer(over, floorA, true)).toBe(false);
    expect(spireSeesPlayer(floorA, floorB, true)).toBe(true);
    expect(spireSeesPlayer(floorA, floorB, false)).toBe(false);
    expect(spireSeesPlayer(floorA, over, true)).toBe(false);
  });

  it('keeps nearby chat on its own side of the floor boundary', () => {
    expect(chatVisible('nearby', { x: 72, z: 68 }, { x: 74, z: 68 })).toBe(true);
    expect(chatVisible('nearby', { x: 72, z: 68 }, { x: 68, z: 68 })).toBe(false);
    expect(chatVisible('nearby', { x: 68, z: 68 }, { x: 72, z: 68 })).toBe(false);
    expect(chatVisible('all', { x: 68, z: 68 }, { x: 72, z: 68 })).toBe(true);
    expect(chatVisible('nearby', { x: 68, z: 68, region: 'bramblewild' }, { x: 72, z: 68 })).toBe(false);
    expect(chatVisible('nearby', { x: 68, z: 68, region: '' }, { x: 72, z: 68 })).toBe(false);
  });

  it('splits nearby chat only in Bramblewild: the Meadows reuse those numbers for open land', () => {
    for (const region of ['settlement', 'reedwake', 'cinder']) {
      expect(chatVisible('nearby', { x: 75, z: 60, region }, { x: 66, z: 60 })).toBe(true);
      expect(chatVisible('nearby', { x: 66, z: 60, region }, { x: 72, z: 60 })).toBe(true);
      expect(chatVisible('nearby', { x: 66, z: 60, region }, { x: 66 + 13, z: 60 })).toBe(false);
    }
  });

  it('lands invite joiners near the exit when the inviter is inside the Spire', () => {
    const spot = joinSpot({ x: 77, z: 66 }, true, blocked, true);
    expect(inSpireFloor(spot.tile)).toBe(false);
    expect(chebyshev(spot.tile, SPIRE_EXIT)).toBeLessThanOrEqual(2);
    const stickOnly = joinSpot({ x: 77, z: 66 }, true, blocked, false);
    expect(inSpireFloor(stickOnly.tile)).toBe(false);
    expect(stickOnly.clamped).toBe(true);
  });
});
