import { useCallback } from 'react';
import { inSpireFloor } from '@sim';
import { MEADOW_OFFSET, isHomeRegion } from '../../../../shared/sim/frontier/homeMap';
import { useMyPlayerSelector } from '../../spacetime/hooks';

/**
 * How close (Chebyshev, tiles) you must be to Meadows before the embedded
 * district mounts in the home scene. The harbour road is around tile x = 64;
 * 80 keeps the Grove, Boulders and Spire from paying for Meadows draw calls,
 * raycasts and useFrame loops, while the harbour road still sees the seam.
 */
export const MEADOW_SCENE_RANGE = 80;

export interface HomePresence {
  region: string;
  x: number;
  z: number;
}

/** The overworld Canvas (Bramblewild plus the joined Meadows), not a far district. */
export function isHomeScene(region: string | undefined, frontierEnabled: boolean): boolean {
  return !region || region === 'bramblewild' || (frontierEnabled && region === 'settlement');
}

/** A far district (Reedwake, the sea, \ldots) uses its own Canvas. */
export function isAwayDistrict(region: string | undefined): boolean {
  return !!region && region !== 'bramblewild';
}

/** On the Spire floor: position-based, so it flips on the teleport row. */
export function isOnSpireFloor(me: HomePresence | null | undefined): boolean {
  return !!me && (me.region || 'bramblewild') === 'bramblewild' && inSpireFloor(me);
}

/**
 * Mount Meadows only when you are in it, drafting on it, or close enough that
 * the camera can see the seam. Same rule as the Spire: an unmounted scene
 * cannot raycast or run useFrame.
 */
export function shouldMountMeadows(me: HomePresence | null | undefined, frontierEnabled: boolean, drafting = false): boolean {
  if (!frontierEnabled || !me) return false;
  const region = me.region || 'bramblewild';
  if (!isHomeRegion(region)) return false;
  if (region === 'settlement' || drafting) return true;
  return Math.abs(me.x - MEADOW_OFFSET.x) <= MEADOW_SCENE_RANGE;
}

/** Pack region + tile so a selector can Object.is the presence used to mount scenes. */
let interned: HomePresence | null = null;

/** Stable object while your region and tile stay put, so a selector can Object.is it. */
export function internHomePresence(me: { region?: string; x: number; z: number } | null | undefined): HomePresence | null {
  if (!me) { interned = null; return null; }
  const region = me.region || 'bramblewild';
  if (interned && interned.region === region && interned.x === me.x && interned.z === me.z) return interned;
  interned = { region, x: me.x, z: me.z };
  return interned;
}

const selectRegion = (me: { region?: string } | null) => me?.region || 'bramblewild';
const selectOnFloor = (me: { region?: string; x: number; z: number } | null) => isOnSpireFloor(internHomePresence(me));
const selectPresent = (me: unknown) => !!me;

export function useMyRegion(): string {
  return useMyPlayerSelector(selectRegion);
}

export function useOnSpireFloor(): boolean {
  return useMyPlayerSelector(selectOnFloor);
}

export function useHasPlayer(): boolean {
  return useMyPlayerSelector(selectPresent);
}

/** True while Meadows should be in the home scene. Stable until you cross the seam range. */
export function useMeadowsMounted(frontierEnabled: boolean, drafting: boolean): boolean {
  return useMyPlayerSelector(useCallback((me) => shouldMountMeadows(internHomePresence(me), frontierEnabled, drafting), [frontierEnabled, drafting]));
}
