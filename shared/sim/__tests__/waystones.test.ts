import { describe, expect, it } from 'vitest';
import { RESPAWN_POINTS, WAYSTONES, respawnPointFor } from '../expanse';
import { GRID_SIZE, SPAWN_TILE } from '../constants';
import { isLandTile, tileKey } from '../grid';
import { bossNoPvpZone, inSafeRing } from '../areas';
import { worldBlockedSet } from '../social';
import { TREE_SEEDS } from '../items';
import { NODE_SEEDS } from '../nodes';
import { groveBoundary, inGiantHeadland, nearestDryTile, terrainLand } from '../terrain';
import { inSpireFloor } from '../bossZones';
import { LEDGER_CLERK, LEDGER_CLERKS, LEDGER_RANGE, nearLedgerClerk, nearestLedgerClerk } from '../ledger';
import { gridPath, distance, type PathBlocker } from '../frontier/regions';
import type { Point } from '../frontier/catalog';
import type { Tile } from '../types';

const blocked = worldBlockedSet([...TREE_SEEDS, ...NODE_SEEDS]);

/** A tiny deterministic PRNG so the random cases are the same every run. */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

describe('waystone respawns', () => {
  it('every respawn point is open land outside the boss zones, and only the spawn is in the safe ring', () => {
    expect(RESPAWN_POINTS[0]).toMatchObject(SPAWN_TILE);
    for (const w of RESPAWN_POINTS) {
      expect(isLandTile(w), w.id).toBe(true);
      expect(blocked.has(tileKey(w)), w.id).toBe(false);
      expect(bossNoPvpZone(w), w.id).toBeNull();
      expect(groveBoundary(w), w.id).toBe(false);
    }
    for (const w of WAYSTONES) expect(inSafeRing(w), w.id).toBe(false);
  });

  it('picks the nearest point by straight-line distance, ties to the earlier one', () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const fell = { x: Math.floor(r() * GRID_SIZE), z: Math.floor(r() * GRID_SIZE) };
      const got = respawnPointFor(fell);
      const d = (p: Tile) => (p.x - fell.x) ** 2 + (p.z - fell.z) ** 2;
      const best = Math.min(...RESPAWN_POINTS.map(d));
      expect(d(got)).toBe(best);
      expect(got).toBe(RESPAWN_POINTS.find((p) => d(p) === best));
    }
    expect(respawnPointFor({ x: 30, z: 30 }).id).toBe('spawn');
    expect(respawnPointFor({ x: 172, z: 124 }).id).toBe('crossroads');
    expect(respawnPointFor({ x: 200, z: 214 }).id).toBe('crater');
    expect(respawnPointFor({ x: 40, z: 180 }).id).toBe('fenhold');
  });
});

describe('ledger clerks', () => {
  it('keep the market clerk first and add the mainland towns', () => {
    expect(LEDGER_CLERKS[0]).toMatchObject(LEDGER_CLERK);
    expect(LEDGER_CLERKS.map((c) => c.id)).toEqual(['market', 'crossroads', 'kingsgate', 'fenhold']);
    for (const c of LEDGER_CLERKS) {
      expect(nearLedgerClerk({ x: c.x + LEDGER_RANGE, z: c.z - LEDGER_RANGE }), c.id).toBe(true);
      expect(nearestLedgerClerk(c).id).toBe(c.id);
    }
    expect(nearLedgerClerk({ x: 172 + LEDGER_RANGE + 1, z: 124 })).toBe(false);
    expect(nearestLedgerClerk({ x: 0, z: 0 }).id).toBe('market');
  });
});

/** The original full-grid scan, kept as the reference. */
function bruteNearestDry(from: Tile, blockedKeys: ReadonlySet<number>): Tile {
  let best = { x: 25, z: 25 }, d0 = Infinity;
  for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) {
    if (!terrainLand({ x, z }) || blockedKeys.has(z * GRID_SIZE + x) || groveBoundary({ x, z }) || (inGiantHeadland({ x, z }) && Math.max(x, z) === 50) || inSpireFloor({ x, z })) continue;
    const d = (from.x - x) ** 2 + (from.z - z) ** 2;
    if (d < d0) { best = { x, z }; d0 = d; }
  }
  return best;
}

describe('nearestDryTile', () => {
  it('matches the full-grid scan on random points, off-grid points and the sea', () => {
    const r = rng(42);
    const cases: Tile[] = [{ x: 0, z: 0 }, { x: GRID_SIZE - 1, z: GRID_SIZE - 1 }, { x: -20, z: 300 }, { x: 25, z: 25 }, { x: 128, z: 128 }, { x: 62, z: 45 }, { x: 50, z: 50 }];
    for (let i = 0; i < 60; i++) cases.push({ x: Math.floor(r() * GRID_SIZE), z: Math.floor(r() * GRID_SIZE) });
    for (let i = 0; i < 10; i++) cases.push({ x: r() * GRID_SIZE, z: r() * GRID_SIZE });
    for (const t of cases) expect(nearestDryTile(t, blocked), `${t.x},${t.z}`).toEqual(bruteNearestDry(t, blocked));
    expect(nearestDryTile({ x: 3, z: 3 })).toEqual(bruteNearestDry({ x: 3, z: 3 }, new Set()));
  });

  it('breaks distance ties toward the smaller z, then the smaller x', () => {
    // Blocking the start tile itself leaves its four neighbours tied at distance 1.
    const t = { x: 172, z: 124 };
    const b = new Set([tileKey(t)]);
    expect(nearestDryTile(t, b)).toEqual(bruteNearestDry(t, b));
    expect(nearestDryTile(t, b)).toEqual({ x: 172, z: 123 });
  });
});

