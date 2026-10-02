import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatBox from '../Components/ChatBox';
import { useChatPrefsStore } from '../spacetime/stores/chatPrefsStore';

const mock = vi.hoisted(() => ({ rows: [] as any[], players: new Map<string, any>(), messages: [] as any[], sendChat: vi.fn().mockResolvedValue(true), setName: vi.fn(), focus: vi.fn() }));
vi.mock('../spacetime/hooks', () => ({
  useChatMessages: () => mock.messages, useFriendRows: () => mock.rows,
  useMyIdentityHex: () => 'me', useMyPlayer: () => ({ x: 20, z: 20 }), usePlayersByHex: () => mock.players,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => mock }));
vi.mock('../store', () => ({ useChatStore: (selector: any) => selector({ setFocusedChat: mock.focus }) }));
vi.mock('../spacetime/stores/giantStore', () => ({ useGiantStore: (selector: any) => selector({ systemLines: [] }) }));
const identity = (hex: string) => ({ toHexString: () => hex });
beforeEach(() => {
  mock.rows = [{ friend: identity('friend') }];
  mock.players = new Map([['me', { name: 'AJ' }], ['friend', { name: 'Willow' }], ['new', { name: 'Casey', online: true }], ['offline', { name: 'Ash', online: false }]]);
  mock.messages = ['me', 'friend', 'new', 'offline'].map((hex, i) => ({ id: BigInt(i), sender: identity(hex), text: 'Hello', x: 20, z: 20 }));
  useChatPrefsStore.setState({ mode: 'all', muted: new Set(), friends: new Set() });
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('friend actions in Chat', () => {
  it('makes the list and add-player search separate, visible actions', () => {
    const openFriends = vi.fn();
    render(<ChatBox open onClose={() => {}} onOpenFriends={openFriends} />);
    expect(screen.getByRole('navigation', { name: 'Chat and friends' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Messages' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Friends 1' }));
    expect(openFriends).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    expect(openFriends).toHaveBeenLastCalledWith(true);
  });

  it('opens the right sender in the friend finder, including offline chat participants', () => {
    const openFriends = vi.fn();
    render(<ChatBox open onClose={() => {}} onOpenFriends={openFriends} />);
    fireEvent.click(screen.getByRole('button', { name: 'Casey' }));
    expect(openFriends).toHaveBeenLastCalledWith(true, 'Casey', 'new');
    fireEvent.click(screen.getByRole('button', { name: 'Ash' }));
    expect(openFriends).toHaveBeenLastCalledWith(true, 'Ash', 'offline');
    expect(screen.queryByRole('button', { name: 'AJ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Willow' })).not.toBeInTheDocument();
    expect(mock.sendChat).not.toHaveBeenCalled();
  });

  it('updates friendship affordances from live rows and preserves the chat draft between panels', () => {
    const openFriends = vi.fn();
    const { rerender } = render(<ChatBox open onClose={() => {}} onOpenFriends={openFriends} />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Meet at camp' } });
    rerender(<ChatBox open={false} onClose={() => {}} onOpenFriends={openFriends} />);
    mock.rows = [...mock.rows, { friend: identity('new') }];
    rerender(<ChatBox open onClose={() => {}} onOpenFriends={openFriends} />);
    expect(screen.getByRole('button', { name: 'Friends 2' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Casey' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('Meet at camp');
  });
});
