import { afterEach, describe, expect, it, vi } from 'vitest';
import { tileToWorld, type Tile } from '@sim';

vi.mock('../spacetime/hooks', () => ({ useTick: () => 0, useMyPlayer: () => null }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ setTarget: vi.fn() }) }));

import { claimSpireAtmosphere, fireTicksOf, handleFloorClick, SHARDMOTHER_TINT, SPIRE_FOG_NEAR, spireFogBand } from '../bosses/spire/SpireScene';
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

describe('the Spire atmosphere', () => {
  /** R3F's attach/detach: attaching remembers the previous value, detaching writes it back. */
  const attach = (scene: any, key: 'background' | 'fog', obj: any) => { obj.prev = scene[key]; scene[key] = obj; return () => { scene[key] = obj.prev; }; };

  it('leaves the overworld background and fog that AlphaIsland attached before the cleanup ran, visit after visit', () => {
    const scene: any = { background: null, fog: null };
    let island = { bg: { id: 'C1' }, fog: { id: 'F1' } };
    let detachBg = attach(scene, 'background', island.bg), detachFog = attach(scene, 'fog', island.fog);
    for (let visit = 1; visit <= 3; visit++) {
      // Enter: AlphaIsland unmounts (mutation phase), then the Spire's effect claims the scene.
      detachBg(); detachFog();
      const release = claimSpireAtmosphere(scene);
      expect(scene.fog.near).toBe(SPIRE_FOG_NEAR);
      // Leave: AlphaIsland remounts and attaches in the mutation phase, then the Spire's passive cleanup runs.
      island = { bg: { id: `C${visit + 1}` }, fog: { id: `F${visit + 1}` } };
      detachBg = attach(scene, 'background', island.bg); detachFog = attach(scene, 'fog', island.fog);
      release();
      expect(scene.background).toBe(island.bg);
      expect(scene.fog).toBe(island.fog);
    }
  });

  it('keeps the whole floor out of the fog at every zoom (the band starts past the farthest floor tile)', () => {
    // The farthest floor point is a corner ~10.6 tiles from the centre; along the view it is never deeper than that.
    for (const d of [18, 24, 30, 34]) {  // SPIRE_CAMERA's min, landscape, portrait and max zoom
      const [near, far] = spireFogBand(d);
      expect(near).toBeGreaterThanOrEqual(d + Math.hypot(7.5, 7.5) - 1);
      expect(far).toBeGreaterThan(near);
    }
  });

  it('restores what was there when nothing else took the scene meanwhile', () => {
    const before = { background: { id: 'sky' }, fog: { id: 'haze' } };
    const scene: any = { ...before };
    const release = claimSpireAtmosphere(scene);
    expect(scene.background).not.toBe(before.background);
    release();
    expect(scene).toEqual(before);
  });
});