/** gridPath as it was before the scratch buffers (fresh arrays every call). */
function referenceGridPath(width: number, height: number, from: Point, to: Point, land: (p: Point) => boolean, blockedFn: PathBlocker): Point[] | null {
  const inGrid = (p: Point) => Number.isInteger(p.x) && Number.isInteger(p.z) && p.x >= 0 && p.z >= 0 && p.x < width && p.z < height;
  if (!inGrid(from) || !inGrid(to) || !land(from) || !land(to) || blockedFn(to)) return null;
  const size = width, key = (p: Point) => p.z * size + p.x;
  const start = key(from), goal = key(to), parents = new Int32Array(width * height).fill(-1), costs = new Float64Array(width * height).fill(Infinity);
  costs[start] = 0; parents[start] = start;
  type Node = { key: number; cost: number; h: number; score: number };
  const heap: Node[] = [];
  const before = (a: Node, b: Node) => a.score < b.score || (a.score === b.score && (a.h < b.h || (a.h === b.h && a.key < b.key)));
  const push = (node: Node) => { let i = heap.length; heap.push(node); while (i) { const parent = (i - 1) >> 1; if (!before(node, heap[parent])) break; heap[i] = heap[parent]; i = parent; } heap[i] = node; };
  const pop = () => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) { let c = i * 2 + 1; if (c + 1 < heap.length && before(heap[c + 1], heap[c])) c++; if (!before(heap[c], last)) break; heap[i] = heap[c]; i = c; }
      heap[i] = last;
    }
    return first;
  };
  const pass = (p: Point) => inGrid(p) && land(p) && !blockedFn(p);
  push({ key: start, cost: 0, h: distance(from, to), score: distance(from, to) });
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  while (heap.length) {
    const node = pop(), k = node.key;
    if (node.cost !== costs[k]) continue;
    if (k === goal) { const out: Point[] = []; for (let at = k; at !== start; at = parents[at]) out.push({ x: at % size, z: Math.floor(at / size) }); return out.reverse(); }
    const p = { x: k % size, z: Math.floor(k / size) };
    for (const [dx, dz] of dirs) {
      const n = { x: p.x + dx, z: p.z + dz };
      if (!pass(n)) continue;
      if (dx && dz && (!pass({ x: p.x + dx, z: p.z }) || !pass({ x: p.x, z: p.z + dz }))) continue;
      const next = key(n), cost = node.cost + 1;
      if (cost >= costs[next]) continue;
      costs[next] = cost; parents[next] = k;
      const h = distance(n, to);
      push({ key: next, cost, h, score: cost + h });
    }
  }
  return null;
}

describe('gridPath scratch buffers', () => {
  it('returns the same routes as fresh arrays, call after call, on two grid sizes', () => {
    const r = rng(3);
    for (const [w, hgt] of [[48, 40], [128, 128]] as const) {
      const walls = new Set<number>();
      for (let i = 0; i < w * hgt * 0.25; i++) walls.add(Math.floor(r() * w * hgt));
      const land = (p: Point) => !walls.has(p.z * w + p.x);
      const none: PathBlocker = () => false;
      for (let i = 0; i < 60; i++) {
        const from = { x: Math.floor(r() * w), z: Math.floor(r() * hgt) }, to = { x: Math.floor(r() * w), z: Math.floor(r() * hgt) };
        expect(gridPath(w, hgt, from, to, land, none)).toEqual(referenceGridPath(w, hgt, from, to, land, none));
      }
    }
  });

  it('survives a re-entrant search from inside a callback', () => {
    const w = 32, hgt = 32, open = () => true, none: PathBlocker = () => false;
    let inner: Point[] | null | undefined;
    const land = (p: Point) => { if (inner === undefined && p.x === 5) inner = gridPath(w, hgt, { x: 0, z: 0 }, { x: 3, z: 3 }, open, none); return true; };
    const outer = gridPath(w, hgt, { x: 0, z: 0 }, { x: 20, z: 10 }, land, none);
    expect(outer).toEqual(referenceGridPath(w, hgt, { x: 0, z: 0 }, { x: 20, z: 10 }, open, none));
    expect(inner).toEqual(referenceGridPath(w, hgt, { x: 0, z: 0 }, { x: 3, z: 3 }, open, none));
    expect(gridPath(w, hgt, { x: 0, z: 0 }, { x: 3, z: 3 }, open, none)).toEqual(inner);
  });
});
