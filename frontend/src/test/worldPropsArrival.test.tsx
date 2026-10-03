import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshGiant, GIANT_REACH, GiantState } from '@sim';
import BerryTree from '../Components/3D/BerryTree';
import GroundItem from '../Components/3D/GroundItem';
import TrainingDummy from '../Components/3D/TrainingDummy';
import { GiantModel } from '../Components/3D/Giant';
import { useUserInputStore } from '../store';
import { holdState } from '../Components/3D/tapAssist';

const mock = vi.hoisted(() => ({ approach: vi.fn(), attackDummy: vi.fn() }));
vi.mock('../frontier/worldInteraction', () => ({ approachWorldInteraction: mock.approach }));
vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }));
vi.mock('@react-three/drei', async () => {
  const { Texture } = await import('three');
  return { Html: () => null, useTexture: Object.assign(() => new Texture(), { preload: () => {} }) };
});
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => null, useMyIdentityHex: () => 'me', usePlayerByHex: () => null,
  useGiantRaid: () => null, useNow: () => 0,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ attackDummy: mock.attackDummy }) }));
vi.mock('../fx/HarvestRing', () => ({ default: () => null }));

const arrive = () => act(() => mock.approach.mock.lastCall![1]());
const selected = () => useUserInputStore.getState().clickedOtherObject;
beforeEach(() => {
  vi.clearAllMocks();
  holdState.active = false; holdState.suppressClickUntil = 0;
  useUserInputStore.getState().setClickedOtherObject(null);
});
afterEach(cleanup);

describe('world props wait for arrival', () => {
  it('opens berry harvest choices only after arriving beside the tree', () => {
    const tree = { id: 3, x: 28, z: 25, itemId: 'berry_strawberry', kind: 0, cooldownUntilTick: 0 } as any;
    const ui = render(<BerryTree tree={tree} tick={100} harvester={null} />);
    fireEvent.click(ui.container.querySelector('group')!);
    expect(mock.approach).toHaveBeenCalledWith({ region: 'bramblewild', x: 28, z: 25 }, expect.any(Function), 1);
    expect(selected()).toBeNull();
    arrive();
    expect(selected()).toMatchObject({ harvestNodeId: 3 });
  });

  it('does not open a pickup menu for a pile removed during the walk', () => {
    const item = { id: 5n, x: 25, z: 25, itemId: 'stick', quantity: 1 } as any;
    const ui = render(<GroundItem groundItem={item} />);
    fireEvent.click(ui.container.querySelector('group')!);
    expect(selected()).toBeNull();
    ui.unmount();
    arrive();
    expect(selected()).toBeNull();
  });

  it('walks to a dummy and preserves the explicit attack choice', () => {
    const dummy = { id: 1, x: 28, z: 28, hp: 30, maxHp: 30, lastHitTick: 0 } as any;
    const ui = render(<TrainingDummy dummy={dummy} tick={100} />);
    fireEvent.click(ui.container.querySelector('[name="training-dummy"]')!);
    expect(selected()).toBeNull();
    expect(mock.attackDummy).not.toHaveBeenCalled();
    arrive();
    expect(selected()).toMatchObject({ connectionId: 'Training dummy' });
    expect(mock.attackDummy).not.toHaveBeenCalled();
    act(() => selected().dropdownOptions[0].onClick());
    expect(mock.attackDummy).toHaveBeenCalledWith(1);
  });

  it('uses Giant reach and refreshes a raid that ended while walking', () => {
    const attack = vi.fn();
    const giant = { ...freshGiant(0), id: 1, state: GiantState.Idle } as any;
    const ui = render(<GiantModel giant={giant} tick={100} onAttack={attack} />);
    const footprint = ui.container.querySelector('group[name="giant"] > mesh:last-child')!;
    fireEvent.click(footprint);
    expect(mock.approach).toHaveBeenCalledWith({ region: 'bramblewild', x: giant.x, z: giant.z }, expect.any(Function), GIANT_REACH);
    expect(selected()).toBeNull();
    ui.rerender(<GiantModel giant={{ ...giant, state: GiantState.Asleep }} tick={101} onAttack={attack} />);
    arrive();
    expect(selected().dropdownOptions[0]).toMatchObject({ label: 'The Giant is asleep', disabled: true });
    expect(attack).not.toHaveBeenCalled();
  });
});
