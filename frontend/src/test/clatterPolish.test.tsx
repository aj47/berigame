import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOSS_CONFIG_DEFAULTS, CLATTER_STONES, ClatterAttack, ClatterState, GRID_SIZE, canonicalMiddle, chebyshev, clatterHitsMove,
  clatterLane, clatterSwarmFreeLines, clatterTelegraph, freshClatterhorn, inClatterGlade, tileKey, tileToWorld, worldBlockedSet,
  type ClatterRowLike, type Tile,
} from '@sim';

const mock = vi.hoisted(() => ({ frames: [] as ((...a: any[]) => void)[], now: 0, controls: null as any }));
vi.mock('@react-three/fiber', () => ({
  useFrame: (f: any) => { mock.frames.push(f); },
  useThree: (sel?: any) => {
    const s = { size: { width: 1200, height: 800 }, gl: { domElement: document.createElement('canvas') }, events: { connected: undefined } };
    return sel ? sel(s) : s;
  },
}));
vi.mock('@react-three/drei', async () => {
  const R = await import('react');
  return { CameraControls: R.forwardRef((_p: any, ref: any) => { R.useImperativeHandle(ref, () => mock.controls); return null; }) };
});
vi.mock('../Components/3D/cameraInput', () => ({ configureWorldCameraInput: () => {}, guardWorldCameraClicks: () => () => {} }));

import CameraController, { FLIP_SHAKE_MS, flipShake } from '../Components/3D/CameraController';
import { clatterHoverVerdict } from '../Components/3D/hoverTarget';
import { clatterHazardLive } from '../Objects/GroundPlane';
import { useBossStore } from '../bosses/bossStore';
import { useClatterFxStore } from '../bosses/clatterhorn/clatterFx';
import { useSettingsStore } from '../spacetime/stores/settingsStore';

const BLOCKED = worldBlockedSet([]);
const cfg = { ...BOSS_CONFIG_DEFAULTS, clatterhornOpen: true };
const crow = (over: Partial<ClatterRowLike> = {}): ClatterRowLike => ({
  ...freshClatterhorn(cfg), state: ClatterState.Idle, engagedTick: 900, lastHitTick: 900, fightCount: 3, ...over,
});
const unkey = (k: number): Tile => ({ x: k % GRID_SIZE, z: Math.floor(k / GRID_SIZE) });
const near = (me: Tile) => {
  const out: Tile[] = [];
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) out.push({ x: me.x + dx, z: me.z + dz });
  return out;
};
/** Brute force: the move in tick + 1, then standing on the tile through `ticks`. */
function bruteHit(row: ClatterRowLike, tick: number, me: Tile, tile: Tile, ticks: number): boolean {
  const mid = canonicalMiddle(me, tile, BLOCKED);
  if (clatterHitsMove(row, tick + 1, me, mid, tile)) return true;
  for (let k = 2; k <= ticks; k++) if (clatterHitsMove(row, tick + k, tile, tile, tile)) return true;
  return false;
}

