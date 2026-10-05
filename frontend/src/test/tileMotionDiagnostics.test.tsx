import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEADOW_OFFSET } from '../../../shared/sim/frontier/homeMap';
/** Meadows-local x to world x. */
const mx = (x: number) => x + MEADOW_OFFSET.x - 25;
import { Group } from 'three';
import { useTileMotion } from '../hooks/useTileMotion';
import { clearDiagnostics, diagnosticHistory } from '../spacetime/diagnostics';
import { boundaryKey } from '../../../shared/sim/frontier/building';
import type { RegionId } from '../../../shared/sim/frontier/catalog';

const harness = vi.hoisted(() => ({ frame: () => {}, now: 0 }));
vi.mock('@react-three/fiber', () => ({ useFrame: (frame: () => void) => { harness.frame = frame; } }));
vi.mock('../spacetime/hooks', () => ({ useWorldBlocked: () => new Set<number>() }));
vi.mock('../spacetime/tickClock', () => ({ tickClock: { period: 600, tick: 123 } }));
beforeEach(() => { clearDiagnostics(); harness.now = 0; vi.spyOn(performance, 'now').mockImplementation(() => harness.now); });
afterEach(() => vi.restoreAllMocks());

function setup(self: boolean, blocked = new Set<string>()) {
  const group = new Group(), ref = { current: group };
  const hook = renderHook(({ x, z, region }) => useTileMotion(x, z, 6, ref, region, blocked, undefined, self), {
    initialProps: { x: 31, z: 64, region: 'settlement' as RegionId },
  });
  return { ...hook, group, frame: (now: number) => act(() => { harness.now = now; harness.frame(); }) };
}

describe('local-player movement diagnostics', () => {
  it('records one confirmed interpolation with local tile coordinates, and never writes per frame', () => {
    const h = setup(true);
    expect(diagnosticHistory()).toEqual([expect.objectContaining({ kind: 'movement-snap', data: expect.objectContaining({ reason: 'startup' }) })]);
    h.rerender({ x: 33, z: 64, region: 'settlement' });
    expect(diagnosticHistory().at(-1)?.data).toEqual({ tick: 123, fromRegion: 'settlement', toRegion: 'settlement',
      fromX: 31, fromZ: 64, toX: 33, toZ: 64, routeLength: 2, durationMs: 600 });
    for (const now of [50, 100, 200, 400, 600, 800]) h.frame(now);
    expect(diagnosticHistory()).toHaveLength(2);
    expect(h.group.position.toArray()).toEqual([mx(33), 0, 0]);
    for (const event of diagnosticHistory()) {
      expect(Object.values(event.data).every(value => typeof value === 'number' || typeof value === 'string')).toBe(true);
      expect(Object.keys(event.data)).not.toEqual(expect.arrayContaining(['identity', 'name']));
    }
  });

  it('does not record another player, including their startup, moves or teleports', () => {
    const h = setup(false); h.rerender({ x: 33, z: 64, region: 'settlement' }); h.frame(600);
    h.rerender({ x: 70, z: 64, region: 'settlement' }); h.frame(900);
    h.rerender({ x: 5, z: 64, region: 'reedwake' });
    expect(diagnosticHistory()).toEqual([]);
  });

  it('distinguishes an island change from a large same-region correction', () => {
    const h = setup(true); h.rerender({ x: 5, z: 64, region: 'reedwake' });
    expect(diagnosticHistory().at(-1)?.data.reason).toBe('region-change');
    expect(h.group.position.toArray()).toEqual([-20, 0, 39]);
    h.rerender({ x: 20, z: 64, region: 'reedwake' });
    expect(diagnosticHistory().at(-1)?.data.reason).toBe('jump-limit');
    expect(h.group.position.toArray()).toEqual([-5, 0, 39]);
  });

  it('records invalid and overly long legal routes without changing their snap behavior', () => {
    const blocked = new Set(['32,64']), h = setup(true, blocked);
    h.rerender({ x: 32, z: 64, region: 'settlement' });
    expect(diagnosticHistory().at(-1)?.data.reason).toBe('route-invalid');
    expect(h.group.position.toArray()).toEqual([mx(32), 0, 0]);
    h.unmount(); blocked.clear();
    for (const z of [62, 63, 64, 65, 66]) blocked.add(boundaryKey({ x: 31, z }, { x: 32, z }));
    const long = setup(true, blocked); long.rerender({ x: 32, z: 64, region: 'settlement' });
    expect(diagnosticHistory().at(-1)?.data).toMatchObject({ reason: 'route-too-long' });
    expect(Number(diagnosticHistory().at(-1)?.data.routeLength)).toBeGreaterThan(3);
    expect(long.group.position.toArray()).toEqual([mx(32), 0, 0]);
  });
});
