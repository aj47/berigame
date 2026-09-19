import { GRID_SIZE } from './constants';
import { chebyshev, inBounds, tileEquals, tileKey } from './grid';
import type { Tile } from './types';

const DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [-1, 0], [0, -1], [1, 0], [-1, 1], [-1, -1], [1, -1], [1, 1],
];

function canStep(from: Tile, dx: number, dz: number, blocked: Set<number>): Tile | null {
  const to = { x: from.x + dx, z: from.z + dz };
  if (!inBounds(to) || blocked.has(tileKey(to))) return null;
  // No corner cutting: a diagonal needs both orthogonal neighbours free.
  if (dx !== 0 && dz !== 0) {
    if (blocked.has(tileKey({ x: from.x + dx, z: from.z }))) return null;
    if (blocked.has(tileKey({ x: from.x, z: from.z + dz }))) return null;
  }
  return to;
}

/**
 * Breadth-first search over the 8-connected grid. Returns the full path from
 * `start` (exclusive) to the first tile satisfying `isGoal`, or null if
 * unreachable. `start` itself satisfying the goal returns [].
 */
export function bfsPath(start: Tile, isGoal: (t: Tile) => boolean, blocked: Set<number>): Tile[] | null {
  if (isGoal(start)) return [];
  const startKey = tileKey(start);
  const parent = new Int32Array(GRID_SIZE * GRID_SIZE).fill(-1);
  parent[startKey] = startKey;
  const queue: Tile[] = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const [dx, dz] of DELTAS) {
      const next = canStep(cur, dx, dz, blocked);
      if (!next) continue;
      const k = tileKey(next);
      if (parent[k] !== -1) continue;
      parent[k] = tileKey(cur);
      if (isGoal(next)) {
        const path: Tile[] = [];
        let walk = k;
        while (walk !== startKey) {
          path.push({ x: walk % GRID_SIZE, z: Math.floor(walk / GRID_SIZE) });
          walk = parent[walk];
        }
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** First tile of the BFS path, or null when already there / unreachable. */
export function bfsNextStep(start: Tile, isGoal: (t: Tile) => boolean, blocked: Set<number>): Tile | null {
  const path = bfsPath(start, isGoal, blocked);
  if (!path || path.length === 0) return null;
  return path[0];
}

export function goalIsTile(target: Tile): (t: Tile) => boolean {
  return (t) => tileEquals(t, target);
}

/** Goal: any unblocked tile within melee range of `target` (including target itself if unblocked). */
export function goalAdjacentTo(target: Tile, blocked: Set<number>, range = 1): (t: Tile) => boolean {
  return (t) => chebyshev(t, target) <= range && !blocked.has(tileKey(t));
}

/**
 * `goal` if reachable, else the reachable tile with the smallest Chebyshev
 * distance to `goal` (ties broken by BFS order, i.e. closest to start).
 */
export function nearestReachableTile(start: Tile, goal: Tile, blocked: Set<number>): Tile {
  if (!blocked.has(tileKey(goal)) && bfsPath(start, goalIsTile(goal), blocked)) return goal;
  const seen = new Set<number>([tileKey(start)]);
  const queue: Tile[] = [start];
  let head = 0;
  let best = start;
  let bestD = chebyshev(start, goal);
  while (head < queue.length) {
    const cur = queue[head++];
    for (const [dx, dz] of DELTAS) {
      const next = canStep(cur, dx, dz, blocked);
      if (!next) continue;
      const k = tileKey(next);
      if (seen.has(k)) continue;
      seen.add(k);
      const d = chebyshev(next, goal);
      if (d < bestD) {
        bestD = d;
        best = next;
      }
      queue.push(next);
    }
  }
  return best;
}
