import { describe, expect, it } from 'vitest';
import {
  blockedSetFromTiles, chebyshev, facingFromDelta, facingToYaw, inBounds,
  knockbackTile, neighbors8, tileKey, tileToWorld, worldToTile,
} from '../grid';
import { GRID_SIZE, TILE_ORIGIN } from '../constants';

describe('grid', () => {
  it('round-trips tile <-> world', () => {
    for (const t of [{ x: 0, z: 0 }, { x: 25, z: 25 }, { x: 49, z: 12 }]) {
      const [wx, , wz] = tileToWorld(t);
      expect(worldToTile(wx, wz)).toEqual(t);
    }
    expect(tileToWorld({ x: 25, z: 25 })).toEqual([0, 0, 0]);
    expect(tileToWorld({ x: 40, z: 30 })).toEqual([15, 0, 5]);
  });

  it('clamps world positions into the grid', () => {
    expect(worldToTile(-100, 100)).toEqual({ x: 0, z: GRID_SIZE - 1 });
    expect(worldToTile(TILE_ORIGIN + 3, 0)).toEqual({ x: GRID_SIZE - 1, z: 25 });
  });

  it('rounds fractional world coords to the nearest tile', () => {
    expect(worldToTile(0.4, -0.4)).toEqual({ x: 25, z: 25 });
    expect(worldToTile(0.6, -0.6)).toEqual({ x: 26, z: 24 });
  });

  it('bounds, keys and chebyshev', () => {
    expect(inBounds({ x: -1, z: 0 })).toBe(false);
    expect(inBounds({ x: 49, z: 49 })).toBe(true);
    expect(tileKey({ x: 3, z: 2 })).toBe(2 * GRID_SIZE + 3);
    expect(chebyshev({ x: 0, z: 0 }, { x: 3, z: -2 })).toBe(3);
  });

  it('neighbors8 omits out-of-bounds tiles', () => {
    expect(neighbors8({ x: 0, z: 0 })).toHaveLength(3);
    expect(neighbors8({ x: 10, z: 10 })).toHaveLength(8);
  });

  it('facing covers all 8 directions and yaw points along them', () => {
    const seen = new Set<number>();
    for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      if (dx === 0 && dz === 0) continue;
      const f = facingFromDelta(dx * 3, dz * 7);
      seen.add(f);
      const yaw = facingToYaw(f);
      expect(Math.sign(Math.round(Math.sin(yaw) * 10))).toBe(dx);
      expect(Math.sign(Math.round(Math.cos(yaw) * 10))).toBe(dz);
    }
    expect(seen.size).toBe(8);
  });

  it('knockback pushes directly away, null when blocked or off-grid', () => {
    const none = new Set<number>();
    expect(knockbackTile({ x: 10, z: 10 }, { x: 9, z: 10 }, none)).toEqual({ x: 11, z: 10 });
    expect(knockbackTile({ x: 10, z: 10 }, { x: 11, z: 11 }, none)).toEqual({ x: 9, z: 9 });
    expect(knockbackTile({ x: 0, z: 5 }, { x: 1, z: 5 }, none)).toBeNull();
    const blocked = blockedSetFromTiles([{ x: 11, z: 10 }]);
    expect(knockbackTile({ x: 10, z: 10 }, { x: 9, z: 10 }, blocked)).toBeNull();
    expect(knockbackTile({ x: 10, z: 10 }, { x: 10, z: 10 }, none)).toBeNull();
  });
});
