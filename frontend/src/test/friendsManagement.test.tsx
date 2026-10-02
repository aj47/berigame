import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FRIENDS, PlayerState } from '@sim';
import FriendsPanel from '../Components/FriendsPanel';
import { useChatPrefsStore } from '../spacetime/stores/chatPrefsStore';

const mock = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  friends: [] as any[], players: new Map<string, any>(), codes: [] as any[],
  add: vi.fn(), remove: vi.fn(), follow: vi.fn(), createInvite: vi.fn(), show: vi.fn(),
}));
const identity = (hex: string) => ({ toHexString: () => hex });
const player = (hex: string, name: string, online = true) => ({ identity: identity(hex), name, online, state: PlayerState.Alive, region: 'bramblewild', x: 25, z: 25 });
const friend = (hex: string, index: number) => ({ id: BigInt(index), friend: identity(hex) });
const notify = () => act(() => { for (const listener of mock.listeners) listener(); });
vi.mock('../spacetime/hooks', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => { mock.listeners.add(listener); return () => { mock.listeners.delete(listener); }; };
  return {
    useMyPlayer: () => mock.players.get('me'), useMyIdentityHex: () => 'me',
    usePlayersByHex: () => useSyncExternalStore(subscribe, () => mock.players),
    useFriendRows: () => useSyncExternalStore(subscribe, () => mock.friends),
    useInviteCodeRows: () => mock.codes, useMenteeCounts: () => new Map(),
  };
});
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ addFriend: mock.add, removeFriend: mock.remove, follow: mock.follow, createInvite: mock.createInvite }) }));
vi.mock('../spacetime/stores/toastStore', () => ({ useToastStore: (selector: any) => selector({ show: mock.show }) }));
afterEach(cleanup);
beforeEach(() => {
  mock.friends = [friend('willow', 1), friend('orion', 2)];
  mock.players = new Map([
    ['me', player('me', 'AJ')], ['willow', player('willow', 'Willow')], ['orion', player('orion', 'Orion', false)],
    ['casey', player('casey', 'Casey')], ['ash', player('ash', 'Ash', false)],
  ]);
  mock.codes = [];
  for (const fn of [mock.add, mock.remove, mock.follow, mock.createInvite]) fn.mockReset().mockResolvedValue(true);
  mock.show.mockClear();
  useChatPrefsStore.setState({ friends: new Set(), muted: new Set() });
});
const renderFriends = (props: Partial<React.ComponentProps<typeof FriendsPanel>> = {}) => render(<FriendsPanel open onClose={vi.fn()} {...props} />);

