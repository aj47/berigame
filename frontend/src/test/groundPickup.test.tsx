import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState } from '@sim';
import ClickDropdown from '../Components/ClickDropdown';
import { useUserInputStore } from '../store';

const mock = vi.hoisted(() => ({
  items: [] as any[], tick: 100, players: new Map<string, any>(),
  pickupItem: vi.fn(), attack: vi.fn(), follow: vi.fn(), setTarget: vi.fn(),
}));
vi.mock('../spacetime/hooks', () => ({
  useGroundItems: () => mock.items, useTick: () => mock.tick,
  usePlayersByHex: () => mock.players, useMyIdentityHex: () => 'me',
}));
vi.mock('../frontier/useFrontier', () => ({ useFrontier: () => ({ plots: [] }) }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => mock }));
const tile = { x: 25, z: 25 };
const pile = (id: bigint, itemId: string, quantity: number, at = tile) => ({ id, itemId, quantity, ...at, expiresTick: 600 });
const selection = (extra = {}) => ({
  connectionId: 'Willow', playerChoices: ['willow'], playerHex: 'willow',
  groundTiles: [{ ...tile }], walkTile: { x: 28, z: 30 }, e: { clientX: 120, clientY: 120 }, ...extra,
});
function open(extra = {}) {
  useUserInputStore.getState().setClickedOtherObject(selection(extra));
  return render(<ClickDropdown />);
}
beforeEach(() => {
  mock.items = [pile(1n, 'berry_blueberry', 3), pile(2n, 'stick', 1), pile(3n, 'flint', 2, { x: 28, z: 30 })];
  mock.tick = 100;
  mock.players = new Map(['me', 'willow', 'orion'].map(hex => [hex, { name: hex === 'willow' ? 'Willow' : hex === 'orion' ? 'Orion' : 'Me', identity: { toHexString: () => hex }, online: true, state: PlayerState.Alive, ...tile }]));
  vi.clearAllMocks(); mock.pickupItem.mockReset().mockResolvedValue(true);
  useUserInputStore.getState().setClickedOtherObject(null);
});
afterEach(cleanup);

describe('ground pickup through a player menu', () => {
  it('offers each pile under the avatar, independently of the projected Walk here tile', async () => {
    open();
    expect(screen.getByRole('button', { name: 'Pick up 3× Blueberry' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pick up 1× Stick' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Flint/ })).not.toBeInTheDocument();
    expect(mock.pickupItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pick up 3× Blueberry' }));
    await waitFor(() => expect(mock.pickupItem).toHaveBeenCalledExactlyOnceWith(1n));
    expect(mock.attack).not.toHaveBeenCalled(); expect(mock.follow).not.toHaveBeenCalled(); expect(mock.setTarget).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('group')).not.toBeInTheDocument());
  });

  it('keeps Walk here separate from collecting items', () => {
    open(); fireEvent.click(screen.getByRole('button', { name: 'Walk here' }));
    expect(mock.setTarget).toHaveBeenCalledExactlyOnceWith(28, 30);
    expect(mock.pickupItem).not.toHaveBeenCalled();
  });

  it('shows pickups before and after choosing between overlapping players, without duplicates', () => {
    open({ playerChoices: ['willow', 'orion'], playerHex: undefined, groundTiles: [tile, tile] });
    expect(screen.getAllByRole('button', { name: 'Pick up 3× Blueberry' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Orion' }));
    expect(screen.getByRole('button', { name: 'Pick up 3× Blueberry' })).toBeVisible();
    expect(mock.pickupItem).not.toHaveBeenCalled();
  });

  it('keeps the ground location fixed when the selected player moves or leaves', () => {
    const { rerender } = open();
    mock.players.set('willow', { ...mock.players.get('willow'), x: 28, z: 30 }); rerender(<ClickDropdown />);
    expect(screen.getByRole('button', { name: 'Pick up 3× Blueberry' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Flint/ })).not.toBeInTheDocument();
    mock.players.delete('willow'); rerender(<ClickDropdown />);
    expect(screen.getByRole('button', { name: 'Pick up 3× Blueberry' })).toBeVisible();
  });

  it('updates quantity, removes collected or expired piles, and shows newly dropped items', () => {
    const { rerender } = open();
    mock.items = [pile(1n, 'berry_blueberry', 1), pile(4n, 'driftwood', 2)]; rerender(<ClickDropdown />);
    expect(screen.getByRole('button', { name: 'Pick up 1× Blueberry' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pick up 2× Driftwood' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Stick/ })).not.toBeInTheDocument();
    mock.tick = 600; rerender(<ClickDropdown />);
    expect(screen.queryByRole('button', { name: /Pick up/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Walk here' })).toBeVisible();
  });

  it('shows separate stacks of the same item and sends the selected pile ID', async () => {
    mock.items = [pile(1n, 'berry_blueberry', 3), pile(2n, 'berry_blueberry', 5)];
    open(); fireEvent.click(screen.getByRole('button', { name: 'Pick up 5× Blueberry' }));
    await waitFor(() => expect(mock.pickupItem).toHaveBeenCalledExactlyOnceWith(2n));
  });

  it('blocks duplicate requests and retains a failed pickup for retry', async () => {
    let finish!: (ok: boolean) => void;
    mock.pickupItem.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
    open(); const button = screen.getByRole('button', { name: 'Pick up 3× Blueberry' });
    fireEvent.click(button); fireEvent.click(button);
    expect(mock.pickupItem).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Stick/ })).toBeDisabled();
    await act(async () => finish(false));
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t pick that up. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry pickup 3× Blueberry' }));
    await waitFor(() => expect(mock.pickupItem).toHaveBeenCalledTimes(2));
  });

  it('does not close a newly opened menu when an older pickup completes', async () => {
    let finish!: (ok: boolean) => void;
    mock.pickupItem.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
    open(); fireEvent.click(screen.getByRole('button', { name: 'Pick up 3× Blueberry' }));
    act(() => useUserInputStore.getState().setClickedOtherObject({ connectionId: 'Other menu', dropdownOptions: [] }));
    await act(async () => finish(true));
    expect(screen.getByRole('group', { name: 'Actions for Other menu' })).toBeVisible();
  });

  it('gives direct ground-item clicks the same live actions and handles disappearance', () => {
    const { rerender } = open({ connectionId: 'Blueberry', playerChoices: undefined, playerHex: undefined, groundItemId: 1n });
    expect(screen.getAllByRole('button', { name: /Pick up/ })).toHaveLength(2);
    mock.items = []; rerender(<ClickDropdown />);
    expect(screen.queryByRole('button', { name: /Pick up/ })).not.toBeInTheDocument();
    expect(screen.getByText('Items no longer here.')).toBeVisible();
  });
});
