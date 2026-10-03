import { terrainLand } from "../terrain";
import { REGIONS, type Location, type Point, type RegionId } from "./catalog";
export const distance = (a: Point, b: Point) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
/** Continuous shore used by both the server's tile mask and the shared terrain renderer. */
export function meadowField(x: number, z: number): number {
  const coast=(1-Math.pow(Math.pow(Math.abs(x-64)/63,6)+Math.pow(Math.abs(z-64)/63,6),1/6))*63;
  const island=Math.min(coast, x-1.5, 125.5-x, z-1.5, 125.5-z);
  const headland=x<=12 ? 4.5 + Math.max(0,x)*.35 - Math.abs(z-64) : -Infinity;
  return Math.min(Math.max(island,headland),127.5-x,z+.5,127.5-z);
}
export function regionLand(region: RegionId, p: Point): boolean {
  const size = REGIONS[region]?.size;
  if (
    !size ||
    !Number.isInteger(p.x) ||
    !Number.isInteger(p.z) ||
    p.x < 0 ||
    p.z < 0 ||
    p.x >= size ||
    p.z >= size
  )
    return false;
  if (region === "bramblewild") return terrainLand(p);
  if (region === "sea") return p.x >= 3 && p.x < 125 && p.z >= 3 && p.z < 125;
  if (region === "settlement") return meadowField(p.x,p.z) >= 0;
  if (p.x < 2 || p.x >= 126 || p.z < 2 || p.z >= 126) return false;
  const coast =
    Math.pow(Math.abs(p.x - 64) / 63, 6) +
      Math.pow(Math.abs(p.z - 64) / 63, 6) <=
    1;
  const lake =
    region === "cinder" && ((p.x - 32) / 10) ** 2 + ((p.z - 94) / 7) ** 2 < 1;
  return coast && !lake;
}
export function sameRegion(a: { region?: string }, b: { region?: string }) {
  return (a.region || "bramblewild") === (b.region || "bramblewild");
}
/** Bounded A*: Chebyshev distance is admissible for eight-direction movement.
 * Prefer smaller remaining distances on ties so open water does not flood-fill.
 * Obstructions are checked per call, so construction cannot leave a stale route.
 */
export function regionalPath(
  region: RegionId,
  from: Point,
  to: Point,
  blocked: (p: Point) => boolean,
): Point[] | null {
  return gridPath(REGIONS[region].size, REGIONS[region].size, from, to,
    p => regionLand(region, p), blocked);
}
export function gridPath(
  width: number, height: number, from: Point, to: Point,
  land: (p: Point) => boolean, blocked: (p: Point) => boolean,
  canStep: (from: Point, to: Point) => boolean = () => true,
): Point[] | null {
  const inGrid = (p: Point) => Number.isInteger(p.x) && Number.isInteger(p.z) && p.x >= 0 && p.z >= 0 && p.x < width && p.z < height;
  if (!inGrid(from) || !inGrid(to) || !land(from) || !land(to) || blocked(to)) return null;
  const size = width, key = (p: Point) => p.z * size + p.x;
  const start = key(from),
    goal = key(to),
    parents = new Int32Array(width * height),
    costs = new Float64Array(width * height);
  parents.fill(-1);
  costs.fill(Infinity);
  costs[start] = 0;
  parents[start] = start;
  type Node = { key: number; cost: number; h: number; score: number };
  const heap: Node[] = [];
  const before = (a: Node, b: Node) =>
    a.score < b.score ||
    (a.score === b.score && (a.h < b.h || (a.h === b.h && a.key < b.key)));
  const push = (node: Node) => {
    let i = heap.length;
    heap.push(node);
    while (i) {
      const parent = (i - 1) >> 1;
      if (!before(node, heap[parent])) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = node;
  };
  const pop = () => {
    const first = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1;
        if (c + 1 < heap.length && before(heap[c + 1], heap[c])) c++;
        if (!before(heap[c], last)) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return first;
  };
  const pass = (p: Point) => inGrid(p) && land(p) && !blocked(p);
  push({
    key: start,
    cost: 0,
    h: distance(from, to),
    score: distance(from, to),
  });
  const dirs = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  while (heap.length) {
    const node = pop(),
      k = node.key;
    if (node.cost !== costs[k]) continue;
    if (k === goal) {
      const out: Point[] = [];
      for (let at = k; at !== start; at = parents[at])
        out.push({ x: at % size, z: Math.floor(at / size) });
      return out.reverse();
    }
    const p = { x: k % size, z: Math.floor(k / size) };
    for (const [dx, dz] of dirs) {
      const n = { x: p.x + dx, z: p.z + dz };
      if (!pass(n) || !canStep(p, n)) continue;
      if (
        dx &&
        dz &&
        (!pass({ x: p.x + dx, z: p.z }) || !pass({ x: p.x, z: p.z + dz }) ||
          !canStep(p, { x: p.x + dx, z: p.z }) ||
          !canStep(p, { x: p.x, z: p.z + dz }))
      )
        continue;
      const next = key(n),
        cost = node.cost + 1;
      if (cost >= costs[next]) continue;
      costs[next] = cost;
      parents[next] = k;
      const h = distance(n, to);
      push({ key: next, cost, h, score: cost + h });
    }
  }
  return null;
}
export function near(a: Location, b: Location, reach = 2) {
  return a.region === b.region && distance(a, b) <= reach;
}

/** Conservative 2-by-3 hull footprint; passengers never path independently. */
export function boatCanFloat(p: Point): boolean {
  for (const dx of [-1, 0])
    for (const dz of [-1, 0, 1])
      if (!regionLand("sea", { x: p.x + dx, z: p.z + dz })) return false;
  return true;
}