describe('Clatterhorn flip camera shake', () => {
  const beetle = { x: 10, z: 10 };
  it('jolts from the flip moment, decays within FLIP_SHAKE_MS, fades with distance and never runs with reduced motion', () => {
    expect(flipShake(999, 1000, beetle, beetle, false)).toBeNull();
    expect(flipShake(1000 + FLIP_SHAKE_MS, 1000, beetle, beetle, false)).toBeNull();
    expect(flipShake(1030, 1000, beetle, beetle, true)).toBeNull();
    expect(flipShake(1030, -Infinity, beetle, beetle, false)).toBeNull();
    expect(flipShake(1030, 1000, null, beetle, false)).toBeNull();
    const peak = (from: number, to: number, target: Tile) => {
      let m = 0;
      for (let t = from; t < to; t += 5) {
        const j = flipShake(t, 1000, beetle, target, false);
        if (j) m = Math.max(m, Math.abs(j[0]), Math.abs(j[1]));
      }
      return m;
    };
    const early = peak(1000, 1100, beetle), late = peak(1300, 1000 + FLIP_SHAKE_MS, beetle);
    expect(early).toBeGreaterThan(0.1);
    expect(late).toBeLessThan(early / 4);
    // Half strength 18 tiles away, nothing past 26.
    expect(peak(1000, 1100, { x: 28, z: 10 })).toBeCloseTo(early / 2, 1);
    expect(peak(1000, 1100, { x: 37, z: 10 })).toBe(0);
  });

  describe('CameraController wiring (useClatterFxStore.flipAt -> focal offset)', () => {
    const [bx, , bz] = tileToWorld({ x: 84, z: 106 });
    const playerRef = { current: { position: { x: bx + 2, y: 0, z: bz } } };
    const frame = (now: number) => act(() => { mock.now = now; for (const f of mock.frames) f({}, 1 / 60); });
    beforeEach(() => {
      mock.frames = []; mock.now = 0;
      mock.controls = {
        setFocalOffset: vi.fn(), moveTo: vi.fn(), dollyTo: vi.fn(), rotateTo: vi.fn(), distance: 18, enabled: true,
        minDistance: 0, maxDistance: 0, minPolarAngle: 0, maxPolarAngle: 0,
      };
      vi.spyOn(performance, 'now').mockImplementation(() => mock.now);
      useBossStore.setState({ clatter: crow({ x: 84, z: 106, state: ClatterState.Flipped }) as any });
      useClatterFxStore.setState({ flipAt: -Infinity });
    });
    afterEach(() => { cleanup(); vi.restoreAllMocks(); useBossStore.getState().reset(); useSettingsStore.getState().reset(); });

    const shakes = () => mock.controls.setFocalOffset.mock.calls.filter((c: any[]) => c[3] === false);

    it('shakes after a flip near you and settles back on the resting offset', () => {
      useSettingsStore.setState({ reduceMotion: false });
      render(<CameraController playerRef={playerRef} />);
      frame(500);
      expect(shakes()).toHaveLength(0);
      useClatterFxStore.setState({ flipAt: 1000 });
      frame(1040);
      expect(shakes()).toHaveLength(1);
      expect(shakes()[0][0] !== 0 || shakes()[0][1] !== 0.5).toBe(true);
      frame(1000 + FLIP_SHAKE_MS + 10);
      expect(shakes().at(-1)).toEqual([0, 0.5, 0, false]);
      const n = shakes().length;
      frame(2000);
      expect(shakes()).toHaveLength(n);
    });

    it('does nothing with reduced motion or inside the Spire', () => {
      useSettingsStore.setState({ reduceMotion: true });
      const ui = render(<CameraController playerRef={playerRef} />);
      useClatterFxStore.setState({ flipAt: 1000 });
      frame(1040);
      expect(shakes()).toHaveLength(0);
      act(() => useSettingsStore.setState({ reduceMotion: false }));
      ui.rerender(<CameraController playerRef={playerRef} focus={{ target: [0, 0], distance: 24, min: 18, max: 34 }} />);
      frame(1050);
      expect(shakes()).toHaveLength(0);
    });
  });
});

