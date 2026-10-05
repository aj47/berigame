import { describe, expect, it } from 'vitest';
import { homeMapLandmarkPositions, homeMapProjection } from '../frontier/homeMapArt';
import { drawMinimap, mapAccessLabel, minimapModel } from '../Components/minimapModel';
import { homePoint } from '../../../shared/sim/frontier/homeMap';
import { GRID_SIZE } from '@sim';

const empty = { meHex: null, players: [], trees: [], groundItems: [], tick: 0 };
describe('district maps', () => {
  it('keeps district positions aligned while enlarging the whole of Bramblewild', () => {
    const island = homeMapProjection(480, 'bramblewild'), overview = homeMapProjection(480);
    const a = island.x(GRID_SIZE) - island.x(0), b = overview.x(GRID_SIZE) - overview.x(0);
    expect(island.x(0)).toBeGreaterThanOrEqual(0);
    expect(island.x(GRID_SIZE)).toBeLessThanOrEqual(480);
    expect(a).toBeGreaterThan(420);
    expect(a / b).toBeGreaterThan(1.8);
    const meadows = homeMapProjection(480, 'settlement');
    for (const point of [homePoint({ x: 0, z: 0 }, 'settlement'), homePoint({ x: 127, z: 127 }, 'settlement')]) {
      expect(meadows.x(point.x)).toBeGreaterThanOrEqual(0);
      expect(meadows.x(point.x)).toBeLessThan(480);
      expect(meadows.z(point.z)).toBeGreaterThanOrEqual(0);
      expect(meadows.z(point.z)).toBeLessThan(480);
    }
  });
  it('separates nearby destination numbers even on a narrow phone', () => {
    const positions = homeMapLandmarkPositions(260);
    positions.forEach((p, i) => positions.slice(i + 1).forEach(other => {
      expect(Math.hypot(p.x - other.x, p.z - other.z)).toBeGreaterThanOrEqual(20);
    }));
  });
  it('marks home resources with shared coordinates and live regrowth state', () => {
    const model = minimapModel({ ...empty, home: { claims: [] }, nowMs: 1000, resources: [
      { region: 'settlement', x: 33, z: 52, item: 'timber', regrowsAt: 2000 },
      { region: 'settlement', x: 33, z: 56, item: 'stone' },
      { region: 'reedwake', x: 113, z: 54, item: 'timber' },
    ] });
    expect(model.resources).toEqual([
      { ...homePoint({ x: 33, z: 52 }, 'settlement'), item: 'timber', color: '#96704c', ready: false },
      { ...homePoint({ x: 33, z: 56 }, 'settlement'), item: 'stone', color: '#8b929a', ready: true },
    ]);
  });
  it('paints readable landmark numbers in the Bramblewild district', () => {
    const labels: string[] = [];
    const ctx = new Proxy({}, {
      get: (_target, name) => name === 'createLinearGradient' ? () => ({ addColorStop() {} }) : name === 'fillText' ? (s: string) => labels.push(s) : () => {},
      set: () => true,
    }) as CanvasRenderingContext2D;
    drawMinimap(ctx, minimapModel({ ...empty, home: { claims: [] } }), 480, 'bramblewild');
    for (let n = 1; n <= 10; n++) expect(labels).toContain(String(n));
  });
});

describe('map access guidance', () => {
  it('updates coast destinations when the carried stick unlocks them', () => {
    expect(mapAccessLabel('coast', { stick: false, club: false }, 'grove')).toBe('Stick required');
    expect(mapAccessLabel('coast', { stick: true, club: false }, 'grove')).toBe('Accessible · walk here');
    expect(mapAccessLabel('coast', { stick: false, club: false }, 'settlement')).toBe('Accessible · walk here');
  });
  it('does not call the boulders accessible without their route keys', () => {
    expect(mapAccessLabel('boulders', { stick: true, club: false }, 'grove')).toBe('Stone club required');
    expect(mapAccessLabel('boulders', { stick: false, club: true }, 'grove')).toBe('Stick + stone club required');
    expect(mapAccessLabel('boulders', { stick: true, club: true }, 'grove')).toBe('Accessible · walk here');
  });
});
