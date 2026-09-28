import { HEDGE_RING, RESPAWN_GRACE_TICKS, SAFE_RADIUS, SPAWN_TILE } from './constants';
import { chebyshev } from './grid';
import { PlayerState, type Slot, type Tile } from './types';

export type Area = 'grove' | 'hedge' | 'coast';

export const BRAMBLE_MESSAGE = 'Thorny brambles — you need a sturdy stick to push through';
export const BRAMBLE_KEY_ITEM = 'stick';

/** Chebyshev distance from the spawn tile. */
export function ringOf(t: Tile): number {
  return chebyshev(t, SPAWN_TILE);
}

export function isBramble(t: Tile): boolean {
  return ringOf(t) === HEDGE_RING;
}

export function areaOf(t: Tile): Area {
  const r = ringOf(t);
  return r < HEDGE_RING ? 'grove' : r === HEDGE_RING ? 'hedge' : 'coast';
}

/**
 * One-way brambles: a player may step onto a bramble tile only while holding a
 * stick, or when stepping in from the Coast. Stepping off one is always allowed.
 */
export function canEnter(from: Tile, to: Tile, hasStick: boolean): boolean {
  return !isBramble(to) || hasStick || ringOf(from) > HEDGE_RING;
}

/** The movement predicate for one player, for bfsPath / nearestReachableTile. */
export function enterRule(hasStick: boolean): (from: Tile, to: Tile) => boolean {
  return (from, to) => canEnter(from, to, hasStick);
}

/** Whether a player holds `itemId`, in the bag or wielded (a wielded weapon stays in the quick bar). */
export function holdsItem(slots: readonly Slot[], weapon: string, itemId: string): boolean {
  if (weapon === itemId) return true;
  return slots.some((s) => s?.itemId === itemId);
}

export function inSafeRing(t: Tile): boolean {
  return ringOf(t) <= SAFE_RADIUS;
}

interface GraceSubject { state: number; respawnTick: number }

/** Respawn grace, or first-spawn grace (which reuses respawnTick). */
export function inGrace(p: GraceSubject, tick: number): boolean {
  return p.state === PlayerState.Alive && tick < p.respawnTick + RESPAWN_GRACE_TICKS;
}

/** In first-spawn grace: respawnTick lies in the future while alive. Newcomers claim waited-on trees first. */
export function isNewcomer(p: GraceSubject, tick: number): boolean {
  return p.state === PlayerState.Alive && p.respawnTick > tick;
}

/** The Safe badge: the safe ring or any grace. */
export function isSafe(p: GraceSubject & Tile, tick: number): boolean {
  return inSafeRing(p) || inGrace(p, tick);
}

/** The Grove's four worn-path crossings through the hedge (N, E, S, W). */
export const HEDGE_CROSSINGS: readonly Tile[] = [
  { x: SPAWN_TILE.x, z: SPAWN_TILE.z - HEDGE_RING },
  { x: SPAWN_TILE.x + HEDGE_RING, z: SPAWN_TILE.z },
  { x: SPAWN_TILE.x, z: SPAWN_TILE.z + HEDGE_RING },
  { x: SPAWN_TILE.x - HEDGE_RING, z: SPAWN_TILE.z },
];

/** The first Coast tile straight past a crossing. */
export function coastPastCrossing(c: Tile): Tile {
  return {
    x: c.x + Math.sign(c.x - SPAWN_TILE.x),
    z: c.z + Math.sign(c.z - SPAWN_TILE.z),
  };
}

/** All bramble tiles, in row order. */
export function brambleTiles(): Tile[] {
  const out: Tile[] = [];
  const lo = SPAWN_TILE.x - HEDGE_RING;
  const hi = SPAWN_TILE.x + HEDGE_RING;
  for (let z = SPAWN_TILE.z - HEDGE_RING; z <= SPAWN_TILE.z + HEDGE_RING; z++) {
    for (let x = lo; x <= hi; x++) if (isBramble({ x, z })) out.push({ x, z });
  }
  return out;
}
