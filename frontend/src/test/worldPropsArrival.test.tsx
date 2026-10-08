import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshGiant, GIANT_REACH, GiantState } from '@sim';
import BerryTree from '../Components/3D/BerryTree';
import GroundItem from '../Components/3D/GroundItem';
import TrainingDummy from '../Components/3D/TrainingDummy';
import Giant, { GiantModel } from '../Components/3D/Giant';
import { useUserInputStore } from '../store';
import { holdState } from '../Components/3D/tapAssist';
import { useSettingsStore } from '../spacetime/stores/settingsStore';

const mock = vi.hoisted(() => ({ approach: vi.fn(), attackDummy: vi.fn(), attackGiant: vi.fn(), me: null as any }));
vi.mock('../frontier/worldInteraction', () => ({ approachWorldInteraction: mock.approach }));
vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }));
vi.mock('@react-three/drei', async () => {
  const { Texture } = await import('three');
  return { Html: () => null, useTexture: Object.assign(() => new Texture(), { preload: () => {} }) };
});
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.me, useMyIdentityHex: () => 'me', usePlayerByHex: () => null,
  useMyPlayerSelector: (select: any) => select(mock.me), useGiantRaid: () => null, useNow: () => 0,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ attackDummy: mock.attackDummy, attackGiant: mock.attackGiant }) }));
vi.mock('../fx/HarvestRing', () => ({ default: () => null }));

const arrive = () => act(() => mock.approach.mock.lastCall![1]());
const selected = () => useUserInputStore.getState().clickedOtherObject;
beforeEach(() => {
  vi.clearAllMocks();
  mock.me = null;
  holdState.active = false; holdState.suppressClickUntil = 0;
  useSettingsStore.setState({ oneClickAttack: false });
  useUserInputStore.getState().setClickedOtherObject(null);
});
afterEach(cleanup);

