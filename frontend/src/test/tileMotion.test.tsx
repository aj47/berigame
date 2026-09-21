import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Group } from 'three';
import { useTileMotion } from '../hooks/useTileMotion';

const harness = vi.hoisted(() => ({ frame: () => {}, now: 0, trees: [] as { x: number; z: number }[] }));
vi.mock('@react-three/fiber', () => ({ useFrame: (frame: () => void) => { harness.frame = frame; } }));
vi.mock('../spacetime/hooks', () => ({ useTrees: () => harness.trees }));
vi.mock('../spacetime/tickClock', () => ({ tickClock: { period: 600 } }));

beforeEach(() => {
  harness.now = 0; harness.trees = [];
  vi.spyOn(performance, 'now').mockImplementation(() => harness.now);
});
afterEach(() => vi.restoreAllMocks());
function setup() {
  const group = new Group();
  const ref = { current: group };
  const hook = renderHook(({ x, z, facing }) => useTileMotion(x, z, facing, ref), {
    initialProps: { x: 25, z: 25, facing: 0 },
  });
  return { ...hook, group, frame: (at: number) => act(() => { harness.now = at; harness.frame(); }) };
}

describe('confirmed faster tile motion', () => {
  it('smoothly traverses a two-step diagonal without treating it as a teleport', () => {
    const h = setup();
    h.rerender({ x: 27, z: 27, facing: 7 });
    expect(h.group.position.toArray()).toEqual([0, 0, 0]);
    h.frame(150); expect(h.group.position.toArray()).toEqual([0.5, 0, 0.5]);
    h.frame(300); expect(h.group.position.toArray()).toEqual([1, 0, 1]);
    h.frame(600); expect(h.group.position.toArray()).toEqual([2, 0, 2]);
    expect(h.result.current.current.speed).toBeCloseTo(Math.SQRT2 / 0.3);
  });
  it('keeps animation and travel facing across the 600ms boundary and a late packet', () => {
    const h = setup();
    h.rerender({ x: 27, z: 25, facing: 2 }); // Deliberately opposite authoritative final facing.
    for (const at of [599, 600, 650, 710]) {
      h.frame(at);
      expect(h.result.current.current.moving).toBe(true);
      expect(h.result.current.current.yaw).toBeCloseTo(Math.PI / 2);
      expect(h.result.current.current.speed).toBeCloseTo(1 / 0.3);
    }
    h.rerender({ x: 29, z: 25, facing: 2 });
    h.frame(720);
    expect(h.result.current.current.moving).toBe(true);
    expect(h.group.position.x).toBeGreaterThan(2);
    expect(h.group.position.x).toBeLessThan(3);
    expect(h.result.current.current.yaw).toBeCloseTo(Math.PI / 2);
  });
  it('stops exactly at a short destination at the same speed, then releases the animation hold', () => {
    const h = setup(); h.rerender({ x: 26, z: 25, facing: 6 });
    h.frame(150); expect(h.group.position.x).toBe(0.5);
    h.frame(300); expect(h.group.position.x).toBe(1);
    h.frame(419); expect(h.result.current.current.moving).toBe(true);
    h.frame(420); expect(h.result.current.current.moving).toBe(false);
    expect(h.result.current.current.speed).toBe(0);
    h.frame(900); expect(h.group.position.x).toBe(1);
  });
  it('follows the legal corner instead of interpolating straight through a blocked neighbor', () => {
    harness.trees = [{ x: 26, z: 25 }];
    const h = setup(); h.rerender({ x: 26, z: 27, facing: 7 });
    h.frame(150); expect(h.group.position.toArray()).toEqual([0, 0, 0.5]);
    expect(h.result.current.current.yaw).toBe(0);
    h.frame(300); expect(h.group.position.toArray()).toEqual([0, 0, 1]);
    h.frame(450); expect(h.group.position.toArray()).toEqual([0.5, 0, 1.5]);
    h.frame(600); expect(h.group.position.toArray()).toEqual([1, 0, 2]);
  });
  it('keeps an unfinished corner when the next confirmed update arrives early', () => {
    harness.trees = [{ x: 26, z: 25 }];
    const h = setup(); h.rerender({ x: 26, z: 27, facing: 7 });
    h.frame(150);
    h.rerender({ x: 28, z: 27, facing: 6 });
    h.frame(300); expect(h.group.position.toArray()).toEqual([0, 0, 1]);
    h.frame(600); expect(h.group.position.toArray()).toEqual([1, 0, 2]);
    h.frame(1200); expect(h.group.position.toArray()).toEqual([3, 0, 2]);
  });
  it('snaps a long authoritative correction rather than running across the map', () => {
    const h = setup(); h.rerender({ x: 40, z: 40, facing: 7 });
    expect(h.group.position.toArray()).toEqual([15, 0, 15]);
    expect(h.result.current.current.moving).toBe(false);
    expect(h.result.current.current.speed).toBe(0);
  });
});
