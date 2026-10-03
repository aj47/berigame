import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState } from '@sim';
import ClickDropdown from '../Components/ClickDropdown';
import { useUserInputStore } from '../store';
import { useChatPrefsStore } from '../spacetime/stores/chatPrefsStore';
import { useToastStore } from '../spacetime/stores/toastStore';

const mock = vi.hoisted(() => ({
  players: new Map<string, any>(), plots: [] as any[],
  attack: vi.fn(), follow: vi.fn(), requestTrade: vi.fn(), addFriend: vi.fn(),
}));
vi.mock('../spacetime/hooks', () => ({ usePlayersByHex: () => mock.players, useMyIdentityHex: () => 'self', useTick: () => 100 }));
vi.mock('../frontier/useFrontier', () => ({ useFrontier: () => ({ plots: mock.plots }) }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => mock }));
const identity = (hex: string) => ({ toHexString: () => hex });
function open(hex?: string, choices = ['front', 'back']) {
  useUserInputStore.getState().setClickedOtherObject({ connectionId: hex ? mock.players.get(hex).name : 'Choose player', playerChoices: choices, playerHex: hex, e: { clientX: 100, clientY: 100 } });
  return render(<ClickDropdown />);
}
beforeEach(() => {
  mock.players = new Map(['front', 'back', 'self'].map(hex => [hex, { identity: identity(hex), name: `${hex} player`, online: true, state: PlayerState.Alive, x: 40, z: 25, region: 'bramblewild', hp: 30, maxHp: 30, respawnTick: 0 }]));
  mock.plots = [];
  for (const action of [mock.attack, mock.follow, mock.requestTrade]) action.mockReset().mockResolvedValue(true);
  mock.addFriend.mockClear();
  useChatPrefsStore.setState({ friends: new Set(), muted: new Set() });
  useUserInputStore.getState().setClickedOtherObject(null);
});
afterEach(cleanup);

describe('player picker and actions', () => {
  it.each([['front', 'Follow', 'follow'], ['back', 'Trade', 'requestTrade'], ['back', 'Attack', 'attack']] as const)('chooses %s and sends %s only to that identity', async (hex, label, action) => {
    open();
    expect(screen.getByRole('group', { name: 'Choose player' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attack' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `${hex} player` }));
    expect(mock.attack).not.toHaveBeenCalled(); expect(mock.follow).not.toHaveBeenCalled(); expect(mock.requestTrade).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: `Actions for ${hex} player` })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: label })));
    expect(mock[action]).toHaveBeenCalledExactlyOnceWith(mock.players.get(hex).identity);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
  it('lets you switch people before taking an action', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'front player' }));
    fireEvent.click(screen.getByRole('button', { name: '← Choose another player' }));
    fireEvent.click(screen.getByRole('button', { name: 'back player' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mute chat' }));
    expect(useChatPrefsStore.getState().muted).toEqual(new Set(['back']));
  });
  it('keeps Add friend out of the world menu and uses live mute preferences', () => {
    open('back', ['back']);
    expect(screen.queryByRole('button', { name: '← Choose another player' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add friend' })).not.toBeInTheDocument();
    act(() => useChatPrefsStore.setState({ friends: new Set(['back']), muted: new Set(['back']) }));
    expect(screen.queryByRole('button', { name: 'Add friend' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unmute chat' }));
    expect(useChatPrefsStore.getState().muted.has('back')).toBe(false);
  });
  it('removes unavailable choices without silently selecting a different player', () => {
    const { rerender } = open(undefined, ['self', 'front', 'back']);
    expect(screen.queryByRole('button', { name: 'self player' })).not.toBeInTheDocument();
    mock.players.get('front').online = false; rerender(<ClickDropdown />);
    expect(screen.queryByRole('button', { name: 'front player' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'back player' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trade' })).not.toBeInTheDocument();
    mock.players.get('back').state = PlayerState.Dead; rerender(<ClickDropdown />);
    expect(screen.getByText('These players are no longer available.')).toBeInTheDocument();
  });
  it('removes actions if the selected player leaves, while letting you return to the remaining choices', () => {
    const { rerender } = open('front');
    mock.players.delete('front'); rerender(<ClickDropdown />);
    expect(screen.getByText('This player is no longer available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trade' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '← Choose another player' }));
    expect(screen.getByRole('button', { name: 'back player' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('uses the same targeted Attack, Follow and Trade menu in Meadows', async () => {
    for (const row of mock.players.values()) Object.assign(row, { region: 'settlement', x: 116, z: 106 });
    open('back', ['back']);
    expect(screen.queryByText('Wildlife')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Trade' })).toBeEnabled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Attack' })));
    expect(mock.attack).toHaveBeenCalledExactlyOnceWith(mock.players.get('back').identity);
  });

  it('explains town protection before attempting an attack and keeps social actions available', () => {
    for (const row of mock.players.values()) Object.assign(row, { region: 'settlement', x: 31, z: 64 });
    open('back', ['back']);
    expect(screen.getByRole('button', { name: 'Attack' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Attack' })).toHaveAccessibleDescription(/town/i);
    expect(screen.getByRole('button', { name: 'Follow' })).toBeEnabled();
    expect(mock.attack).not.toHaveBeenCalled();
  });

  it('keeps the exact server rejection visible for retry instead of dismissing the player menu', async () => {
    mock.attack.mockImplementation(async () => { useToastStore.getState().show('Combat is not enabled for this character'); return false; });
    open('back', ['back']);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Attack' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Combat is not enabled for this character');
    expect(screen.getByRole('group', { name: 'Actions for back player' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attack' })).toBeEnabled();
  });

  it('does not let a slow successful action dismiss another player menu', async () => {
    let resolve!: (success: boolean) => void;
    mock.attack.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    open('front');
    fireEvent.click(screen.getByRole('button', { name: 'Attack' }));
    fireEvent.click(screen.getByRole('button', { name: '← Choose another player' }));
    fireEvent.click(screen.getByRole('button', { name: 'back player' }));
    await act(async () => resolve(true));
    expect(screen.getByRole('group', { name: 'Actions for back player' })).toBeInTheDocument();
  });
});
