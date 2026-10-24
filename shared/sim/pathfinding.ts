import { GRID_SIZE } from './constants';
import { chebyshev, isLandTile, LAND_MASK, tileEquals, tileKey } from './grid';
import type { Tile } from './types';

const DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [-1, 0], [0, -1], [1, 0], [-1, 1], [-1, -1], [1, -1], [1, 1],
];
const DX = Int8Array.from(DELTAS, ([dx]) => dx);
const DZ = Int8Array.from(DELTAS, ([, dz]) => dz);

/** Extra per-player passability, e.g. the bramble rule. Default: every step allowed. */
export type EnterRule = (from: Tile, to: Tile) => boolean;
const allowAll: EnterRule = () => true;

function canStep(from: Tile, dx: number, dz: number, blocked: Set<number>, enter: EnterRule): Tile | null {
  const to = { x: from.x + dx, z: from.z + dz };
  if (!isLandTile(to) || blocked.has(tileKey(to)) || !enter(from, to)) return null;
  // No corner cutting: a diagonal needs both orthogonal neighbours free (and enterable).
  if (dx !== 0 && dz !== 0) {
    const a = { x: from.x + dx, z: from.z };
    const b = { x: from.x, z: from.z + dz };
    if (!isLandTile(a) || blocked.has(tileKey(a)) || !enter(from, a)) return null;
    if (!isLandTile(b) || blocked.has(tileKey(b)) || !enter(from, b)) return null;
  }
  return to;
}

/*
 * BFS scratch, reused by every call (the tick runs one search per moving
 * player). A cell is visited in this search iff visitStamp[key] === stamp, so
 * nothing is cleared between searches. Single-threaded and never re-entered:
 * isGoal and enter are plain predicates.
 */
const CELLS = GRID_SIZE * GRID_SIZE;
const visitStamp = new Int32Array(CELLS);
const parentOf = new Int32Array(CELLS);
const queueKeys = new Int32Array(CELLS);
let stamp = 0;

/**
 * Breadth-first search over the 8-connected grid. Returns the full path from
 * `start` (exclusive) to the first tile satisfying `isGoal`, or null if
 * unreachable. `start` itself satisfying the goal returns [].
 */
export function bfsPath(start: Tile, isGoal: (t: Tile) => boolean, blocked: Set<number>, enter: EnterRule = allowAll): Tile[] | null {
  if (isGoal(start)) return [];
  const aim = (isGoal as AimedGoal).aim;
  if (aim) return aimedPath(start, isGoal, aim.target, aim.range, blocked, enter);
  if (++stamp === 0x7fffffff) { visitStamp.fill(0); stamp = 1; }
  const startKey = tileKey(start);
  const checkEnter = enter !== allowAll;
  // Same discovery order and step rules as canStep; tiles are only allocated
  // for the predicates, and a visited cell is skipped before any of them.
  visitStamp[startKey] = stamp;
  parentOf[startKey] = startKey;
  queueKeys[0] = startKey;
  let head = 0, tail = 1;
  let from: Tile = start;
  while (head < tail) {
    const curKey = queueKeys[head++];
    const cx = curKey % GRID_SIZE, cz = (curKey - cx) / GRID_SIZE;
    if (head > 1) from = { x: cx, z: cz };
    for (let d = 0; d < 8; d++) {
      const dx = DX[d], dz = DZ[d];
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nx >= GRID_SIZE || nz < 0 || nz >= GRID_SIZE) continue;
      const k = nz * GRID_SIZE + nx;
      if (visitStamp[k] === stamp || LAND_MASK[k] === 0 || blocked.has(k)) continue;
      const to = { x: nx, z: nz };
      if (checkEnter && !enter(from, to)) continue;
      // No corner cutting: a diagonal needs both orthogonal neighbours free (and enterable).
      if (dx !== 0 && dz !== 0) {
        if (LAND_MASK[cz * GRID_SIZE + nx] === 0 || blocked.has(cz * GRID_SIZE + nx) || (checkEnter && !enter(from, { x: nx, z: cz }))) continue;
        if (LAND_MASK[nz * GRID_SIZE + cx] === 0 || blocked.has(nz * GRID_SIZE + cx) || (checkEnter && !enter(from, { x: cx, z: nz }))) continue;
      }
      visitStamp[k] = stamp;
      parentOf[k] = curKey;
      if (isGoal(to)) {
        const path: Tile[] = [];
        let walk = k;
        while (walk !== startKey) {
          path.push({ x: walk % GRID_SIZE, z: Math.floor(walk / GRID_SIZE) });
          walk = parentOf[walk];
        }
        path.reverse();
        return path;
      }
      queueKeys[tail++] = k;
    }
  }
  return null;
}

/**
 * A goal that knows where it is (a tile, or anything within `range` of one).
 * bfsPath then searches with A* toward it instead of flooding outwards: on a
 * 256-tile map a cross-country walk expands a corridor, not the whole island.
 * Paths are still shortest (every step costs 1 and the Chebyshev distance
 * never overestimates), and the tie-breaking is fixed, so the server, the
 * client and agents step the same way.
 */
