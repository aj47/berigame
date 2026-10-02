import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pending } from '@sim';
import TradeWindow from '../Components/TradeWindow';

const mock = vi.hoisted(() => ({
  listeners: new Set<() => void>(), me: {} as any, trades: [] as any[], inventory: [] as any[],
  offer: vi.fn(), confirm: vi.fn(), unwield: vi.fn(),
}));
const identity = (hex: string) => ({ toHexString: () => hex });
const notify = () => act(() => { for (const listener of mock.listeners) listener(); });
const serverOffer = (offer: string, side: 'a' | 'b' = 'a') => {
  mock.trades = [{ ...mock.trades[0], [side === 'a' ? 'aOffer' : 'bOffer']: offer }]; notify();
};
vi.mock('../spacetime/hooks', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => { mock.listeners.add(listener); return () => { mock.listeners.delete(listener); }; };
  return {
    useMyPlayer: () => mock.me, useMyIdentityHex: () => 'me',
    useTradeRows: () => useSyncExternalStore(subscribe, () => mock.trades),
    useInventoryRows: () => mock.inventory,
    usePlayersByHex: () => new Map([['other', { name: 'Willow' }]]), usePlayerByHex: () => ({ name: 'Willow' }),
  };
});
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ setTradeOffer: mock.offer, confirmTrade: mock.confirm, unwield: mock.unwield }) }));
afterEach(cleanup);
beforeEach(() => {
  mock.me = { identity: identity('me'), pending: Pending.None, weapon: 'stick' };
  mock.trades = [{ id: 7n, a: identity('me'), b: identity('other'), accepted: true, createdTick: 1, aOffer: '', bOffer: 'flint:3', aCoins: 12, bCoins: 34, aConfirmed: false, bConfirmed: false }];
  mock.inventory = [0, 4, 5].map(slot => ({ slot, itemId: 'stick', quantity: 1 }));
  for (const action of [mock.offer, mock.confirm, mock.unwield]) action.mockReset().mockResolvedValue(true);
});

describe('trading equipped items', () => {
  it('offers the equipped weapon and tracks remaining and offered copies without unwielding', async () => {
    render(<TradeWindow />);
    const stick = screen.getByRole('button', { name: 'Offer one Stick' });
    expect(stick).toBeEnabled(); expect(stick).toHaveTextContent('Equipped'); expect(stick).toHaveTextContent('×3');
    expect(stick).toHaveAttribute('title', 'Offer one Stick');
    fireEvent.click(stick);
    await waitFor(() => expect(mock.offer).toHaveBeenCalledExactlyOnceWith(7n, 'stick:1'));
    serverOffer('stick:1');
    expect(screen.getByRole('button', { name: 'Offer one Stick' })).toHaveTextContent('×2');
    const offered = within(screen.getByTestId('my-offer')).getByRole('button', { name: 'Take back one Stick' });
    expect(offered).toHaveTextContent('×1');
    await waitFor(() => expect(stick).toBeEnabled()); fireEvent.click(stick);
    await waitFor(() => expect(mock.offer).toHaveBeenLastCalledWith(7n, 'stick:2'));
    serverOffer('stick:2');
    expect(screen.getByRole('button', { name: 'Offer one Stick' })).toHaveTextContent('×1');
    expect(within(screen.getByTestId('my-offer')).getByRole('button', { name: 'Take back one Stick' })).toHaveTextContent('×2');
    expect(mock.unwield).not.toHaveBeenCalled(); expect(mock.me.weapon).toBe('stick');
  });

  it.each(['a', 'b'] as const)('confirms the exact live offers and coins while side %s has a weapon equipped', async side => {
    if (side === 'a') mock.trades[0].aOffer = 'stick:2';
    else mock.trades[0] = { ...mock.trades[0], a: identity('other'), b: identity('me'), aOffer: 'flint:3', bOffer: 'stick:2' };
    render(<TradeWindow />);
    fireEvent.change(screen.getByLabelText('Coins to offer'), { target: { value: '999' } });
    const confirm = screen.getByRole('button', { name: 'Confirm trade' }); expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledExactlyOnceWith(7n, mock.trades[0].aOffer, mock.trades[0].bOffer, 12, 34));
    expect(mock.unwield).not.toHaveBeenCalled(); expect(mock.me.weapon).toBe('stick');
  });

  it('still blocks a second offer and confirmation while an offer is pending', async () => {
    let finish!: (accepted: boolean) => void;
    mock.offer.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
    render(<TradeWindow />);
    const stick = screen.getByRole('button', { name: 'Offer one Stick' });
    fireEvent.click(stick); fireEvent.click(stick);
    expect(mock.offer).toHaveBeenCalledOnce(); expect(stick).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm trade' })).toBeDisabled();
    await act(async () => finish(false));
    expect(stick).toBeEnabled(); expect(mock.unwield).not.toHaveBeenCalled();
  });

  it('respects the distinct item limit while allowing more copies of an already offered equipped item', () => {
    const otherItems = ['berry_blueberry', 'berry_greenberry', 'berry_strawberry', 'berry_goldberry', 'driftwood', 'flint', 'obsidian', 'berry_mash'];
    mock.inventory.push(...otherItems.map((itemId, index) => ({ slot: index + 6, itemId, quantity: 1 })));
    mock.trades[0].aOffer = otherItems.map(item => `${item}:1`).join(',');
    render(<TradeWindow />);
    expect(screen.getByRole('button', { name: 'Offer one Stick' })).toBeDisabled();
    serverOffer([...otherItems.slice(0, 7).map(item => `${item}:1`), 'stick:1'].join(','));
    expect(screen.getByRole('button', { name: 'Offer one Stick' })).toBeEnabled();
    expect(mock.offer).not.toHaveBeenCalled(); expect(mock.unwield).not.toHaveBeenCalled();
  });
});
