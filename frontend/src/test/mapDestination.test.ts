import { describe, expect, it } from 'vitest';
import { LANDMARKS } from '@sim';
import { HOME_JOIN, homePoint } from '../../../shared/sim/frontier/homeMap';
import {
  homeMapLandmarkPositions, homeMapProjection, legacyMapProjection, mapDestinationAt, type HomeMapView,
} from '../frontier/homeMapArt';

describe('map destinations from CSS pixels', () => {
  it.each([120, 260, 480, 643.5])('matches terrain and marker positions at displayed size %s', size => {
    const cases = [
      { view: 'bramblewild', region: 'bramblewild', x: 35, z: 25 },
      { view: 'bramblewild', region: 'settlement', x: 0, z: 64 },
      { view: 'settlement', region: 'settlement', x: 31, z: 64 },
      { view: 'settlement', region: 'settlement', x: 110, z: 100 },
      { view: 'settlement', region: 'bramblewild', ...HOME_JOIN.bramblewild },
      { view: 'overview', region: 'bramblewild', x: 35, z: 25 },
      { view: 'overview', region: 'settlement', x: 110, z: 100 },
    ] as const;
    for (const { view, ...location } of cases) {
      const point = homePoint(location, location.region), projection = homeMapProjection(size, view);
      expect(mapDestinationAt(projection.x(point.x), projection.z(point.z), size, view)).toEqual(location);
    }
  });

  it('rounds to the painted tile on either side of the district crossing', () => {
    const size = 480, p = homeMapProjection(size, 'overview');
    const seam = HOME_JOIN.bramblewild.x;
    expect(mapDestinationAt(p.x(seam + .49), p.z(25), size)).toEqual({ region: 'bramblewild', x: seam, z: 25 });
    expect(mapDestinationAt(p.x(seam + .51), p.z(25), size)).toEqual({ region: 'settlement', x: 0, z: 64 });
  });

  it.each(['overview', 'bramblewild', 'settlement'] as HomeMapView[])('rejects water and blank margins in %s', view => {
    const size = 480, p = homeMapProjection(size, view);
    const water = view === 'settlement' ? homePoint({ x: 0, z: 0 }, 'settlement') : { x: 0, z: 0 };
    expect(mapDestinationAt(p.x(water.x), p.z(water.z), size, view)).toBeNull();
    expect(mapDestinationAt(0, 0, size, view)).toBeNull();
  });

  it.each([
    [-1, 100, 480], [100, -1, 480], [480, 100, 480], [100, 480, 480],
    [100, 100, 0], [100, 100, -1], [100, 100, Infinity], [100, 100, NaN],
    [Infinity, 100, 480], [100, NaN, 480],
  ])('rejects invalid or outside-canvas pointer (%s, %s) at size %s', (x, y, size) => {
    expect(mapDestinationAt(x, y, size)).toBeNull();
  });

  it('uses displayed CSS pixels without multiplying by backing-canvas DPR', () => {
    const size = 260, p = homeMapProjection(size, 'settlement');
    const point = homePoint({ x: 100, z: 100 }, 'settlement');
    // A 520px backing canvas displayed at 260px still uses the displayed frame.
    expect(mapDestinationAt(p.x(point.x), p.z(point.z), size, 'settlement')).toEqual({ region: 'settlement', x: 100, z: 100 });
  });

  it('targets the landmark anchor when its number circle is displaced', () => {
    const size = 260, p = homeMapProjection(size, 'bramblewild');
    const positions = homeMapLandmarkPositions(size);
    const index = positions.findIndex(point => point.x !== point.anchorX || point.z !== point.anchorZ);
    expect(index).toBeGreaterThanOrEqual(0);
    const circle = positions[index], landmark = LANDMARKS[index];
    const underneath = p.pointAt(circle.x, circle.z);
    expect({ x: Math.round(underneath.x), z: Math.round(underneath.z) }).not.toEqual({ x: landmark.x, z: landmark.z });
    for (const offset of [0, 8.9]) {
      expect(mapDestinationAt(circle.x + offset, circle.z, size, 'bramblewild')).toEqual({ region: 'bramblewild', x: landmark.x, z: landmark.z });
    }
  });

  it.each([120, 260, 480])('matches the original 64-tile rendering when the expansion is disabled at size %s', size => {
    const p = legacyMapProjection(size);
    for (const view of ['overview', 'bramblewild', 'settlement'] as const) {
      expect(mapDestinationAt(p.center(35), p.center(25), size, view, false)).toEqual({ region: 'bramblewild', x: 35, z: 25 });
      expect(mapDestinationAt(35.01 * p.scale, 25.99 * p.scale, size, view, false)).toEqual({ region: 'bramblewild', x: 35, z: 25 });
      expect(mapDestinationAt(p.center(63), p.center(25), size, view, false)).toEqual({ region: 'bramblewild', x: 63, z: 25 });
      expect(mapDestinationAt(p.center(0), p.center(0), size, view, false)).toBeNull();
    }
  });
});
