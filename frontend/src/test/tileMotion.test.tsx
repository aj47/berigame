import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { HOME_JOIN, MEADOW_OFFSET } from '../../../shared/sim/frontier/homeMap';
/** Meadows-local x to world x. */
const mx = (x: number) => x + MEADOW_OFFSET.x - 25;
import { Group } from 'three';
import { useTileMotion } from '../hooks/useTileMotion';
import { boundaryKey } from '../../../shared/sim/frontier/building';
import { meadowBlockedTiles } from '../Components/3D/hoverTarget';

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
  it('does not accumulate movement lag when each update arrives between rendered frames', () => {
    const h = setup();
    h.rerender({ x: 27, z: 25, facing: 6 });
    for (let step = 1; step < 10; step++) {
      h.frame(step * 600 - 20);
      // The packet arrives 20 ms after the last rendered frame. That elapsed
      // travel must not be queued again on every tick.
      harness.now = step * 600;
      h.rerender({ x: 27 + step * 2, z: 25, facing: 6 });
      expect(h.result.current.current.durationMs).toBeCloseTo(600);
    }
    h.frame(6000);
    expect(h.group.position.x).toBeCloseTo(20);
  });
  it('snaps a long authoritative correction rather than running across the map', () => {
    const h = setup(); h.rerender({ x: 40, z: 40, facing: 7 });
    expect(h.group.position.toArray()).toEqual([15, 0, 15]);
    expect(h.result.current.current.moving).toBe(false);
    expect(h.result.current.current.speed).toBe(0);
  });
});

describe('connected home island motion', () => {
  it.each([['visitor', true], ['owner', false], ['guest', false]] as const)('uses %s gate access at the origin when animating an entry', (identity, detour) => {
    const group = new Group(), ref = { current: group };
    const frontier = {
      plots: [{ id: 'plot', x: 12, z: 65, claim: { id: 'plot', owner: 'owner', permissions: { guest: 1 } } }],
      buildings: [{ id: 'gate', claim: 'plot', region: 'settlement', piece: 'gate', x: 12, z: 65, rotation: 3, edge: true }],
    } as any;
    const collision = vi.fn(from => meadowBlockedTiles(frontier, from, identity));
    const h = renderHook(({ x }) => useTileMotion(x, 65, 6, ref, 'settlement', undefined, collision), { initialProps: { x: 11 } });
    h.rerender({ x: 12 });
    expect(collision).toHaveBeenCalledWith({ x: 11, z: 65, region: 'settlement' });
    expect(h.result.current.current.points.some(point => point.z !== 1)).toBe(detour);
    act(() => { harness.now = 600; harness.frame(); });
    expect(group.position.toArray()).toEqual([mx(12), 0, 1]);
  });
  it('uses the occupied parcel at the origin to animate a visitor leaving through its gate', () => {
    const group = new Group(), ref = { current: group };
    const frontier = {
      plots: [{ id: 'plot', x: 12, z: 65, claim: { id: 'plot', owner: 'owner', permissions: {} } }],
      buildings: [{ id: 'gate', claim: 'plot', region: 'settlement', piece: 'gate', x: 12, z: 65, rotation: 3, edge: true }],
    } as any;
    const h = renderHook(({ x }) => useTileMotion(x, 65, 2, ref, 'settlement', undefined, from => meadowBlockedTiles(frontier, from, 'visitor')), { initialProps: { x: 12 } });
    h.rerender({ x: 11 });
    expect(h.result.current.current.points.every(point => point.z === 1)).toBe(true);
    act(() => { harness.now = 300; harness.frame(); });
    expect(group.position.toArray()).toEqual([mx(11), 0, 1]);
  });
  it('animates around a wall edge between two walkable floor tiles', () => {
    const group = new Group(), ref = { current: group };
    const blocked = new Set([boundaryKey({ x: 31, z: 64 }, { x: 32, z: 64 })]);
    const h = renderHook(({ x }) => useTileMotion(x, 64, 6, ref, 'settlement', blocked), { initialProps: { x: 31 } });
    h.rerender({ x: 32 });
    expect(h.result.current.current.points.some(point => point.z !== 0)).toBe(true);
    act(() => { harness.now = 100; harness.frame(); });
    expect(group.position.x).toBe(mx(31));
    expect(group.position.z).not.toBe(0);
    act(() => { harness.now = 600; harness.frame(); });
    expect(group.position.toArray()).toEqual([mx(32), 0, 0]);
  });
  it('animates a three-step district update over one tick instead of snapping', () => {
    const group = new Group(), ref = { current: group };
    const h = renderHook(({ x }) => useTileMotion(x, 64, 6, ref, 'settlement'), { initialProps: { x: 30 } });
    h.rerender({ x: 33 });
    expect(group.position.x).toBe(mx(30));
    act(() => { harness.now = 300; harness.frame(); });
    expect(group.position.x).toBeCloseTo(mx(31.5));
    act(() => { harness.now = 600; harness.frame(); });
    expect(group.position.x).toBeCloseTo(mx(33));
  });
  it('keeps the same avatar moving through the district seam in both directions', () => {
    const group=new Group(), ref={current:group};
    const seam=HOME_JOIN.bramblewild.x, wx=seam-25;
    const h=renderHook(({x,z,region})=>useTileMotion(x,z,6,ref,region as any), {initialProps:{x:seam,z:25,region:'bramblewild'}});
    expect(group.position.toArray()).toEqual([wx,0,0]);
    h.rerender({x:1,z:64,region:'settlement'});
    expect(group.position.toArray()).toEqual([wx,0,0]);
    act(()=>{harness.now=300;harness.frame();});
    expect(group.position.x).toBeCloseTo(wx+1);
    act(()=>{harness.now=600;harness.frame();});
    expect(group.position.toArray()).toEqual([wx+2,0,0]);
    h.rerender({x:seam,z:25,region:'bramblewild'});
    act(()=>{harness.now=1200;harness.frame();});
    expect(group.position.toArray()).toEqual([wx,0,0]);
  });
});