type AimedGoal = ((t: Tile) => boolean) & { aim?: { target: Tile; range: number } };
function aimed(goal: (t: Tile) => boolean, target: Tile, range: number): (t: Tile) => boolean {
  return Object.assign(goal, { aim: { target: { x: target.x, z: target.z }, range } });
}

const gScore = new Int32Array(CELLS);
const closedStamp = new Int32Array(CELLS);
// Binary heap of (priority, sequence, key); priority packs f then h so ties go to the tile nearer the goal.
let heapPri: number[] = [], heapSeq: number[] = [], heapKey: number[] = [];
function heapPush(pri: number, seq: number, key: number): void {
  let i = heapPri.length;
  heapPri.push(pri); heapSeq.push(seq); heapKey.push(key);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapPri[p] < pri || (heapPri[p] === pri && heapSeq[p] < seq)) break;
    heapPri[i] = heapPri[p]; heapSeq[i] = heapSeq[p]; heapKey[i] = heapKey[p];
    i = p;
  }
  heapPri[i] = pri; heapSeq[i] = seq; heapKey[i] = key;
}
function heapPop(): number {
  const top = heapKey[0];
  const pri = heapPri.pop()!, seq = heapSeq.pop()!, key = heapKey.pop()!;
  const n = heapPri.length;
  if (n > 0) {
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i, mp = pri, ms = seq;
      if (l < n && (heapPri[l] < mp || (heapPri[l] === mp && heapSeq[l] < ms))) { m = l; mp = heapPri[l]; ms = heapSeq[l]; }
      if (r < n && (heapPri[r] < mp || (heapPri[r] === mp && heapSeq[r] < ms))) { m = r; }
      if (m === i) break;
      heapPri[i] = heapPri[m]; heapSeq[i] = heapSeq[m]; heapKey[i] = heapKey[m];
      i = m;
    }
    heapPri[i] = pri; heapSeq[i] = seq; heapKey[i] = key;
  }
  return top;
}

function aimedPath(start: Tile, isGoal: (t: Tile) => boolean, target: Tile, range: number, blocked: Set<number>, enter: EnterRule): Tile[] | null {
  if (++stamp === 0x7fffffff) { visitStamp.fill(0); closedStamp.fill(0); stamp = 1; }
  const checkEnter = enter !== allowAll;
  const h = (x: number, z: number) => Math.max(0, Math.max(Math.abs(x - target.x), Math.abs(z - target.z)) - range);
  const startKey = tileKey(start);
  heapPri = []; heapSeq = []; heapKey = [];
  let seq = 0;
  visitStamp[startKey] = stamp; gScore[startKey] = 0; parentOf[startKey] = startKey;
  const h0 = h(start.x, start.z);
  heapPush(h0 * 1024 + h0, seq++, startKey);
  while (heapKey.length) {
    const curKey = heapPop();
    if (closedStamp[curKey] === stamp) continue;
    closedStamp[curKey] = stamp;
    const cx = curKey % GRID_SIZE, cz = (curKey - cx) / GRID_SIZE;
    const from: Tile = { x: cx, z: cz };
    if (curKey !== startKey && isGoal(from)) {
      const path: Tile[] = [];
      let walk = curKey;
      while (walk !== startKey) {
        path.push({ x: walk % GRID_SIZE, z: Math.floor(walk / GRID_SIZE) });
        walk = parentOf[walk];
      }
      path.reverse();
      return path;
    }
    const g = gScore[curKey] + 1;
    for (let d = 0; d < 8; d++) {
      const dx = DX[d], dz = DZ[d];
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nx >= GRID_SIZE || nz < 0 || nz >= GRID_SIZE) continue;
      const k = nz * GRID_SIZE + nx;
      if (closedStamp[k] === stamp || LAND_MASK[k] === 0 || blocked.has(k)) continue;
      if (visitStamp[k] === stamp && gScore[k] <= g) continue;
      const to = { x: nx, z: nz };
      if (checkEnter && !enter(from, to)) continue;
      if (dx !== 0 && dz !== 0) {
        if (LAND_MASK[cz * GRID_SIZE + nx] === 0 || blocked.has(cz * GRID_SIZE + nx) || (checkEnter && !enter(from, { x: nx, z: cz }))) continue;
        if (LAND_MASK[nz * GRID_SIZE + cx] === 0 || blocked.has(nz * GRID_SIZE + cx) || (checkEnter && !enter(from, { x: cx, z: nz }))) continue;
      }
      visitStamp[k] = stamp; gScore[k] = g; parentOf[k] = curKey;
      const hk = h(nx, nz);
      heapPush((g + hk) * 1024 + hk, seq++, k);
    }
  }
  return null;
}

