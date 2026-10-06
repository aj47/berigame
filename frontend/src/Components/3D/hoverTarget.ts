import type { Object3D, Vector3 } from 'three';
import {
  areaOf, canonicalMiddle, chebyshev, CLATTER_SWARM_TICKS, ClatterState, clatterHitsMove, clatterSwarmFreeLines, clatterSwarmHit,
  clatterTelegraph, enterRule, inBounds, inClatterGlade, inSpireFloor, nearestReachableTile, tileEquals, tileKey, TILE_ORIGIN,
  CLATTER_DAMAGE, type ClatterRowLike, type Tile,
} from '@sim';
import { HOME_JOIN, homeLand, homeLocation, homePath, homePoint } from '../../../../shared/sim/frontier/homeMap';
import { PIECES } from '../../../../shared/sim/frontier/catalog';
import { can } from '../../../../shared/sim/frontier/model';
import { buildingBlocker, buildingCollisionKeys } from '../../../../shared/sim/frontier/building';
import type { Location } from '../../../../shared/sim/frontier/catalog';
import type { FrontierSnapshot } from '../../../../shared/sim/frontier/snapshot';
import { isOpenGround } from '../../bosses/selectors';

export interface HoverHint {
  title: string;
  action: string;
  detail?: string;
  tone?: 'ready' | 'muted';
  radius?: number;
  tile?: Tile;
  /** Stable identity for choosing between avatars under the same pointer. */
  playerHex?: string;
  /** Panels and immediate actions consume a click without changing clickedOtherObject. */
  click?: 'panel' | 'action';
}

export type HoverTarget = HoverHint | ((point: Vector3) => HoverHint | null) | null;

/** Drei's labels make the canvas pointer-transparent; R3F receives events on its wrapper. */
export function isWorldSurface(target: EventTarget | null, canvas: HTMLCanvasElement, connected?: EventTarget): boolean {
  return !!target && (target === canvas || target === canvas.parentElement || target === connected);
}

/** Read metadata only. Hover must never invoke an interaction handler. */
export function hoverTargetOf(object: Object3D | null, point: Vector3): { root: Object3D; hint: HoverHint } | null | undefined {
  for (let root = object; root; root = root.parent) {
    if (!Object.prototype.hasOwnProperty.call(root.userData, 'hoverTarget')) continue;
    const target = root.userData.hoverTarget as HoverTarget;
    const hint = typeof target === 'function' ? target(point) : target;
    return hint ? { root, hint } : null;
  }
  return undefined;
}

export function hoverRoots(scene: Object3D): Object3D[] {
  const roots: Object3D[] = [];
  scene.traverse(o => { if (o.userData.hoverTarget) roots.push(o); });
  return roots;
}

/** Unlike worldToTile, preserve out-of-bounds ocean instead of clamping it to shore. */
export function hoverTile(x: number, z: number): Tile {
  return { x: Math.round(x + TILE_ORIGIN), z: Math.round(z + TILE_ORIGIN) };
}

/** The hint for a tile across the Spire floor boundary (or the sea). */
function unreachable(tile: Tile, meOnFloor: boolean): HoverHint {
  return meOnFloor
    ? { title: 'Out of the arena', action: 'Choose a spot on the floor', tone: 'muted', tile }
    : { title: 'Water', action: 'Choose a spot on land', tone: 'muted', tile };
}

export function groundHover(tile: Tile, me: Tile, blocked: Set<number>, hasStick: boolean, hasClub: boolean): HoverHint {
  // From the overworld the Spire floor reads as water; from inside, the overworld is out of reach.
  const meOnFloor = inSpireFloor(me);
  if (!inBounds(tile) || !isOpenGround(tile, meOnFloor)) return unreachable(tile, meOnFloor);
  const destination = nearestReachableTile(me, tile, blocked, enterRule(hasStick, hasClub));
  const fromArea = areaOf(me), toArea = areaOf(tile);
  if (!hasStick && fromArea === 'grove' && toArea !== 'grove') {
    return { title: 'Thorny brambles', action: 'Click to walk to the edge', detail: 'Carry a sturdy stick to cross', tone: 'muted', tile: destination };
  }
  if (!hasClub && fromArea !== 'boulders' && (toArea === 'boulders' || toArea === 'boulder-line')) {
    return { title: 'Boulder boundary', action: 'Click to walk to the edge', detail: 'Carry a stone club to cross', tone: 'muted', tile: destination };
  }
  return tileEquals(destination, tile)
    ? { title: 'Walk here', action: 'Click to move', tile: destination }
    : { title: 'Walk nearby', action: 'Click to move to the highlighted spot', detail: 'The way to that spot is blocked', tone: 'muted', tile: destination };
}

/** Match the server's building and gate rules in Meadows; coordinates remain local. */
export function meadowBlockedTiles(state: Pick<FrontierSnapshot, 'buildings' | 'plots'>, me: Tile & { region?: string }, identity: string, region = 'settlement'): Set<string> {
  const claims = new Map(state.plots.filter(p => p.claim).map(p => [p.id, p]));
  return buildingCollisionKeys(state.buildings, b => {
    if (b.region !== region) return false;
    if (PIECES[b.piece]?.solid) return true;
    if (b.piece !== 'door' && b.piece !== 'gate') return false;
    const plot = claims.get(b.claim), claim = plot?.claim;
    if (!plot || !claim) return false;
    const inside = me.region === region && me.x >= plot.x && me.x < plot.x + 16 && me.z >= plot.z && me.z < plot.z + 16;
    return !inside && !can(claim, identity, 1) && !can(claim, identity, 2);
  });
}

