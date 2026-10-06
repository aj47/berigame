import { afterEach, describe, expect, it } from 'vitest';
import { BULLET_LIFE_HALF_STEPS, BULLET_STRIDE, SPIRE_BOX, bulletTileAt, spirePatternBullets } from '@sim';
import { BULLET_CAPACITY, bulletCapacity, bulletPosition, bulletStyleOf } from '../bosses/BulletLayer';
import { bulletStats, setBulletCount } from '../bosses/bulletStats';

const BOX = { boxX0: SPIRE_BOX.x0, boxZ0: SPIRE_BOX.z0, boxX1: SPIRE_BOX.x1, boxZ1: SPIRE_BOX.z1 };
// glint (fans at q 2, knight-move directions) and petal_ring (q 1 and 2 rings): every rate and slope.
const bullets = [spirePatternBullets(1, 100, 9, 74, 68), spirePatternBullets(0, 100, 0, 77, 69)];

afterEach(() => { for (const s of ['shard', 'mote', 'runner'] as const) setBulletCount(s, 0); });

describe('BulletLayer positions (the collision timeline)', () => {
  it('equal the integer half-step tiles at integer half-steps', () => {
    const out = { x: 0, z: 0 }, tile = { x: 0, z: 0 };
    let checked = 0;
    for (const b of bullets) {
      for (let i = 0; i < b.length / BULLET_STRIDE; i++) {
        for (let h = 0; h <= BULLET_LIFE_HALF_STEPS; h++) {
          bulletTileAt(b, i, h, tile);
          const inBox = tile.x >= BOX.boxX0 && tile.x <= BOX.boxX1 && tile.z >= BOX.boxZ0 && tile.z <= BOX.boxZ1;
          expect(bulletPosition(b, i, h, BOX, out)).toBe(inBox);
          if (inBox) { expect(out).toEqual(tile); checked++; }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('interpolates linearly between consecutive half-step tiles, so knight moves stair-step', () => {
    const b = bullets[0], out = { x: 0, z: 0 }, a = { x: 0, z: 0 }, c = { x: 0, z: 0 };
    for (let i = 0; i < b.length / BULLET_STRIDE; i++) {
      bulletTileAt(b, i, 3, a); bulletTileAt(b, i, 4, c);
      expect(bulletPosition(b, i, 3.25, BOX, out)).toBe(true);
      expect(out.x).toBeCloseTo(a.x + (c.x - a.x) * 0.25);
      expect(out.z).toBeCloseTo(a.z + (c.z - a.z) * 0.25);
    }
  });

  it('hides a bullet before its fire tick and after 36 half-steps (18 ticks)', () => {
    const b = new Int32Array([100, 77, 62, 0, 2, 1]);
    const out = { x: 0, z: 0 };
    expect(bulletPosition(b, 0, -0.01, BOX, out)).toBe(false);
    expect(bulletPosition(b, 0, 0, BOX, out)).toBe(true);
    expect(bulletPosition(b, 0, 16, BOX, out)).toBe(true);
    expect(bulletPosition(b, 0, 36.01, BOX, out)).toBe(false);
    expect(bulletPosition(b, 0, 40, BOX, out)).toBe(false);
    // Outside the render box (a bullet that left the arena never returns).
    expect(bulletPosition(b, 0, 36, { ...BOX, boxZ1: 64 }, out)).toBe(false);
  });

  it('grows its instance capacity from 256 by doubling', () => {
    expect(BULLET_CAPACITY).toBe(256);
    expect(bulletCapacity(256, 100)).toBe(256);
    expect(bulletCapacity(256, 257)).toBe(512);
    expect(bulletCapacity(256, 1100)).toBe(2048);
  });

  it('draws q 2 as shards and q 1 as motes in the Spire, and runners for Clatterhorn', () => {
    expect(bulletStyleOf('spire', 2)).toBe('shard');
    expect(bulletStyleOf('spire', 1)).toBe('mote');
    expect(bulletStyleOf('runner', 1)).toBe('runner');
  });

  it('keeps a production-safe live count summed over styles', () => {
    setBulletCount('shard', 12);
    setBulletCount('mote', 30);
    expect(bulletStats.live).toBe(42);
    setBulletCount('runner', 5);
    setBulletCount('shard', 0);
    expect(bulletStats).toEqual({ live: 35, byStyle: { shard: 0, mote: 30, runner: 5 } });
  });
});
