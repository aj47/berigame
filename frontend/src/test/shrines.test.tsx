import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProfile } from '../../../shared/sim/frontier/model';
import ShrinesPanel from '../frontier/ShrinesPanel';
import IslandShrines3D from '../frontier/IslandShrines3D';
import { holdState } from '../Components/3D/tapAssist';

const mock = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../frontier/navigation', () => ({ openSettlement: mock.open }));
vi.mock('@react-three/drei', () => ({ Html: () => null }));
beforeEach(() => { vi.clearAllMocks(); holdState.active = false; holdState.suppressClickUntil = 0; });
afterEach(cleanup);

function panel(patch = {}) {
  const props = { profile: newProfile('a'), me: { region: 'reedwake' as const, x: 8, z: 64 },
    bag: [{ itemId: 'reeds', quantity: 8 }, { itemId: 'resin', quantity: 4 }], busy: false, aboard: false, onAction: vi.fn(), ...patch };
  return { props, ...render(<ShrinesPanel {...props} />) };
}
describe('island shrine controls', () => {
  it('shows materials and submits the restoration only beside the shrine', () => {
    const { props } = panel();
    expect(screen.getByText('Reeds · 8/8')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Restore Reedwake Tide Shrine · +5% XP' }));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ action: 'restore_shrine', id: 'reedwake' });
    expect(screen.getByRole('button', { name: 'Restore Cinder Ember Shrine · +5% XP' })).toBeDisabled();
  });
  it('offers a walk on the same island and explains the voyage to the other island', () => {
    const { props } = panel({ me: { region: 'reedwake', x: 20, z: 64 } });
    expect(screen.getByRole('button', { name: 'Restore Reedwake Tide Shrine · +5% XP' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Walk to Reedwake Tide Shrine' }));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ action: 'move', x: 8, z: 64 });
    expect(screen.getByText(/Sail to Cinder Shoal/)).toBeVisible();
  });
  it.each([{ bag: [] }, { aboard: true }, { busy: true }])('disables unavailable restoration: %j', patch => {
    panel(patch); expect(screen.getByRole('button', { name: 'Restore Reedwake Tide Shrine · +5% XP' })).toBeDisabled();
  });
  it('shows an earned permanent bonus without a repeat restoration button', () => {
    const profile = newProfile('a'); profile.events['shrine:reedwake'] = 1;
    panel({ profile });
    expect(screen.getByText('Your permanent bonus: +5% discipline XP')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Restore Reedwake Tide Shrine · +5% XP' })).not.toBeInTheDocument();
  });
  it('opens the shrine section through assisted world clicks and preserves right-drag/build guards', () => {
    const ui = render(<IslandShrines3D region="reedwake" profile={newProfile('a')} showLabels={false} disabled={false} />);
    const props = () => {
      const group = ui.container.querySelector('group') as any;
      return group[Object.keys(group).find(key => key.startsWith('__reactProps$'))!];
    };
    expect(props().userData.hoverTarget.title).toBe('Reedwake Tide Shrine');
    act(() => props().onClick({ delta: 0, stopPropagation: vi.fn() }));
    expect(mock.open).toHaveBeenCalledExactlyOnceWith('Harbour');
    act(() => props().onClick({ delta: 0, button: 2, stopPropagation: vi.fn() }));
    ui.rerender(<IslandShrines3D region="reedwake" profile={newProfile('a')} showLabels={false} disabled />);
    act(() => props().onClick({ delta: 0, button: 0, stopPropagation: vi.fn() }));
    expect(mock.open).toHaveBeenCalledOnce();
  });
});
