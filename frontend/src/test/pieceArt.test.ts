import { describe, expect, it } from 'vitest';
import type { BufferAttribute } from 'three';
import { PIECES } from '../../../shared/sim/frontier/catalog';
import { hasPieceArt, pieceGeometry, ROOF_BASE, roofGeometry, WALL_HEIGHT } from '../frontier/pieceArt';

const heights = (tiles: { x: number; z: number }[]) => {
  const p = roofGeometry(tiles).getAttribute('position') as BufferAttribute;
  const ys: number[] = [], xs: number[] = [];
  for (let i = 0; i < p.count; i++) { ys.push(p.getY(i)); xs.push(p.getX(i)); }
  return { top: Math.max(...ys), eave: Math.min(...ys), minX: Math.min(...xs), maxX: Math.max(...xs) };
};

describe('settlement building art', () => {
  it('draws every catalog piece with its own art', () => {
    for (const piece of Object.keys(PIECES)) {
      expect(hasPieceArt(piece), piece).toBe(true);
      if (piece !== 'roof') expect(pieceGeometry(piece).body?.getAttribute('position').count, piece).toBeGreaterThan(0);
    }
  });

  it('gives a door opening taller than an avatar and seats the roof on the wall plates', () => {
    expect(WALL_HEIGHT).toBeGreaterThanOrEqual(2.6);
    expect(ROOF_BASE).toBeGreaterThan(WALL_HEIGHT);
    const wall = pieceGeometry('wall').body!;
    wall.computeBoundingBox();
    expect(wall.boundingBox!.max.y).toBeCloseTo(WALL_HEIGHT, 2);
  });

  it('joins neighbouring roof tiles into one hipped roof with overhanging eaves', () => {
    const single = heights([{ x: 0, z: 0 }]);
    const house = heights([0, 1, 2, 3].flatMap(x => [0, 1, 2].map(z => ({ x, z }))));
    expect(single.top).toBeCloseTo(ROOF_BASE + .5, 5);
    // A three-wide house rises to a ridge 1.5 tiles above the eaves line.
    expect(house.top).toBeCloseTo(ROOF_BASE + 1.5, 5);
    expect(house.eave).toBeLessThan(ROOF_BASE);
    expect(house.minX).toBeLessThan(-.5);
    expect(house.maxX).toBeGreaterThan(3.5);
    // Very wide halls flatten instead of growing a towering spire.
    const hall = heights(Array.from({ length: 100 }, (_, i) => ({ x: i % 10, z: Math.floor(i / 10) })));
    expect(hall.top).toBeLessThanOrEqual(ROOF_BASE + 2.0001);
  });
});