/** A pointer is in the shared home frame even while the player row uses district-local coordinates. */
export function connectedGroundHover(tile: Tile, me: Tile & { region?: string }, blocked: Set<number>, meadowBlocked: Set<string>, hasStick: boolean, hasClub: boolean): HoverHint {
  const region = me.region || 'bramblewild', target = homeLocation(tile);
  if (region === 'bramblewild' && target.region === 'bramblewild') return groundHover(tile, me, blocked, hasStick, hasClub);
  if (region === 'bramblewild' && inSpireFloor(me)) return unreachable(tile, true);
  if (!homeLand(tile) || (target.region === 'bramblewild' && inSpireFloor(target))) return { title: 'Water', action: 'Choose a spot on land', tone: 'muted', tile };
  const rule = enterRule(hasStick, hasClub);
  const meadow = buildingBlocker(meadowBlocked);
  const obstacles = Object.assign((p: Location) => p.region === 'bramblewild' ? blocked.has(tileKey(p)) : meadow(p), {
    crosses: (a: Location, b: Location) => a.region === 'settlement' && b.region === 'settlement' && meadow.crosses(a, b),
  });
  const path = homePath(homePoint(me, region), tile,
    obstacles,
    (a, b) => b.region !== 'bramblewild' || rule(a.region === 'bramblewild' ? a : HOME_JOIN.bramblewild, b));
  if (path) return { title: 'Walk here', action: 'Click to move', tile };
  const boundaryCouldMatter = (!hasStick && region === 'bramblewild' && areaOf(me) === 'grove')
    || (!hasClub && target.region === 'bramblewild' && ['boulders', 'boulder-line'].includes(areaOf(target)));
  const withoutBoundaries = boundaryCouldMatter && homePath(homePoint(me, region), tile, obstacles);
  if (withoutBoundaries && !hasStick && region === 'bramblewild' && areaOf(me) === 'grove') {
    return { title: 'Thorny brambles', action: 'Carry a sturdy stick to cross', tone: 'muted', tile };
  }
  if (withoutBoundaries && !hasClub && target.region === 'bramblewild' && ['boulders', 'boulder-line'].includes(areaOf(target))) {
    return { title: 'Boulder boundary', action: 'Carry a stone club to cross', tone: 'muted', tile };
  }
  return { title: 'Path blocked', action: 'Choose a clear spot', detail: 'A building or obstacle blocks this route', tone: 'muted', tile };
}

/** Clatterhorn dodge-assist verdict for a hovered tile: green (`safe`) or red (`hit`, with the damage you would take). */
export interface ClatterHoverVerdict { tile: Tile; kind: 'safe' | 'hit'; damage: number }

/** Ticks of runners checked after the swarm fires (they cross the 17-tile glade in about 20). */
const SWARM_LOOKAHEAD = CLATTER_SWARM_TICKS + 4;

/**
 * Dodge assist at Clatterhorn (mirrors the Spire's exact-move hover): while a charge, spin or drum is telegraphed or
 * the swarm runs, and you stand in the glade, a walkable tile within Chebyshev 2 of your true tile is judged as the
 * move you would make in tick + 1 (with its canonical middle, as the server tests it) and then standing there until
 * the hazard is over, all through `clatterHitsMove`. Null when there is nothing to judge.
 */
export function clatterHoverVerdict(row: ClatterRowLike | null | undefined, tick: number, me: Tile, tile: Tile, blocked: Set<number>): ClatterHoverVerdict | null {
  if (!row || row.state === ClatterState.Closed || !inClatterGlade(me)) return null;
  const tel = clatterTelegraph(row);
  const swarm = clatterSwarmFreeLines(row).length > 0;
  if (!tel && !swarm) return null;
  if (!inBounds(tile) || chebyshev(me, tile) > 2 || !isOpenGround(tile, false) || blocked.has(tileKey(tile))) return null;
  const windup = row.state === ClatterState.ChargeWindup || row.state === ClatterState.SpinWindup;
  const blowTiles = windup && tel ? new Set(tel.tiles) : null;
  const until = Math.max(windup ? row.stateUntilTick - tick : 0, swarm ? Math.max(0, row.stateUntilTick - tick) + SWARM_LOOKAHEAD : 0, 1);
  const mid = canonicalMiddle(me, tile, blocked);
  let damage = 0;
  for (let k = 1; k <= until; k++) {
    const T = tick + k;
    const [p0, p1] = k === 1 ? [me, mid] : [tile, tile];
    if (!clatterHitsMove(row, T, p0, p1, tile)) continue;
    if (blowTiles && T === row.stateUntilTick && blowTiles.has(tileKey(tile))) damage += tel!.damage;
    if (clatterSwarmHit(row, T, p0, p1, tile)) damage += CLATTER_DAMAGE.runner;
  }
  return { tile, kind: damage > 0 ? 'hit' : 'safe', damage };
}
