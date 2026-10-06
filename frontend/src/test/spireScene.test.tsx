import { afterEach, describe, expect, it, vi } from 'vitest';
import { tileToWorld, type Tile } from '@sim';

vi.mock('../spacetime/hooks', () => ({ useTick: () => 0, useMyPlayer: () => null }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ setTarget: vi.fn() }) }));

import { fireTicksOf, handleFloorClick, SHARDMOTHER_TINT } from '../bosses/spire/SpireScene';
import { holdState } from '../Components/3D/tapAssist';
import { triangleCount } from '../Components/3D/nodes/lowPoly';
import { buildGateGeometry } from '../bosses/spire/SpireGate';
import { useUserInputStore } from '../store';

/** An R3F-shaped click on a tile's top face (slightly off-centre, as a real ray hit would be). */
const clickOn = (t: Tile, extra: Record<string, unknown> = {}) => {
  const [x, , z] = tileToWorld(t);
  return { delta: 0, point: { x: x + 0.2, z: z - 0.3 }, stopPropagation: vi.fn(), ...extra };
};

afterEach(() => { holdState.active = false; holdState.suppressClickUntil = 0; useUserInputStore.getState().setClickedOtherObject(null); });

describe('the Spire floor click-to-move', () => {
  it('a click on a floor tile calls setTarget with that tile and shows the marker', () => {
    const setTarget = vi.fn(), mark = vi.fn();
    const e = clickOn({ x: 73, z: 66 });
    expect(handleFloorClick(e, { setTarget, mark })).toEqual({ x: 73, z: 66 });
    expect(setTarget).toHaveBeenCalledWith(73, 66);
    expect(mark).toHaveBeenCalledWith({ x: 73, z: 66 });
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it('a drag (delta > 5) does not walk and lets the event go on', () => {
    const setTarget = vi.fn();
    const e = clickOn({ x: 73, z: 66 }, { delta: 6 });
    expect(handleFloorClick(e, { setTarget })).toBeNull();
    expect(setTarget).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });

  it('the release of a hold-to-walk is not a new tap', () => {
    const setTarget = vi.fn();
    holdState.active = true;
    expect(handleFloorClick(clickOn({ x: 73, z: 66 }), { setTarget })).toBeNull();
    holdState.active = false;
    holdState.suppressClickUntil = performance.now() + 1000;
    expect(handleFloorClick(clickOn({ x: 73, z: 66 }), { setTarget })).toBeNull();
    expect(setTarget).not.toHaveBeenCalled();
  });

  it('a click on the dais (or off the floor) does not walk', () => {
    const setTarget = vi.fn();
    for (const t of [{ x: 77, z: 62 }, { x: 76, z: 61 }, { x: 78, z: 63 }, { x: 69, z: 62 }, { x: 62, z: 45 }]) {
      expect(handleFloorClick(clickOn(t), { setTarget })).toBeNull();
    }
    expect(setTarget).not.toHaveBeenCalled();
  });

  it('a tap beside a teammate opens its menu instead of walking', () => {
    const setTarget = vi.fn();
    const menuNear = vi.fn(() => true);
    const e: any = clickOn({ x: 73, z: 66 }, { nativeEvent: { clientX: 10, clientY: 20, pointerType: 'touch' } });
    expect(handleFloorClick(e, { setTarget, menuNear })).toBeNull();
    expect(menuNear).toHaveBeenCalledWith(10, 20, 30, e.nativeEvent);
    expect(setTarget).not.toHaveBeenCalled();
  });

  it('a walk closes an open menu', () => {
    useUserInputStore.getState().setClickedOtherObject({ connectionId: 'someone', e: { clientX: 0, clientY: 0 }, dropdownOptions: [] });
    handleFloorClick(clickOn({ x: 80, z: 58 }), { setTarget: vi.fn(), menuNear: () => false });
    expect(useUserInputStore.getState().clickedOtherObject).toBeNull();
  });
});

describe('the Shardmother', () => {
  it('is tinted by phase and pulses once per volley fire tick', () => {
    expect(SHARDMOTHER_TINT.slice(1)).toEqual(['#ffd6f0', '#9fe7ff', '#b79bff', '#ff6b6b']);
    const b = new Int32Array([102, 77, 62, 2, 0, 2, 102, 77, 62, 0, 2, 2, 104, 77, 62, 2, 2, 1]);
    expect(fireTicksOf(b)).toEqual([102, 104]);
    expect(fireTicksOf(b)).toBe(fireTicksOf(b));
  });
});

describe('the Spire Gate', () => {
  it('is a small procedural low-poly arch and stair', () => {
    const g = buildGateGeometry();
    expect(triangleCount(g)).toBeGreaterThan(100);
    expect(triangleCount(g)).toBeLessThan(600);
    expect(g.getAttribute('color')).toBeDefined();
  });
});