describe('Friends management in Chat', () => {
  it('shows the real friend count and management before optional invitations', () => {
    useChatPrefsStore.setState({ friends: new Set(['stale']) });
    const onOpenChat = vi.fn(); renderFriends({ onOpenChat });
    expect(screen.getByRole('button', { name: 'Friends 2' })).toHaveAttribute('aria-pressed', 'true');
    const list = screen.getByRole('list', { name: 'Friends list' });
    expect(within(list).getByRole('button', { name: 'Remove Willow' })).toHaveTextContent('Remove');
    expect(within(list).getByRole('button', { name: 'Remove Orion' })).toHaveTextContent('Remove');
    expect(within(list).getByRole('button', { name: 'Go to Orion' })).toBeDisabled();
    const invite = screen.getByText('Invite a friend').closest('details')!;
    expect(invite.open).toBe(false);
    expect(list.compareDocumentPosition(invite) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Messages' })); expect(onOpenChat).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Invite a friend'));
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' })); expect(mock.createInvite).toHaveBeenCalledOnce();
  });
  it('excludes self and existing friends, and searches offline players by name without adding automatically', async () => {
    renderFriends({ initialAdding: true });
    const list = screen.getByRole('list', { name: 'Players to add' });
    expect(within(list).getByRole('button', { name: 'Add Casey as a friend' })).toBeEnabled();
    for (const name of ['AJ', 'Willow', 'Ash']) expect(within(list).queryByText(name)).not.toBeInTheDocument();
    expect(mock.add).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a player' }), { target: { value: 'aSh' } });
    expect(within(list).getByText('Offline')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Add Ash as a friend' }));
    await waitFor(() => expect(mock.add).toHaveBeenCalledExactlyOnceWith(mock.players.get('ash').identity));
  });
  it('pins a selected chat sender by identity when another player has the same name', () => {
    mock.players = new Map(mock.players).set('casey', player('casey', 'Ash'));
    renderFriends({ initialAdding: true, initialSearch: 'Ash', initialPlayerHex: 'ash' });
    expect(screen.getByRole('searchbox', { name: 'Find a player' })).toHaveValue('Ash');
    expect(screen.getAllByRole('button', { name: 'Add Ash as a friend' })).toHaveLength(1);
    expect(within(screen.getByRole('list', { name: 'Players to add' })).getByText('Offline')).toBeInTheDocument();
    expect(mock.add).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a player' }), { target: { value: 'ash ' } });
    expect(screen.getAllByRole('button', { name: 'Add Ash as a friend' })).toHaveLength(2);
  });
  it('blocks duplicate adds, exposes retry on rejection, and tracks live confirmed rows', async () => {
    let finish!: (accepted: boolean) => void;
    mock.add.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
    renderFriends({ initialAdding: true });
    const add = screen.getByRole('button', { name: 'Add Casey as a friend' });
    fireEvent.click(add); fireEvent.click(add); expect(mock.add).toHaveBeenCalledOnce(); expect(add).toBeDisabled();
    await act(async () => finish(false));
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t add Casey. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry adding Casey' }));
    await waitFor(() => expect(mock.add).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add Casey as a friend' })).not.toBeInTheDocument());
    mock.friends = [...mock.friends, friend('casey', 3)]; notify();
    expect(screen.getByRole('button', { name: 'Friends 3' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' })); expect(screen.getByRole('button', { name: 'Remove Casey' })).toBeInTheDocument();
  });
  it('keeps the friend after failed removal and makes retry explicit', async () => {
    let reject!: (error: Error) => void;
    mock.remove.mockImplementationOnce(() => new Promise<boolean>((_, rejectPromise) => { reject = rejectPromise; }));
    renderFriends(); const remove = screen.getByRole('button', { name: 'Remove Willow' });
    fireEvent.click(remove); fireEvent.click(remove);
    expect(mock.remove).toHaveBeenCalledExactlyOnceWith(mock.friends[0].friend); expect(remove).toBeDisabled();
    await act(async () => reject(new Error('offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t remove Willow. Try again.');
    expect(screen.getByRole('button', { name: 'Friends 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry removing Willow' }));
    await waitFor(() => expect(mock.remove).toHaveBeenCalledTimes(2));
    mock.friends = [friend('orion', 2)]; notify();
    expect(screen.getByRole('button', { name: 'Friends 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Willow' })).not.toBeInTheDocument();
  });
  it('mutes and unmutes locally without removing the friend', () => {
    renderFriends(); fireEvent.click(screen.getByRole('button', { name: 'Mute Willow' }));
    expect(useChatPrefsStore.getState().muted.has('willow')).toBe(true);
    expect(screen.getByRole('button', { name: 'Friends 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unmute Willow' }));
    expect(useChatPrefsStore.getState().muted.has('willow')).toBe(false); expect(mock.remove).not.toHaveBeenCalled();
  });
  it('respects the server friend limit and updates online candidates live', () => {
    mock.friends = Array.from({ length: MAX_FRIENDS }, (_, index) => friend(`friend-${index}`, index));
    renderFriends({ initialAdding: true });
    expect(screen.getByRole('button', { name: 'Add Casey as a friend' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(`Your list is full (${MAX_FRIENDS})`);
    mock.players = new Map([...mock.players].map(([hex, p]) => [hex, hex === 'casey' ? { ...p, online: false } : p])); notify();
    expect(screen.queryByRole('button', { name: 'Add Casey as a friend' })).not.toBeInTheDocument(); expect(mock.add).not.toHaveBeenCalled();
  });
  it('follows an available friend while keeping dead and offline friends from starting a walk', async () => {
    const onClose = vi.fn();
    mock.players = new Map(mock.players).set('willow', { ...mock.players.get('willow'), state: PlayerState.Dead });
    renderFriends({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Go to Orion' })); fireEvent.click(screen.getByRole('button', { name: 'Go to Willow' }));
    expect(mock.follow).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    mock.players = new Map(mock.players).set('willow', { ...mock.players.get('willow'), state: PlayerState.Alive }); notify();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Willow' }));
    expect(mock.follow).toHaveBeenCalledExactlyOnceWith(mock.friends[0].friend);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
  it('keeps Friends open after a rejected walk and retries without duplicate requests', async () => {
    const onClose = vi.fn();
    mock.follow.mockResolvedValueOnce(false);
    renderFriends({ onClose });
    const go = screen.getByRole('button', { name: 'Go to Willow' });
    fireEvent.click(go); fireEvent.click(go);
    expect(mock.follow).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t reach Willow. Try again.'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry going to Willow' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mock.follow).toHaveBeenCalledTimes(2);
  });
  it('shows the correct region and disables walking to a friend in another region', () => {
    mock.players = new Map(mock.players).set('willow', { ...mock.players.get('willow'), region: 'settlement' });
    renderFriends();
    const go = screen.getByRole('button', { name: 'Go to Willow' });
    expect(go).toBeDisabled();
    expect(go).toHaveAttribute('title', 'Travel to Bramblewild Meadows to meet them');
    expect(screen.getByRole('list', { name: 'Friends list' })).toHaveTextContent('Online · Bramblewild Meadows');
    fireEvent.click(go);
    expect(mock.follow).not.toHaveBeenCalled();
  });
});
