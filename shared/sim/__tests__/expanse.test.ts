import { describe, expect, it } from 'vitest';
import { BIOMES, CAUSEWAYS, EXPANSE_BRIDGES, EXPANSE_LANDMARKS, RIDGES, WAYSTONES, biomeOf, onRidge, type BiomeId } from '../expanse';
import { GRID_SIZE, ISLE_SIZE, SPAWN_TILE } from '../constants';
import { isLandTile, tileKey } from '../grid';
import { enterRule } from '../areas';
import { bfsPath, blockedVersion, goalIsTile, reachableTiles, routePath, type RouteCache } from '../pathfinding';
import { worldBlockedSet } from '../social';
import { TREE_SEEDS } from '../items';
import { NODE_SEEDS } from '../nodes';
import { RIDGE_TILES, SCENERY_BLOCKERS, TRAILS, trailDistance } from '../terrain';
import type { Tile } from '../types';

const blocked = worldBlockedSet([...TREE_SEEDS, ...NODE_SEEDS]);
const walk = enterRule(true, true);
const landCount = () => { let n = 0; for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) if (isLandTile({ x, z })) n++; return n; };

describe('the Expanse', () => {
  it('is about four times the original island, with every biome holding thousands of tiles', () => {
    expect(GRID_SIZE).toBe(2 * ISLE_SIZE);
    expect(landCount()).toBeGreaterThan(34_000);
    const per: Record<string, number> = {};
    for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) if (isLandTile({ x, z })) { const b = biomeOf({ x, z }); per[b] = (per[b] ?? 0) + 1; }
    for (const id of Object.keys(BIOMES) as BiomeId[]) expect(per[id], id).toBeGreaterThan(2500);
  });

  it('connects every biome to spawn on foot', () => {
    const seen = reachableTiles(SPAWN_TILE, blocked, walk);
    for (const l of [...EXPANSE_LANDMARKS, ...WAYSTONES]) {
      const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dz]) => seen.has(tileKey({ x: l.x + dx, z: l.z + dz })));
      expect(near, l.id).toBe(true);
    }
  });

  it('makes each causeway the only way between its two shores', () => {
    for (const c of CAUSEWAYS) {
      // Cut the causeway at its middle third and the far end must be out of reach from the near end (or reachable only the long way round).
      const cut = new Set(blocked);
      for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) {
        const dx = c.to.x - c.from.x, dz = c.to.z - c.from.z, len2 = dx * dx + dz * dz;
        const t = ((x - c.from.x) * dx + (z - c.from.z) * dz) / len2;
        if (t < .4 || t > .6) continue;
        const px = c.from.x + t * dx, pz = c.from.z + t * dz;
        if (Math.hypot(x - px, z - pz) <= c.width + 1.5) cut.add(z * GRID_SIZE + x);
      }
      const direct = bfsPath(c.from, goalIsTile(c.to), blocked, walk);
      const around = bfsPath(c.from, goalIsTile(c.to), cut, walk);
      expect(direct, c.id).not.toBeNull();
      // Every causeway is a real shortcut: the detour, if any, is much longer.
      if (around) expect(around.length, c.id).toBeGreaterThan(direct!.length * 3);
    }
  });

  it('runs the King\'s Road dry from the harbour road to the Meadows join', () => {
    for (let x = 100; x < GRID_SIZE; x++) expect(isLandTile({ x, z: 25 }), `${x},25`).toBe(true);
  });

  it('builds the ridges as walls with open passes', () => {
    expect(RIDGE_TILES.length).toBeGreaterThan(150);
    for (const t of RIDGE_TILES) expect(SCENERY_BLOCKERS).toContainEqual(t);
    for (const r of RIDGES) for (const p of r.passes) {
      expect(onRidge(p), `${r.id} pass`).toBe(false);
      expect(blocked.has(tileKey(p)), `${r.id} pass ${p.x},${p.z}`).toBe(false);
    }
  });

  it('keeps every road, bridge and waystone clear of trees, ridges and nodes', () => {
    for (const b of EXPANSE_BRIDGES) expect(isLandTile(b), b.id).toBe(true);
    for (const w of WAYSTONES) { expect(isLandTile(w), w.id).toBe(true); expect(blocked.has(tileKey(w)), w.id).toBe(false); }
    let onRoad = 0;
    for (const k of blocked) { const x = k % GRID_SIZE, z = Math.floor(k / GRID_SIZE); if (trailDistance(x, z) < 1 && !onRidge({ x, z })) onRoad++; }
    // A handful of original island obstacles sit beside paths; the mainland roads stay open.
    expect(onRoad).toBeLessThan(15);
    expect(TRAILS.length).toBeGreaterThan(12);
  });

  it('walks across the whole map searching once: later ticks reuse the route', () => {
    const crater = WAYSTONES.find((w) => w.id === 'crater')!;
    const cache: RouteCache = new Map();
    const version = blockedVersion(blocked);
    const goal = goalIsTile(crater);
    const t0 = performance.now();
    const first = routePath(cache, 'walker', SPAWN_TILE, goal, blocked, walk, '11', version)!;
    const firstMs = performance.now() - t0;
    expect(first.length).toBeGreaterThan(200);
    // A fresh search is the same length as the cached plan.
    expect(bfsPath(SPAWN_TILE, goal, blocked, walk)!.length).toBe(first.length);
    // Walk it two steps a tick; every later tick is a cache hit.
    let at: Tile = SPAWN_TILE, ticks = 0;
    const t1 = performance.now();
    while (!(at.x === crater.x && at.z === crater.z)) {
      const path = routePath(cache, 'walker', at, goal, blocked, walk, '11', version)!;
      at = path[Math.min(1, path.length - 1)];
      ticks++;
    }
    const perTick = (performance.now() - t1) / ticks;
    expect(ticks).toBe(Math.ceil(first.length / 2));
    expect(firstMs).toBeLessThan(250);
    expect(perTick).toBeLessThan(1);
    // A new key set (dropping the club) plans again.
    expect(routePath(cache, 'walker', SPAWN_TILE, goal, blocked, enterRule(true, false), '10', version)).not.toBeNull();
    expect(cache.get('walker')!.ruleKey).toBe('10');
  });
});