describe('Clatterhorn dodge-assist hover', () => {
  const tick = 1000;

  it('is live only during a telegraph or the swarm', () => {
    expect(clatterHazardLive(null)).toBe(false);
    expect(clatterHazardLive(crow())).toBe(false);
    expect(clatterHazardLive(crow({ state: ClatterState.Flipped }))).toBe(false);
    expect(clatterHazardLive(crow({ state: ClatterState.SpinWindup, attack: ClatterAttack.Spin, stateUntilTick: tick + 2 }))).toBe(true);
    expect(clatterHazardLive(crow({ state: ClatterState.DrumWindup, attack: ClatterAttack.Drum, stateUntilTick: tick + 2 }))).toBe(true);
  });

  it('a charge: lane tiles are red with the blow, the rest green, exactly as clatterHitsMove says', () => {
    const centre = { x: 84, z: 106 };
    let hits = 0, safe = 0;
    for (let dir = 0; dir < 8; dir++) {
      const lane = clatterLane(centre, dir);
      if (lane.len < 3) continue;
      const row = crow({ ...centre, state: ClatterState.ChargeWindup, attack: ClatterAttack.Charge, dir, endX: lane.end.x, endZ: lane.end.z,
        endKind: lane.endKind, stateUntilTick: tick + 3 });
      const laneKeys = new Set(clatterTelegraph(row)!.tiles);
      const me = unkey(lane.tiles[1]);
      expect(inClatterGlade(me)).toBe(true);
      for (const tile of near(me)) {
        const v = clatterHoverVerdict(row, tick, me, tile, BLOCKED);
        if (BLOCKED.has(tileKey(tile))) { expect(v).toBeNull(); continue; }
        expect(v).not.toBeNull();
        const hit = bruteHit(row, tick, me, tile, 3);
        expect(v!.kind).toBe(hit ? 'hit' : 'safe');
        expect(hit).toBe(laneKeys.has(tileKey(tile)));
        if (hit) { expect(v!.damage).toBe(14); hits++; } else { expect(v!.damage).toBe(0); safe++; }
      }
    }
    expect(hits).toBeGreaterThan(10);
    expect(safe).toBeGreaterThan(50);
  });

  it('a spin: ring 2 is red for 10', () => {
    const row = crow({ x: 84, z: 106, state: ClatterState.SpinWindup, attack: ClatterAttack.Spin, stateUntilTick: tick + 2 });
    const me = { x: 85, z: 107 };
    expect(clatterHoverVerdict(row, tick, me, { x: 86, z: 108 }, BLOCKED)).toMatchObject({ kind: 'hit', damage: 10 });
    expect(clatterHoverVerdict(row, tick, me, { x: 85, z: 107 }, BLOCKED)).toMatchObject({ kind: 'safe', damage: 0 });
  });

  it('the swarm: free lines are green, other glade tiles red with every runner that would pass', () => {
    const windup = crow({ state: ClatterState.DrumWindup, attack: ClatterAttack.Drum, swarmSide: 0, swarmFree: 0, stateUntilTick: tick + 2 });
    const lines = clatterSwarmFreeLines(windup);
    const me = { x: lines[1] + 1, z: 106 };
    const free = clatterHoverVerdict(windup, tick, me, { x: lines[1], z: 106 }, BLOCKED)!;
    expect(free).toMatchObject({ kind: 'safe', damage: 0 });
    const stay = clatterHoverVerdict(windup, tick, me, me, BLOCKED)!;
    expect(stay.kind).toBe('hit');
    expect(stay.damage % 5).toBe(0);
    expect(stay.damage).toBeGreaterThanOrEqual(10); // a runner hits as it enters and as it leaves
    expect(bruteHit(windup, tick, me, me, 30)).toBe(true);
    expect(bruteHit(windup, tick, me, { x: lines[1], z: 106 }, 30)).toBe(false);
    // Mid-swarm too.
    const drumming = { ...windup, state: ClatterState.Drumming, swarmTick: tick + 2, stateUntilTick: tick + 22 };
    expect(clatterHoverVerdict(drumming, tick + 4, me, { x: lines[1], z: 106 }, BLOCKED)?.kind).toBe('safe');
  });

  it('draws nothing outside the glade, beyond Chebyshev 2, on a stone, or with no hazard', () => {
    const row = crow({ x: 84, z: 106, state: ClatterState.SpinWindup, attack: ClatterAttack.Spin, stateUntilTick: tick + 2 });
    const me = { x: 85, z: 107 };
    expect(clatterHoverVerdict(row, tick, me, { x: 88, z: 107 }, BLOCKED)).toBeNull();
    expect(clatterHoverVerdict(row, tick, { x: 60, z: 60 }, { x: 61, z: 60 }, BLOCKED)).toBeNull();
    expect(clatterHoverVerdict(crow(), tick, me, me, BLOCKED)).toBeNull();
    expect(clatterHoverVerdict(null, tick, me, me, BLOCKED)).toBeNull();
    const stone = CLATTER_STONES.find((s) => inClatterGlade(s))!;
    const by = { x: stone.x + 1, z: stone.z };
    expect(chebyshev(by, stone)).toBe(1);
    expect(inClatterGlade(by) && !BLOCKED.has(tileKey(by))).toBe(true);
    expect(clatterHoverVerdict(row, tick, by, stone, BLOCKED)).toBeNull();
  });
});
