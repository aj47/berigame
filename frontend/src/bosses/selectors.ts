import { inSpireFloor, isLandTile, spireSeesPlayer, SpireStage, type Tile } from '@sim';
import type { BossState, SpireRunRow } from './bossStore';

/** A player row as far as visibility goes. Players outside Bramblewild are not this rule's concern. */
export interface Visible extends Tile { identity: { toHexString(): string }; region?: string }

const home = (p: { region?: string }) => (p.region || 'bramblewild') === 'bramblewild';

/**
 * Whether `p` is drawn for the viewer `me` (avatars, chat bubbles, stacks,
 * combat FX): a thin wrapper over the shared `spireSeesPlayer`. Inside the
 * Spire you see only your own run; outside, nobody standing on the floor.
 * You always see yourself; with no `me` yet the viewer counts as outside.
 */
export function isPlayerVisible(p: Visible, me: Visible | null | undefined, myRunHexes: ReadonlySet<string>): boolean {
  if (!home(p)) return true;
  const hex = p.identity.toHexString();
  if (me && me.identity.toHexString() === hex) return true;
  const viewer: Tile = me && home(me) ? me : { x: -1, z: -1 };
  return spireSeesPlayer(viewer, p, myRunHexes.has(hex));
}

/**
 * A walkable tile on the viewer's side of the Spire floor boundary: from the
 * overworld the floor reads as water, from inside the overworld is unreachable.
 */
export function isOpenGround(tile: Tile, meOnFloor: boolean): boolean {
  return isLandTile(tile) && inSpireFloor(tile) === meOnFloor;
}

/** Whether you stand on the Spire floor (position-based: it flips on the teleport row). */
export function inSpire(me: (Tile & { region?: string }) | null | undefined): boolean {
  return !!me && home(me) && inSpireFloor(me);
}

/** Open lobbies, oldest first (quick join takes the newest). */
export function spireLobbies(s: Pick<BossState, 'runs'>): SpireRunRow[] {
  return [...s.runs.values()].filter((r) => r.stage === SpireStage.Lobby).sort((a, b) => a.createdTick - b.createdTick || (a.id < b.id ? -1 : 1));
}

/** Runs fighting right now. */
export function spireActiveRuns(s: Pick<BossState, 'runs'>): number {
  let n = 0;
  for (const r of s.runs.values()) if (r.stage === SpireStage.Active) n++;
  return n;
}
