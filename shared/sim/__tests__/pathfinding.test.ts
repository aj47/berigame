import { describe, expect, it } from 'vitest';
import { blockedSetFromTiles, chebyshev, tileKey } from '../grid';
import { bfsNextStep, bfsPath, goalAdjacentTo, goalIsTile, nearestReachableTile } from '../pathfinding';

const none = new Set<number>();

describe('pathfinding', () => {
  it('walks a straight diagonal line on an empty grid', () => {
    const path = bfsPath({ x: 0, z: 0 }, goalIsTile({ x: 4, z: 4 }), none)!;
    expect(path).toHaveLength(4);
    expect(path[3]).toEqual({ x: 4, z: 4 });
  });

  it('path length equals chebyshev distance on an empty grid', () => {
    const path = bfsPath({ x: 3, z: 40 }, goalIsTile({ x: 30, z: 12 }), none)!;
    expect(path).toHaveLength(chebyshev({ x: 3, z: 40 }, { x: 30, z: 12 }));
  });

  it('returns [] when already at the goal and null when unreachable', () => {
    expect(bfsPath({ x: 5, z: 5 }, goalIsTile({ x: 5, z: 5 }), none)).toEqual([]);
    const walls = blockedSetFromTiles([
      { x: 9, z: 9 }, { x: 10, z: 9 }, { x: 11, z: 9 },
      { x: 9, z: 10 }, { x: 11, z: 10 },
      { x: 9, z: 11 }, { x: 10, z: 11 }, { x: 11, z: 11 },
    ]);
    expect(bfsPath({ x: 0, z: 0 }, goalIsTile({ x: 10, z: 10 }), walls)).toBeNull();
    expect(bfsNextStep({ x: 5, z: 5 }, goalIsTile({ x: 5, z: 5 }), none)).toBeNull();
  });

  it('routes around a tree without cutting its corners', () => {
    const tree = { x: 10, z: 10 };
    const blocked = blockedSetFromTiles([tree]);
    const path = bfsPath({ x: 9, z: 9 }, goalIsTile({ x: 11, z: 11 }), blocked)!;
    expect(path.some((t) => tileKey(t) === tileKey(tree))).toBe(false);
    // Direct diagonal 9,9 -> 10,10 -> 11,11 is blocked and corners cannot be cut; must take 4 steps.
    expect(path).toHaveLength(4);
    for (let i = 0; i < path.length; i++) {
      const prev = i === 0 ? { x: 9, z: 9 } : path[i - 1];
      const dx = path[i].x - prev.x;
      const dz = path[i].z - prev.z;
      if (dx !== 0 && dz !== 0) {
        expect(blocked.has(tileKey({ x: prev.x + dx, z: prev.z }))).toBe(false);
        expect(blocked.has(tileKey({ x: prev.x, z: prev.z + dz }))).toBe(false);
      }
    }
  });

  it('adjacent goal stops next to a blocked tree', () => {
    const tree = { x: 20, z: 20 };
    const blocked = blockedSetFromTiles([tree]);
    const path = bfsPath({ x: 15, z: 20 }, goalAdjacentTo(tree, blocked), blocked)!;
    expect(path).toHaveLength(4);
    expect(chebyshev(path[path.length - 1], tree)).toBe(1);
    expect(bfsPath({ x: 19, z: 19 }, goalAdjacentTo(tree, blocked), blocked)).toEqual([]);
  });

  it('nearestReachableTile picks the goal when free, else the closest free tile', () => {
    const tree = { x: 20, z: 20 };
    const blocked = blockedSetFromTiles([tree]);
    expect(nearestReachableTile({ x: 0, z: 0 }, { x: 7, z: 3 }, blocked)).toEqual({ x: 7, z: 3 });
    const near = nearestReachableTile({ x: 10, z: 20 }, tree, blocked);
    expect(chebyshev(near, tree)).toBe(1);
    expect(near).toEqual({ x: 19, z: 20 });
  });
});
