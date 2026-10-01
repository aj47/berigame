import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pending } from '@sim';
import TradeWindow from '../Components/TradeWindow';

const mock = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  me: { pending: 0, combatTarget: undefined } as any,
  trades: [] as any[],
  other: { name: 'Robin' },
  cancel: vi.fn().mockResolvedValue(true),
}));
vi.mock('../spacetime/hooks', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => { mock.listeners.add(listener); return () => { mock.listeners.delete(listener); }; };
  return {
    useMyPlayer: () => useSyncExternalStore(subscribe, () => mock.me),
    useMyIdentityHex: () => 'me',
    useTradeRows: () => useSyncExternalStore(subscribe, () => mock.trades),
    usePlayerByHex: () => mock.other,
    usePlayersByHex: () => new Map([['other', mock.other]]),
    useInventoryRows: () => [],
  };
});
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ cancel: mock.cancel }) }));
const identity = (hex: string) => ({ toHexString: () => hex });
afterEach(cleanup);
beforeEach(() => {
  mock.me = { pending: Pending.Trade, combatTarget: identity('other') };
  mock.trades = [];
  mock.cancel.mockClear();
});

describe('walking to trade feedback', () => {
  it('shows who you are approaching and offers Stop before any trade exists', () => {
    render(<TradeWindow />);
    expect(screen.getByRole('status')).toHaveTextContent('Walking to Robin to trade…');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel walking to trade' }));
    expect(mock.cancel).toHaveBeenCalledOnce();
  });
  it('changes to the outgoing request automatically when the server completes the approach', () => {
    render(<TradeWindow />);
    mock.me = { pending: Pending.None };
    mock.trades = [{ id: 1n, a: identity('me'), b: identity('other'), accepted: false, createdTick: 1 }];
    act(() => { for (const listener of mock.listeners) listener(); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Trade request' })).toHaveTextContent('Waiting for Robin to accept your trade…');
  });
  it('clears the feedback when movement or Stop cancels the queued action', () => {
    render(<TradeWindow />);
    mock.me = { pending: Pending.None };
    act(() => { for (const listener of mock.listeners) listener(); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
