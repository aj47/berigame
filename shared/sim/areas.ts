import { BOULDER_LINE, BOULDERS_MIN, HEDGE_RING, RESPAWN_GRACE_TICKS, SAFE_RADIUS, SPAWN_TILE } from './constants';
import { groveBoundary, insideGrove } from './terrain';
import { chebyshev, isLandTile } from './grid';
import { PlayerState, type Slot, type Tile } from './types';

export type Area = 'grove' | 'hedge' | 'coast' | 'boulder-line' | 'boulders' | 'sea';

export const BRAMBLE_MESSAGE = 'Thorny brambles — you need a sturdy stick to push through';
export const BRAMBLE_KEY_ITEM = 'stick';
export const BOULDER_MESSAGE = 'Huge boulders — you need a stone club to clamber over';
/** The key to the Boulders: a stone club, carried in the bag or wielded. */
export const BOULDER_KEY_ITEM = 'stone_club';

/** Chebyshev distance from the spawn tile. */
export function ringOf(t: Tile): number {
  return chebyshev(t, SPAWN_TILE);
}

export function isBramble(t: Tile): boolean {
  return groveBoundary(t);
}

/** The one-tile boulder line on the old south-east shoreline (max(x, z) = 50, both >= 36). */
export function isBoulderLine(t: Tile): boolean {
  return isLandTile(t) && t.z >= 32 && Math.max(t.x, t.z) === BOULDER_LINE;
}

/** The Boulders (M3): land past the boulder line. */
export function inBoulders(t: Tile): boolean {
  return isLandTile(t) && t.z >= 32 && Math.max(t.x, t.z) > BOULDER_LINE;
}

export function areaOf(t: Tile): Area {
  if (!isLandTile(t)) return 'sea';
  if (inBoulders(t)) return 'boulders';
  if (isBoulderLine(t)) return 'boulder-line';
  return isBramble(t) ? 'hedge' : insideGrove(t) ? 'grove' : 'coast';
}

/**
 * One-way keys, one rule for both barriers. A player may step onto a bramble
 * tile only while holding a stick or when stepping in from the Coast, and onto
 * the boulder line only while holding a stone club or when stepping in from the
 * Boulders. Stepping off either is always allowed; the sea is never enterable.
 */
export function canEnter(from: Tile, to: Tile, hasStick: boolean, hasClub = false): boolean {
  if (!isLandTile(to)) return false;
  if (isBramble(to)) return hasStick || !insideGrove(from);
  if (isBoulderLine(to)) return hasClub || inBoulders(from);
  return true;
}

/** The movement predicate for one player, for bfsPath / nearestReachableTile. */
export function enterRule(hasStick: boolean, hasClub = false): (from: Tile, to: Tile) => boolean {
  return (from, to) => canEnter(from, to, hasStick, hasClub);
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

/** Where the chip sends a club holder: straight past the Coast's south-east corner, onto the Boulders. */
export const BOULDERS_ENTRY: Tile = { x: BOULDER_LINE + 1, z: BOULDER_LINE + 1 };

/** All boulder-line tiles, in row order. */
export function boulderLineTiles(): Tile[] {
  const out: Tile[] = [];
  for (let z = BOULDERS_MIN; z <= BOULDER_LINE; z++) {
    for (let x = BOULDERS_MIN; x <= BOULDER_LINE; x++) if (isBoulderLine({ x, z })) out.push({ x, z });
  }
  return out;
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
