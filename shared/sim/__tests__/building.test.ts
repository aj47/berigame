import { describe, expect, it } from 'vitest';
import { buildingBlocker, buildingBoundary, buildingCollisionKeys, buildingSideAt, buildingsOverlap } from '../frontier/building';
import { regionalPath } from '../frontier/regions';
import type { Building } from '../frontier/model';

const wall = (patch: Partial<Building> = {}): Building => ({ id: 'wall', claim: 'plot', region: 'settlement', piece: 'wall', x: 40, z: 40, rotation: 0, edge: true, label: '', ...patch });
describe('perimeter building placements', () => {
  it('gives every floor four sides and canonicalizes the shared boundary of adjacent floors', () => {
    expect(new Set([0, 1, 2, 3].map(rotation => buildingBoundary(wall({ rotation }))))).toHaveProperty('size', 4);
    expect(buildingBoundary(wall())).toBe(buildingBoundary(wall({ z: 41, rotation: 2 })));
    expect(buildingsOverlap(wall(), wall({ piece: 'door', z: 41, rotation: 2 }))).toBe(true);
    expect(buildingsOverlap(wall(), wall({ rotation: 1 }))).toBe(false);
    expect(buildingsOverlap(wall(), wall({ piece: 'chair', edge: false }))).toBe(false);
  });
  it('keeps floors walkable while blocking a wall crossing in both directions and across its corners', () => {
    const blocked = buildingBlocker(buildingCollisionKeys([wall()]));
    expect(blocked({ x: 40, z: 40 })).toBe(false);
    expect(blocked({ x: 40, z: 41 })).toBe(false);
    expect(blocked.crosses({ x: 40, z: 40 }, { x: 40, z: 41 })).toBe(true);
    expect(blocked.crosses({ x: 40, z: 41 }, { x: 40, z: 40 })).toBe(true);
    expect(blocked.crosses({ x: 40, z: 40 }, { x: 41, z: 41 })).toBe(true);
    expect(blocked.crosses({ x: 39, z: 40 }, { x: 40, z: 41 })).toBe(true);
    expect(blocked.crosses({ x: 40, z: 40 }, { x: 41, z: 40 })).toBe(false);
    const route = regionalPath('settlement', { x: 40, z: 40 }, { x: 40, z: 41 }, blocked)!;
    expect(route.length).toBeGreaterThan(1);
    expect(route.at(-1)).toEqual({ x: 40, z: 41 });
  });
  it('retains whole-cell blocking for legacy centered walls', () => {
    const blocked = buildingBlocker(buildingCollisionKeys([wall({ edge: undefined })]));
    expect(blocked({ x: 40, z: 40 })).toBe(true);
    expect(buildingsOverlap(wall({ edge: undefined }), wall({ piece: 'chair', edge: undefined }))).toBe(true);
  });
  it('opens permitted doors and blocks unauthorized doors on the same boundary', () => {
    const door = wall({ piece: 'door' });
    expect(buildingBlocker(buildingCollisionKeys([door])).crosses(door, { x: 40, z: 41 })).toBe(false);
    expect(buildingBlocker(buildingCollisionKeys([door], () => true)).crosses(door, { x: 40, z: 41 })).toBe(true);
  });
  it('snaps to the clicked side and retains the selected side for a centre click', () => {
    const tile = { x: 40, z: 40 };
    expect(buildingSideAt({ x: 40.4, z: 40.1 }, tile)).toBe(1);
    expect(buildingSideAt({ x: 39.6, z: 40.1 }, tile)).toBe(3);
    expect(buildingSideAt({ x: 40.1, z: 40.4 }, tile)).toBe(0);
    expect(buildingSideAt({ x: 40.1, z: 39.6 }, tile)).toBe(2);
    expect(buildingSideAt(tile, tile, 3)).toBe(3);
  });
});
