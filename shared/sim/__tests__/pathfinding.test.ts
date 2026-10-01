import { describe, expect, it } from 'vitest';
import { blockedSetFromTiles, chebyshev, tileKey } from '../grid';
import { bfsNextStep, bfsPath, goalAdjacentTo, goalIsTile, nearestReachableTile } from '../pathfinding';

const none = new Set<number>();

describe('pathfinding', () => {
  it('walks a straight diagonal line on an empty grid', () => {
    const path = bfsPath({ x: 24, z: 24 }, goalIsTile({ x: 28, z: 28 }), none)!;
    expect(path).toHaveLength(4);
    expect(path[3]).toEqual({ x: 28, z: 28 });
  });

  it('path length equals chebyshev distance on an empty grid', () => {
    const path = bfsPath({ x: 22, z: 32 }, goalIsTile({ x: 35, z: 23 }), none)!;
    expect(path).toHaveLength(chebyshev({ x: 22, z: 32 }, { x: 35, z: 23 }));
  });

  it('returns [] when already at the goal and null when unreachable', () => {
    expect(bfsPath({ x: 26, z: 26 }, goalIsTile({ x: 26, z: 26 }), none)).toEqual([]);
    const walls = blockedSetFromTiles([
      { x: 32, z: 32 }, { x: 33, z: 32 }, { x: 34, z: 32 },
      { x: 32, z: 33 }, { x: 34, z: 33 },
      { x: 32, z: 34 }, { x: 33, z: 34 }, { x: 34, z: 34 },
    ]);
    expect(bfsPath({ x: 24, z: 24 }, goalIsTile({ x: 33, z: 33 }), walls)).toBeNull();
    expect(bfsNextStep({ x: 26, z: 26 }, goalIsTile({ x: 26, z: 26 }), none)).toBeNull();
  });

  it('routes around a tree without cutting its corners', () => {
    const tree = { x: 33, z: 33 };
    const blocked = blockedSetFromTiles([tree]);
    const path = bfsPath({ x: 32, z: 32 }, goalIsTile({ x: 34, z: 34 }), blocked)!;
    expect(path.some((t) => tileKey(t) === tileKey(tree))).toBe(false);
    // Direct diagonal 32,32 -> 33,33 -> 34,34 is blocked and corners cannot be cut; must take 4 steps.
    expect(path).toHaveLength(4);
    for (let i = 0; i < path.length; i++) {
      const prev = i === 0 ? { x: 32, z: 32 } : path[i - 1];
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
    const path = bfsPath({ x: 24, z: 20 }, goalAdjacentTo(tree, blocked), blocked)!;
    expect(path).toHaveLength(3);
    expect(chebyshev(path[path.length - 1], tree)).toBe(1);
    expect(bfsPath({ x: 19, z: 19 }, goalAdjacentTo(tree, blocked), blocked)).toEqual([]);
  });

  it('nearestReachableTile picks the goal when free, else the closest free tile', () => {
    const tree = { x: 20, z: 20 };
    const blocked = blockedSetFromTiles([tree]);
    expect(nearestReachableTile({ x: 24, z: 24 }, { x: 27, z: 23 }, blocked)).toEqual({ x: 27, z: 23 });
    const near = nearestReachableTile({ x: 23, z: 20 }, tree, blocked);
    expect(chebyshev(near, tree)).toBe(1);
    expect(near).toEqual({ x: 21, z: 20 });
  });
});
