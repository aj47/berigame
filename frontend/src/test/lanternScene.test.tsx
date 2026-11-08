import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRID_SIZE, LANTERN_CELLS, LANTERN_PLANK, LANTERN_SPAWNS, LANTERN_STANDABLE, LanternStage, lanternAdvance, lanternFreshFight, lanternHazardMask,
  lanternTile, tileToWorld,
} from '@sim';
import { tileKeyCentre } from '../bosses/DangerTiles';

const mock = vi.hoisted(() => ({ tick: 105, tiles: [] as any[], me: null as any, setTarget: vi.fn() }));
vi.mock('@react-three/fiber', () => ({ useFrame: () => {}, useThree: () => ({}) }));
vi.mock('@react-three/drei', () => ({ Html: () => null }));
vi.mock('../bosses/DangerTiles', async (orig) => ({ ...(await orig<any>()), default: (props: any) => { mock.tiles.push(props); return null; } }));
vi.mock('../spacetime/hooks', () => ({ useTick: () => mock.tick, useMyPlayer: () => mock.me }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ setTarget: mock.setTarget }) }));

import { LanternOverlay, handleLanternFloorClick } from '../bosses/lantern/LanternScene';
import { lanternDanger, lanternKey, lanternStatus } from '../bosses/lantern/lanternModel';
import { seedLantern } from './lanternFixtures';
import { useBossStore } from '../bosses/bossStore';

const START = 105;
const keysOf = (mask: Uint8Array) => { const out: number[] = []; for (let i = 0; i < LANTERN_CELLS; i++) if (mask[i]) out.push(lanternKey(i)); return out; };

/** The fight row at the end of every tick from the start, through a whole den / dive / tide / ebb cycle. */
function cycle(ticks = 90) {
  const targets = [LANTERN_SPAWNS[0], LANTERN_SPAWNS[1]];
  let f = lanternFreshFight(4242, 2, START, targets, 1780);
  const out: { T: number; f: typeof f }[] = [];
  for (let T = START; T < START + ticks; T++) { out.push({ T, f }); f = lanternAdvance(f, T, START, targets); }
  return out;
}

beforeEach(() => { mock.tiles = []; mock.me = null; seedLantern(); });
afterEach(() => { cleanup(); useBossStore.getState().reset(); });

describe('the Drowned Hollow telegraphs', () => {
  it('draws red exactly lanternHazardMask(T + 1) and amber the rest of T + 2, on every tick of a cycle', () => {
    const stages = new Set<number>();
    for (const { T, f } of cycle()) {
      stages.add(f.stage);
      const d = lanternDanger(f, T, START);
      expect(d.red).toEqual(keysOf(lanternHazardMask(f, T + 1, START)));
      const next = new Set(d.red);
      expect(d.amber).toEqual(keysOf(lanternHazardMask(f, T + 2, START)).filter((k) => !next.has(k)));
    }
    // The sample covers the den, the dive, the tide and the ebb.
    expect([...stages].sort()).toEqual([LanternStage.Den, LanternStage.Dive, LanternStage.Tide, LanternStage.Ebb]);
  });

  it('floods every non-plank tile and no plank during the tide', () => {
    const tide = cycle().find(({ T, f }) => f.stage === LanternStage.Tide && T > f.surfaceTick + 1 && lanternStatus(f, T).flooded)!;
    expect(tide).toBeTruthy();
    const red = new Set(lanternDanger(tide.f, tide.T, START).red);
    for (let i = 0; i < LANTERN_CELLS; i++) {
      if (LANTERN_STANDABLE[i] && !LANTERN_PLANK[i]) expect(red.has(lanternKey(i))).toBe(true);
    }
    expect(lanternStatus(tide.f, tide.T).spring).toBe(tide.f.spring);
  });

  it('puts each key on its own floor tile', () => {
    for (const i of [0, 7, 112, 224]) {
      const [x, , z] = tileToWorld(lanternTile(i));
      expect(tileKeyCentre(lanternKey(i))).toEqual([x, z]);
      expect(lanternKey(i)).toBe(lanternTile(i).z * GRID_SIZE + lanternTile(i).x);
    }
  });

  it('the overlay hands DangerTiles those same tiles for the current tick', () => {
    const run = cycle();
    const at = run.find(({ f, T }) => f.stage === LanternStage.Den && lanternHazardMask(f, T + 1, START).some(Boolean))!;
    act(() => useBossStore.getState().setRow('lanternFight', { ...useBossStore.getState().lanternFight!, ...at.f }));
    mock.tick = at.T;
    render(<LanternOverlay />);
    const drawn = mock.tiles.slice(-2);
    const red = drawn.find((p) => p.color === '#ff4d5e'), amber = drawn.find((p) => p.color === '#ffb547');
    expect(red.tiles).toEqual(keysOf(lanternHazardMask(at.f, at.T + 1, START)));
    expect(red.tiles.length).toBeGreaterThan(0);
    expect(amber.tiles).toEqual(lanternDanger(at.f, at.T, START).amber);
  });

  it('walks only to standable floor tiles on a click', () => {
    const spawn = lanternTile(LANTERN_SPAWNS[0]);
    const [x, , z] = tileToWorld(spawn);
    expect(handleLanternFloorClick({ delta: 0, point: { x, z } }, { setTarget: mock.setTarget })).toEqual(spawn);
    expect(mock.setTarget).toHaveBeenLastCalledWith(spawn.x, spawn.z);
    // The maw is blocked.
    const [mx, , mz] = tileToWorld(lanternTile(112));
    expect(handleLanternFloorClick({ delta: 0, point: { x: mx, z: mz } }, { setTarget: mock.setTarget })).toBeNull();
    expect(handleLanternFloorClick({ delta: 9, point: { x, z } }, { setTarget: mock.setTarget })).toBeNull();
  });
});
