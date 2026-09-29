import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Group } from 'three';
import { useTileMotion } from '../hooks/useTileMotion';
import { MOVEMENT_ANIMATION_GRACE_MS, START_EASE_MS } from '../animation/locomotion';

const harness = vi.hoisted(() => ({ frame: () => {}, now: 0, trees: [] as { x: number; z: number }[] }));
vi.mock('@react-three/fiber', () => ({ useFrame: (frame: () => void) => { harness.frame = frame; } }));
vi.mock('../spacetime/hooks', async () => {
  const { worldBlockedSet } = await import('@sim');
  return { useTrees: () => harness.trees, useWorldBlocked: () => worldBlockedSet(harness.trees) };
});
vi.mock('../spacetime/tickClock', () => ({ tickClock: { period: 600 } }));

beforeEach(() => {
  harness.now = 0; harness.trees = [];
  vi.spyOn(performance, 'now').mockImplementation(() => harness.now);
});
afterEach(() => vi.restoreAllMocks());
function setup() {
  const group = new Group();
  const ref = { current: group };
  const hook = renderHook(({ x, z, facing }) => useTileMotion(x, z, facing, ref), { initialProps: { x: 25, z: 25, facing: 0 } });
  return { ...hook, group, frame: (at: number) => act(() => { harness.now = at; harness.frame(); }) };
}

describe('tile motion easing and hold', () => {
  it('sets off from rest gently, but is on schedule from START_EASE_MS and arrives on time', () => {
    const h = setup();
    h.rerender({ x: 27, z: 25, facing: 2 }); // Two steps east: 600ms.
    h.frame(20);
    expect(h.group.position.x).toBeGreaterThan(0);
    expect(h.group.position.x).toBeLessThan(2 * 20 / 600);
    expect(h.result.current.current.speed).toBeLessThan(1 / 0.3);
    h.frame(START_EASE_MS);
    expect(h.group.position.x).toBe(2 * START_EASE_MS / 600);
    h.frame(450);
    expect(h.group.position.x).toBe(1.5);
    expect(h.result.current.current.speed).toBeCloseTo(1 / 0.3);
    h.frame(600);
    expect(h.group.position.x).toBe(2);
  });

  it('reports how long the gait has been held at the destination, and clears it on a stop or new travel', () => {
    const h = setup();
    h.rerender({ x: 26, z: 25, facing: 2 });
    h.frame(250);
    expect(h.result.current.current.holdMs).toBe(0);
    h.frame(300);
    expect(h.result.current.current.holdMs).toBe(0);
    h.frame(350);
    expect(h.result.current.current).toMatchObject({ moving: true, holdMs: 50 });
    // The next confirmed step arrives inside the grace: full speed at once, no second ease.
    h.rerender({ x: 27, z: 25, facing: 2 });
    expect(h.result.current.current.holdMs).toBe(0);
    h.frame(360);
    expect(h.group.position.x).toBeCloseTo(1 + 10 / 300);
    h.frame(650 + MOVEMENT_ANIMATION_GRACE_MS);
    expect(h.result.current.current).toMatchObject({ moving: false, holdMs: 0, speed: 0 });
  });

  it('turns towards the travel direction at the same rate at any frame rate', () => {
    const turned = (fps: number) => {
      const h = setup();
      h.frame(0);
      h.rerender({ x: 27, z: 25, facing: 6 }); // Two steps east (a quarter turn from facing south).
      for (let t = 1000 / fps; t <= 100 + 1e-9; t += 1000 / fps) h.frame(t);
      h.unmount();
      return h.group.rotation.y;
    };
    const target = turned(240);
    for (const fps of [30, 60, 120]) expect(Math.abs(turned(fps) - target)).toBeLessThan(0.02);
  });
});
