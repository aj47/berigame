import type { Tile } from './types';

/**
 * How a walk (a move target) ended, told to the walker as a SocialNotice.Walk
 * notice so "idle" never stands in for "arrived". The text is the record: the
 * server writes it and the agent gateway reads it back into state.player.lastWalk,
 * so no table changes.
 *
 * - arrived: the walker reached the tile (agents only: humans see themselves arrive).
 * - no_path: the tick found no path any more (a node grew on the route or the
 *   destination, a key was dropped): the walk stops where it is. Everyone.
 * - cancelled: another action cleared it (`by`, e.g. harvest, stop, attack,
 *   pickup). Agents only, and never for a new move or frontier walk (that is the
 *   new walk) nor for a disconnect (nobody is left to read it).
 *
 * `to` is the tile the server chose (nearest reachable), not the x,z asked for.
 */
export type WalkEnd = 'arrived' | 'no_path' | 'cancelled';
export interface WalkOutcome { to: Tile; ended: WalkEnd; at: Tile; by?: string; tick: number }

const xz = (t: Tile) => `${t.x},${t.z}`;

export function walkNotice(ended: WalkEnd, to: Tile, at: Tile, by = 'another action'): string {
  if (ended === 'arrived') return `Arrived at ${xz(to)}`;
  if (ended === 'no_path') return `Cannot reach ${xz(to)}: no path; stopped at ${xz(at)}`;
  return `Walk to ${xz(to)} cancelled by ${by}; stopped at ${xz(at)}`;
}

const tile = (x: string, z: string): Tile => ({ x: Number(x), z: Number(z) });

/** walkNotice's inverse; null for any other text. */
export function parseWalkNotice(text: string, tick: number): WalkOutcome | null {
  let m = /^Arrived at (-?\d+),(-?\d+)$/.exec(text);
  if (m) return { to: tile(m[1], m[2]), ended: 'arrived', at: tile(m[1], m[2]), tick };
  m = /^Cannot reach (-?\d+),(-?\d+): no path; stopped at (-?\d+),(-?\d+)$/.exec(text);
  if (m) return { to: tile(m[1], m[2]), ended: 'no_path', at: tile(m[3], m[4]), tick };
  m = /^Walk to (-?\d+),(-?\d+) cancelled by ([a-z_ ]{1,32}); stopped at (-?\d+),(-?\d+)$/.exec(text);
  if (m) return { to: tile(m[1], m[2]), ended: 'cancelled', at: tile(m[4], m[5]), by: m[3], tick };
  return null;
}
