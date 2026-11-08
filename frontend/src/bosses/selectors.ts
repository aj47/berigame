import { inLanternFloor, inSpireFloor, isLandTile, spireSeesPlayer, SpireStage, type Tile } from '@sim';
import type { BossState, LanternRunRow, SpireRunRow } from './bossStore';

/** A player row as far as visibility goes. Players outside Bramblewild are not this rule's concern. */
export interface Visible extends Tile { identity: { toHexString(): string }; region?: string }

const home = (p: { region?: string }) => (p.region || 'bramblewild') === 'bramblewild';
const EMPTY: ReadonlySet<string> = new Set();

/** The sealed boss floors: the Sunken Spire and Lanternmaw's Drowned Hollow. */
export type SealedFloor = 'spire' | 'lantern';

/** Which sealed floor a Bramblewild tile is on, or null for the overworld. */
export function sealedFloorOf(t: Tile): SealedFloor | null {
  return inSpireFloor(t) ? 'spire' : inLanternFloor(t) ? 'lantern' : null;
}

/** The sealed floor you stand on (position-based: it flips on the teleport row), or null. */
export function myFloor(me: (Tile & { region?: string }) | null | undefined): SealedFloor | null {
  return me && home(me) ? sealedFloorOf(me) : null;
}

/**
 * Whether `p` is drawn for the viewer `me` (avatars, chat bubbles, stacks,
 * combat FX): a thin wrapper over the shared `spireSeesPlayer`, for both
 * sealed floors. Inside a floor you see only your own run (your Spire run on
 * the Spire, your Lanternmaw run in the Drowned Hollow); outside, nobody
 * standing on either floor. You always see yourself; with no `me` yet the
 * viewer counts as outside.
 */
export function isPlayerVisible(p: Visible, me: Visible | null | undefined, myRunHexes: ReadonlySet<string>, myLanternHexes: ReadonlySet<string> = EMPTY): boolean {
  if (!home(p)) return true;
  const hex = p.identity.toHexString();
  if (me && me.identity.toHexString() === hex) return true;
  const viewer: Tile = me && home(me) ? me : { x: -1, z: -1 };
  const sameRun = inLanternFloor(viewer) ? myLanternHexes.has(hex) : myRunHexes.has(hex);
  return spireSeesPlayer(viewer, p, sameRun);
}

/**
 * A walkable tile on the viewer's side of the sealed-floor boundaries: from the
 * overworld both floors read as water, from inside a floor everything else is
 * unreachable. `meOnFloor` is the floor you stand on (true = the Spire, false or
 * null = the overworld).
 */
export function isOpenGround(tile: Tile, meOnFloor: boolean | SealedFloor | null): boolean {
  const floor = meOnFloor === true ? 'spire' : meOnFloor === false ? null : meOnFloor;
  return isLandTile(tile) && sealedFloorOf(tile) === floor;
}

/** Whether you stand on the Spire floor (position-based: it flips on the teleport row). */
export function inSpire(me: (Tile & { region?: string }) | null | undefined): boolean {
  return !!me && home(me) && inSpireFloor(me);
}

/** Whether you stand on Lanternmaw's floor. */
export function inLantern(me: (Tile & { region?: string }) | null | undefined): boolean {
  return !!me && home(me) && inLanternFloor(me);
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

/** Open Lanternmaw lobbies, oldest first. */
export function lanternLobbies(s: Pick<BossState, 'lanternRuns'>): LanternRunRow[] {
  return [...s.lanternRuns.values()].filter((r) => r.stage === SpireStage.Lobby).sort((a, b) => a.createdTick - b.createdTick || (a.id < b.id ? -1 : 1));
}

/** Lanternmaw runs fighting right now. */
export function lanternActiveRuns(s: Pick<BossState, 'lanternRuns'>): number {
  let n = 0;
  for (const r of s.lanternRuns.values()) if (r.stage === SpireStage.Active) n++;
  return n;
}
