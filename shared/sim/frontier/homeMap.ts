import { GRID_SIZE } from '../constants';
import type { Location, Point, RegionId } from './catalog';
import { gridPath, regionLand, type PathBlocker } from './regions';

/** Meadows lie east of Eastreach, along the harbour road. Saved parcel coordinates stay local. */
export const MEADOW_OFFSET = { x: GRID_SIZE, z: -39 } as const;
export const HOME_JOIN = { bramblewild: { x: GRID_SIZE - 1, z: 25 }, settlement: { x: 0, z: 64 } } as const;
const MEADOW_SIZE = 128;
/** The joined districts in Bramblewild's frame, with northing shifted so the Meadows' top row is zero. */
export const HOME_GRID = { width: MEADOW_OFFSET.x + MEADOW_SIZE, height: Math.max(MEADOW_SIZE, GRID_SIZE - MEADOW_OFFSET.z) } as const;
export const isHomeRegion = (region: string) => region === 'bramblewild' || region === 'settlement';
export function homePoint(p: Point, region: string): Point {
  return region === 'settlement' ? { x: p.x + MEADOW_OFFSET.x, z: p.z + MEADOW_OFFSET.z } : { x: p.x, z: p.z };
}
export function homeLocation(p: Point): Location {
  return p.x >= MEADOW_OFFSET.x
    ? { region: 'settlement', x: p.x - MEADOW_OFFSET.x, z: p.z - MEADOW_OFFSET.z }
    : { region: 'bramblewild', ...p };
}
/** A tagged target in the existing optional target columns avoids rewriting saved characters.
 * Ordinary movement and cancel clear those columns, so they also cancel a cross-district walk.
 */
const HOME_TARGET_TAG = 256;
export const isHomeTarget = (p?: Point) => !!p && p.x >= HOME_TARGET_TAG;
export const homeTarget = (p: Point): Point => ({ x: p.x + HOME_TARGET_TAG, z: p.z - MEADOW_OFFSET.z });
export const homeDestination = (p: Point): Point => ({ x: p.x - HOME_TARGET_TAG, z: p.z + MEADOW_OFFSET.z });
export function homeLand(p: Point): boolean {
  const local = homeLocation(p);
  return regionLand(local.region, local);
}
export function homePath(from: Point, to: Point, blocked: PathBlocker<Location> = () => false, canStep: (from: Location, to: Location) => boolean = () => true): Point[] | null {
  // Shift northing for the bounded search; exported coordinates stay in Bramblewild's frame.
  const shift = (p: Point) => ({ x: p.x, z: p.z - MEADOW_OFFSET.z });
  const unshift = (p: Point) => ({ x: p.x, z: p.z + MEADOW_OFFSET.z });
  const local = (p: Point) => homeLocation(unshift(p));
  const obstacles = Object.assign((p: Point) => blocked(local(p)), {
    crosses: (a: Point, b: Point) => blocked.crosses?.(local(a), local(b)) ?? false,
  });
  return gridPath(HOME_GRID.width, HOME_GRID.height, shift(from), shift(to),
    p => homeLand(unshift(p)), obstacles,
    (a, b) => canStep(local(a), local(b)))?.map(unshift) ?? null;
}
export const HOME_MAP = {
  name: 'Bramblewild', districts: ['bramblewild', 'settlement'] as RegionId[],
  meadowOffset: MEADOW_OFFSET, crossing: HOME_JOIN,
  travel: 'Walk along the east harbour trail. Use walk with id bramblewild or settlement and local x,z; enter and return now queue a walk.',
};
