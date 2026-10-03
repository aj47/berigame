import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frontierSnapshot } from '../../../shared/sim/frontier/snapshot';
import BankStoragePanel from '../frontier/BankStoragePanel';
import { WORLD_INTERACTION } from '../frontier/worldInteraction';

const mock = vi.hoisted(() => ({ player: null as any, rows: [] as any[], players: [] as any[], frontier: vi.fn(), setTarget: vi.fn(), requestTrade: vi.fn() }));
vi.mock('../spacetime/hooks', () => ({ useMyPlayer: () => mock.player, useInventoryRows: () => mock.rows, usePlayers: () => mock.players }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => mock }));
const identity = { toHexString: () => 'me' };
const snapshot = () => frontierSnapshot([{ kind: 'config', data: JSON.stringify({ enabled: true }) }], [], 'me', Date.now());
beforeEach(() => {
  vi.clearAllMocks(); mock.frontier.mockReset().mockResolvedValue(true);
  mock.player = { identity, region: 'settlement', x: 31, z: 64, hp: 20, state: 0 };
  mock.rows = [{ owner: identity, slot: 0, itemId: 'timber', quantity: 12 }];
  mock.players = [];
});
afterEach(cleanup);

describe('personal bank and existing storage', () => {
  it('opens the protected personal bank with 48 slots and transfers stacks through the existing vault', async () => {
    const state = snapshot();
    state.containers = [{ id: 'vault-me', owner: 'me', slots: [{ itemId: 'cloth', quantity: 3 }, ...Array(5).fill(null)] }];
    render(<BankStoragePanel state={state} onBag={() => {}} onTravel={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Storage location' })).toHaveValue('vault-me');
    expect(screen.getByText('1/48 slots')).toBeVisible();
    expect(screen.getByText(/Stored items stay safe when you are defeated or your plot is captured/)).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Deposit 12 Timber' })));
    expect(mock.frontier).toHaveBeenLastCalledWith({ action: 'container', id: 'vault-me', target: 'deposit', item: 'timber', quantity: 12 });
    expect(screen.getByRole('status')).toHaveTextContent('Deposited 12 Timber.');
    fireEvent.change(screen.getByRole('combobox', { name: 'Transfer amount' }), { target: { value: '5' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Withdraw 3 Cloth' })));
    expect(mock.frontier).toHaveBeenLastCalledWith({ action: 'container', id: 'vault-me', target: 'withdraw', item: 'cloth', quantity: 3 });
  });

  it.each(['bramblewild', 'settlement'])('offers walking from %s and gates transfers until reaching town', async region => {
    mock.player = { ...mock.player, region, x: 10, z: 10 };
    const onTravel = vi.fn();
    render(<BankStoragePanel state={snapshot()} onBag={() => {}} onTravel={onTravel} />);
    expect(screen.getByRole('button', { name: 'Deposit 12 Timber' })).toBeDisabled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Walk to bank' })));
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'settlement', x: 31, z: 64 });
    expect(onTravel).toHaveBeenCalledOnce();
  });

  it('shows travel guidance on another island without offering an impossible walk', () => {
    mock.player.region = 'reedwake';
    render(<BankStoragePanel state={snapshot()} onBag={() => {}} onTravel={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Walk to bank' })).not.toBeInTheDocument();
    expect(screen.getByText('Sail to Driftwood Harbour, then take the Meadows trail to town.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deposit 12 Timber' })).toBeDisabled();
  });

  it('keeps a failed walk open and surfaces failed transfers for retry', async () => {
    const onTravel = vi.fn();
    mock.player.x = 10;
    mock.frontier.mockResolvedValueOnce(false);
    const view = render(<BankStoragePanel state={snapshot()} onBag={() => {}} onTravel={onTravel} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Walk to bank' })));
    expect(onTravel).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not complete that action');
    mock.player = { ...mock.player, x: 31 };
    view.rerender(<BankStoragePanel state={snapshot()} onBag={() => {}} onTravel={onTravel} />);
    mock.frontier.mockRejectedValueOnce(new Error('Bag is full'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Deposit 12 Timber' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Bag is full');
    expect(screen.getByRole('button', { name: 'Deposit 12 Timber' })).toBeEnabled();
  });

  it('prevents duplicate transfers while a request is pending', async () => {
    let resolve!: (value: boolean) => void;
    mock.frontier.mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
    render(<BankStoragePanel state={snapshot()} onBag={() => {}} onTravel={() => {}} />);
    const button = screen.getByRole('button', { name: 'Deposit 12 Timber' });
    fireEvent.click(button); fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Storage location' })).toBeDisabled();
    expect(mock.frontier).toHaveBeenCalledOnce();
    await act(async () => resolve(true));
    expect(button).toBeEnabled();
  });

  it('keeps chest storage reachable without promising personal-bank protection', async () => {
    const state = snapshot();
    state.containers.push({ id: 'chest-1', owner: 'me', claim: 'settlement-1', slots: [{ itemId: 'cloth', quantity: 2 }] });
    state.buildings.push({ id: 'chest-1', region: 'settlement', x: 10, z: 10, claim: 'settlement-1', piece: 'chest', rotation: 0, label: 'Workshop chest' });
    const onTravel = vi.fn();
    render(<BankStoragePanel state={state} onBag={() => {}} onTravel={onTravel} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Storage location' }), { target: { value: 'chest-1' } });
    expect(screen.getByText(/Chest, boat and companion storage use their own access rules/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Withdraw 2 Cloth' })).toBeDisabled();
    expect(within(screen.getByRole('region', { name: 'Stored items' })).getByText('1/1 slots')).toBeVisible();
    const approach = vi.fn();
    window.addEventListener(WORLD_INTERACTION, approach);
    fireEvent.click(screen.getByRole('button', { name: 'Walk to storage' }));
    window.removeEventListener(WORLD_INTERACTION, approach);
    expect(approach).toHaveBeenCalledOnce();
    expect(approach.mock.calls[0][0].detail).toMatchObject({ location: { region: 'settlement', x: 10, z: 10 }, radius: 2 });
    expect(mock.frontier).not.toHaveBeenCalled();
  });
});
