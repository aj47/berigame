import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { Euler, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshGiant, GiantState } from '@sim';
import { GiantModel } from '../Components/3D/Giant';

const mock = vi.hoisted(() => ({ now: 1000, frame: null as any, clock: { tick: 101, period: 600 } }));
vi.mock('@react-three/fiber', () => ({ useFrame: (frame: any) => { mock.frame = frame; } }));
vi.mock('@react-three/drei', () => ({ Html: () => null }));
vi.mock('../spacetime/tickClock', () => ({ tickClock: mock.clock }));
vi.mock('../spacetime/hooks', () => ({ useMyPlayer: () => null, useGiantRaid: () => null, useNow: () => 0 }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({}) }));

beforeEach(() => {
  mock.now = 1000; mock.clock.tick = 101;
  vi.spyOn(performance, 'now').mockImplementation(() => mock.now);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup() {
  const giant = { ...freshGiant(100), id: 1, state: GiantState.Windup, stateUntilTick: 103 } as any;
  const ui = render(<GiantModel giant={giant} tick={101} onAttack={() => {}} />);
  // The DOM harness holds R3F refs; supply their transform objects so the real
  // frame callback can animate the warning marker and limbs.
  for (const element of ui.container.querySelectorAll('group, mesh')) {
    Object.assign(element, { position: new Vector3(), rotation: new Euler(), scale: new Vector3(1, 1, 1) });
  }
  const fill = ui.container.querySelector('group[name="giant"] > group:nth-of-type(2) > mesh:nth-of-type(2)') as any;
  const frame = (now: number) => act(() => { mock.now = now; mock.frame({ clock: { elapsedTime: now / 1000 } }, 1 / 60); });
  return { ui, giant, fill, frame };
}

describe('Giant wind-up timing', () => {
  it('starts a late-mounted warning at the observed tick instead of showing a completed warning', () => {
    const h = setup();
    h.frame(1000);
    expect(h.fill.scale.x).toBeCloseTo(1 / 3);
    h.frame(1600);
    expect(h.fill.scale.x).toBeCloseTo(2 / 3);
  });

  it('keeps progress through hits and restarts for a new wind-up even if recovery was not rendered', () => {
    const h = setup();
    h.frame(1300);
    expect(h.fill.scale.x).toBeCloseTo(.5);
    h.ui.rerender(<GiantModel giant={{ ...h.giant, hp: 390 }} tick={101} onAttack={() => {}} />);
    h.frame(1600);
    expect(h.fill.scale.x).toBeCloseTo(2 / 3);
    mock.clock.tick = 108;
    h.ui.rerender(<GiantModel giant={{ ...h.giant, stateUntilTick: 110 }} tick={108} onAttack={() => {}} />);
    h.frame(1600);
    expect(h.fill.scale.x).toBeCloseTo(1 / 3);
  });
});
