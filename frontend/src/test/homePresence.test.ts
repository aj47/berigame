import { describe, expect, it } from 'vitest';
import { SPAWN_TILE } from '@sim';
import { MEADOW_OFFSET } from '../../../shared/sim/frontier/homeMap';
import { internHomePresence, isAwayDistrict, isHomeScene, MEADOW_SCENE_RANGE, shouldMountMeadows } from '../Components/3D/homePresence';

describe('home scene presence', () => {
  it('keeps Grove, Boulders and the Spire on the overworld canvas', () => {
    expect(isHomeScene('bramblewild', true)).toBe(true);
    expect(isHomeScene('settlement', true)).toBe(true);
    expect(isHomeScene('settlement', false)).toBe(false);
    expect(isAwayDistrict('reedwake')).toBe(true);
    expect(isAwayDistrict('bramblewild')).toBe(false);
  });

  it('mounts Meadows on the harbour road and in the district, not from the Grove', () => {
    expect(shouldMountMeadows({ region: 'bramblewild', ...SPAWN_TILE }, true)).toBe(false);
    expect(shouldMountMeadows({ region: 'bramblewild', x: MEADOW_OFFSET.x - MEADOW_SCENE_RANGE, z: 25 }, true)).toBe(true);
    expect(shouldMountMeadows({ region: 'bramblewild', x: MEADOW_OFFSET.x - MEADOW_SCENE_RANGE - 1, z: 25 }, true)).toBe(false);
    expect(shouldMountMeadows({ region: 'settlement', x: 31, z: 64 }, true)).toBe(true);
    expect(shouldMountMeadows({ region: 'bramblewild', ...SPAWN_TILE }, true, true)).toBe(true);
    expect(shouldMountMeadows({ region: 'bramblewild', ...SPAWN_TILE }, false)).toBe(false);
  });

  it('interns the same region and tile', () => {
    const first = internHomePresence({ region: 'bramblewild', x: 25, z: 25 });
    expect(internHomePresence({ region: 'bramblewild', x: 25, z: 25 })).toBe(first);
    expect(internHomePresence({ region: 'bramblewild', x: 26, z: 25 })).not.toBe(first);
  });
});