describe('world prop interactions', () => {
  it('opens berry harvest choices at the click before walking to a distant tree', () => {
    const tree = { id: 3, x: 28, z: 25, itemId: 'berry_strawberry', kind: 0, cooldownUntilTick: 0 } as any;
    const ui = render(<BerryTree tree={tree} tick={100} harvester={null} />);
    fireEvent.click(ui.container.querySelector('group')!);
    expect(mock.approach).not.toHaveBeenCalled();
    expect(selected()).toMatchObject({ harvestNodeId: 3 });
  });

  it('opens pickup choices at the click before walking to a distant pile', () => {
    const item = { id: 5n, x: 25, z: 25, itemId: 'stick', quantity: 1 } as any;
    const ui = render(<GroundItem groundItem={item} />);
    fireEvent.click(ui.container.querySelector('group')!);
    expect(mock.approach).not.toHaveBeenCalled();
    expect(selected()).toMatchObject({ groundItemId: 5n, groundTiles: [{ x: 25, z: 25 }] });
  });

  it('shows dummy attack options immediately; choosing Attack lets the server approach', () => {
    const dummy = { id: 1, x: 28, z: 28, hp: 30, maxHp: 30, lastHitTick: 0 } as any;
    const ui = render(<TrainingDummy dummy={dummy} tick={100} />);
    fireEvent.click(ui.container.querySelector('[name="training-dummy"]')!);
    expect(mock.approach).not.toHaveBeenCalled();
    expect(selected()).toMatchObject({ connectionId: 'Training dummy' });
    expect(mock.attackDummy).not.toHaveBeenCalled();
    act(() => selected().dropdownOptions[0].onClick());
    expect(mock.attackDummy).toHaveBeenCalledWith(1);
  });

  it('opens the Giant menu from its animated body immediately and ignores a raid that ended before choosing Attack', () => {
    const attack = vi.fn();
    const giant = { ...freshGiant(0), id: 1, state: GiantState.Idle } as any;
    const ui = render(<GiantModel giant={giant} tick={100} onAttack={attack} />);
    // This is the body, outside the separate invisible click box hierarchy.
    fireEvent.click(ui.container.querySelector('group[name="giant"] > group > group > mesh')!);
    expect(selected().dropdownOptions[0]).toMatchObject({ label: 'Attack The Giant', disabled: false });
    expect(mock.approach).not.toHaveBeenCalled();
    ui.rerender(<GiantModel giant={{ ...giant, state: GiantState.Asleep }} tick={101} onAttack={attack} />);
    act(() => selected().dropdownOptions[0].onClick());
    expect(attack).not.toHaveBeenCalled();
  });

  it.each(['body', 'arm', 'leg', 'footprint'])('one-click attacks through the Giant %s without waiting for a menu or walk', part => {
    useSettingsStore.setState({ oneClickAttack: true });
    const attack = vi.fn(), giant = { ...freshGiant(0), id: 1, state: GiantState.Windup } as any;
    const ui = render(<GiantModel giant={giant} tick={100} onAttack={attack} />);
    const selectors = {
      body: 'group[name="giant"] > group > group > mesh',
      arm: 'group[name="giant"] > group > group > group:nth-of-type(2) > mesh',
      leg: 'group[name="giant"] > group > group:nth-of-type(2) > mesh',
      footprint: 'group[name="giant"] > mesh:last-of-type',
    };
    fireEvent.click(ui.container.querySelector(selectors[part as keyof typeof selectors])!);
    expect(attack).toHaveBeenCalledExactlyOnceWith(1);
    expect(selected()).toBeNull();
    expect(mock.approach).not.toHaveBeenCalled();
  });

  it.each([GiantState.Asleep, GiantState.Defeated])('does not one-click attack an unavailable Giant (state %s)', state => {
    useSettingsStore.setState({ oneClickAttack: true });
    const attack = vi.fn(), giant = { ...freshGiant(0), id: 1, state } as any;
    const ui = render(<GiantModel giant={giant} tick={100} onAttack={attack} />);
    fireEvent.click(ui.container.querySelector('group[name="giant"]')!);
    expect(selected().dropdownOptions[0].disabled).toBe(true);
    expect(attack).not.toHaveBeenCalled();
  });

  it.each([
    { target: 'giant', enabled: true }, { target: 'giant', enabled: false },
    { target: 'dummy', enabled: true }, { target: 'dummy', enabled: false },
  ])('uses the latest mode for $target when toggled to $enabled before the handler updates', ({ target, enabled }) => {
    useSettingsStore.setState({ oneClickAttack: !enabled });
    const giant = { ...freshGiant(0), id: 1, state: GiantState.Idle } as any;
    const dummy = { id: 1, x: 28, z: 28, hp: 30, maxHp: 30, lastHitTick: 0 } as any;
    const ui = render(target === 'giant' ? <Giant giant={giant} tick={100} /> : <TrainingDummy dummy={dummy} tick={100} />);
    const group = ui.container.querySelector(`[name="${target === 'giant' ? 'giant' : 'training-dummy'}"]`) as any;
    const capturedClick = group[Object.keys(group).find(key => key.startsWith('__reactProps$'))!].onClick;
    act(() => {
      useSettingsStore.getState().set({ oneClickAttack: enabled });
      capturedClick({ delta: 0, button: 0, stopPropagation: vi.fn(), clientX: 100, clientY: 100 });
    });
    const attack = target === 'giant' ? mock.attackGiant : mock.attackDummy;
    if (enabled) {
      expect(attack).toHaveBeenCalledExactlyOnceWith(1);
      expect(selected()).toBeNull();
    } else {
      expect(attack).not.toHaveBeenCalled();
      expect(selected().dropdownOptions[0].label).toMatch(/^Attack /);
    }
  });

  it('one-click attacks the training dummy and respects hold release suppression', () => {
    useSettingsStore.setState({ oneClickAttack: true });
    const dummy = { id: 1, x: 28, z: 28, hp: 30, maxHp: 30, lastHitTick: 0 } as any;
    const ui = render(<TrainingDummy dummy={dummy} tick={100} />);
    const target = ui.container.querySelector('[name="training-dummy"]')!;
    holdState.suppressClickUntil = performance.now() + 1000;
    fireEvent.click(target);
    expect(mock.attackDummy).not.toHaveBeenCalled();
    holdState.suppressClickUntil = 0;
    fireEvent.click(target);
    expect(mock.attackDummy).toHaveBeenCalledExactlyOnceWith(1);
    expect(selected()).toBeNull();
    expect(mock.approach).not.toHaveBeenCalled();
  });

  it.each(['giant', 'dummy'])('walks back from Meadows before one-click attacking the %s', target => {
    mock.me = { region: 'settlement' };
    useSettingsStore.setState({ oneClickAttack: true });
    const giant = { ...freshGiant(0), id: 1, state: GiantState.Idle } as any;
    const dummy = { id: 1, x: 28, z: 28, hp: 30, maxHp: 30, lastHitTick: 0 } as any;
    const ui = render(target === 'giant' ? <Giant giant={giant} tick={100} /> : <TrainingDummy dummy={dummy} tick={100} />);
    fireEvent.click(ui.container.querySelector(`[name="${target === 'giant' ? 'giant' : 'training-dummy'}"]`)!);
    const row = target === 'giant' ? giant : dummy;
    const attack = target === 'giant' ? mock.attackGiant : mock.attackDummy;
    expect(mock.approach).toHaveBeenCalledWith({ region: 'bramblewild', x: row.x, z: row.z }, expect.any(Function), target === 'giant' ? GIANT_REACH : 1);
    expect(attack).not.toHaveBeenCalled();
    arrive();
    expect(attack).toHaveBeenCalledExactlyOnceWith(1);
  });
});