/**
 * A walker's planned route, kept between ticks so a long walk is searched once,
 * not every tick. Reused only while the goal aims at the same tile and range,
 * the walker's passability (`ruleKey`, e.g. which area keys it holds) and the
 * world's blockers (`version`) are unchanged, the walker stands where the
 * route says, the next steps are still legal and the end still meets the goal.
 * The rest of a shortest route is a shortest route, so the walk is the same
 * length either way. Anything else searches afresh.
 */
export interface Route { aim: string; ruleKey: string; version: number; origin: Tile; path: Tile[] }
export type RouteCache = Map<string, Route>;

/** A Route's `aim` for a goal at `target` within `range` (goalIsTile: range 0). */
export function routeAim(target: Tile, range = 0): string {
  return `${target.x},${target.z},${range}`;
}

export function routePath(cache: RouteCache, id: string, start: Tile, isGoal: (t: Tile) => boolean, blocked: Set<number>,
  enter: EnterRule, ruleKey: string, version: number): Tile[] | null {
  const aimInfo = (isGoal as AimedGoal).aim;
  if (!aimInfo) { cache.delete(id); return bfsPath(start, isGoal, blocked, enter); }
  const aim = routeAim(aimInfo.target, aimInfo.range);
  const r = cache.get(id);
  if (r && r.aim === aim && r.ruleKey === ruleKey && r.version === version && r.path.length) {
    let i = -1;
    if (tileEquals(start, r.origin)) i = 0;
    else for (let j = 0; j < Math.min(4, r.path.length); j++) if (tileEquals(start, r.path[j])) { i = j + 1; break; }
    if (i >= 0) {
      const rest = r.path.slice(i);
      let ok = rest.length > 0 && isGoal(rest[rest.length - 1]);
      let prev = start;
      for (let k = 0; ok && k < Math.min(2, rest.length); k++) {
        ok = canStep(prev, rest[k].x - prev.x, rest[k].z - prev.z, blocked, enter) !== null;
        prev = rest[k];
      }
      if (ok) { cache.set(id, { ...r, origin: { x: start.x, z: start.z }, path: rest }); return rest; }
    }
  }
  const path = bfsPath(start, isGoal, blocked, enter);
  if (path && path.length) cache.set(id, { aim, ruleKey, version, origin: { x: start.x, z: start.z }, path });
  else cache.delete(id);
  return path;
}

/** A cheap fingerprint of a blocked set, so a route cache notices when the world's obstacles change. */
export function blockedVersion(blocked: Set<number>): number {
  let h = blocked.size;
  for (const k of blocked) h = (h + Math.imul(k, 2654435761)) | 0;
  return h;
}

/** First tile of the BFS path, or null when already there / unreachable. */
export function bfsNextStep(start: Tile, isGoal: (t: Tile) => boolean, blocked: Set<number>, enter: EnterRule = allowAll): Tile | null {
  const path = bfsPath(start, isGoal, blocked, enter);
  if (!path || path.length === 0) return null;
  return path[0];
}

export function goalIsTile(target: Tile): (t: Tile) => boolean {
  return aimed((t) => tileEquals(t, target), target, 0);
}

/** Goal: any unblocked tile within melee range of `target` (including target itself if unblocked). */
export function goalAdjacentTo(target: Tile, blocked: Set<number>, range = 1): (t: Tile) => boolean {
  return aimed((t) => chebyshev(t, target) <= range && !blocked.has(tileKey(t)), target, range);
}

/**
 * `goal` if reachable, else the reachable tile with the smallest Chebyshev
 * distance to `goal` (ties broken by BFS order, i.e. closest to start).
 */
/**
 * `goal` if it can be reached, else the reachable tile nearest to it. `onPath`
 * gets the route to `goal` when there is one (the server keeps it for the
 * tick's walk, lib/routes.ts).
 */
export function nearestReachableTile(start: Tile, goal: Tile, blocked: Set<number>, enter: EnterRule = allowAll, onPath?: (path: Tile[]) => void): Tile {
  if (!blocked.has(tileKey(goal))) {
    const path = bfsPath(start, goalIsTile(goal), blocked, enter);
    if (path) { onPath?.(path); return goal; }
  }
  const seen = new Set<number>([tileKey(start)]);
  const queue: Tile[] = [start];
  let head = 0;
  let best = start;
  let bestD = chebyshev(start, goal);
  while (head < queue.length) {
    const cur = queue[head++];
    for (const [dx, dz] of DELTAS) {
      const next = canStep(cur, dx, dz, blocked, enter);
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

/** Every tile reachable from `start` (inclusive), for tests and tools. `within` limits the flood. */
export function reachableTiles(start: Tile, blocked: Set<number>, enter: EnterRule = allowAll, within: (t: Tile) => boolean = () => true): Set<number> {
  const seen = new Set<number>([tileKey(start)]);
  const queue: Tile[] = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const [dx, dz] of DELTAS) {
      const next = canStep(cur, dx, dz, blocked, enter);
      if (!next || !within(next)) continue;
      const k = tileKey(next);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return seen;
}
