import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEDGER_CLERK, LEDGER_CLERKS, LEDGER_DAY_MS, LEDGER_SEAL_ITEM_ID, getItemDef, ledgerFor, xpForLevel } from '@sim';
import LedgerPanel, { formatReset, moreOf } from '../Components/LedgerPanel';

const HEX = 'c0ffee'.padEnd(64, '0');
// Day 20000, 5h 30m before the reset.
const NOW = 20_001 * LEDGER_DAY_MS - (5 * 60 + 30) * 60_000;
const mock = vi.hoisted(() => ({
  me: null as any,
  skills: null as any,
  rows: [] as any[],
  ledger: undefined as any,
  deliverCommission: vi.fn(async (_slot: number) => true as boolean),
  setTarget: vi.fn(),
  toast: null as string | null,
}));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.me,
  useMyIdentityHex: () => HEX,
  useMySkills: () => mock.skills,
  useInventoryRows: () => mock.rows,
  useLedger: () => mock.ledger,
  useNow: () => NOW,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => mock }));
vi.mock('../spacetime/stores/toastStore', () => ({ useToastStore: { getState: () => ({ message: mock.toast }) } }));

const levels = [1, 1, 1];
const today = () => ledgerFor(HEX, 20_000, levels, mock.ledger);
const carry = (itemId: string, quantity: number, slot = 0) => ({ slot, itemId, quantity });
const card = (slot: number) => screen.getByRole('list', { name: "Today's commissions" }).querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
const nameOf = (slot: number) => getItemDef(today()[slot].itemId)!.name;

beforeEach(() => {
  vi.clearAllMocks();
  mock.me = { x: LEDGER_CLERK.x, z: LEDGER_CLERK.z };
  mock.skills = { foragingXp: 0, beachcombingXp: 0, craftingXp: xpForLevel(1) };
  mock.rows = [];
  mock.ledger = undefined;
  mock.toast = null;
  mock.deliverCommission.mockImplementation(async () => true);
});
afterEach(cleanup);

describe('Island Ledger panel', () => {
  it("renders today's three commissions with rewards, carried counts, seals and the reset timer", () => {
    mock.rows = [carry(LEDGER_SEAL_ITEM_ID, 4, 5)];
    render(<LedgerPanel open onClose={() => {}} />);
    const list = screen.getByRole('list', { name: "Today's commissions" });
    expect(list.querySelectorAll('article[role=listitem]')).toHaveLength(3);
    for (const c of today()) {
      const item = getItemDef(c.itemId)!;
      const el = within(card(c.slot));
      expect(el.getByRole('heading', { name: new RegExp(`${item.name}`) })).toHaveTextContent(`×${c.quantity}`);
      expect(el.getByText(new RegExp(`\\+${c.xp} \\w+ XP`))).toBeInTheDocument();
      expect(el.getByLabelText(`${item.name}: 0 carried, ${c.quantity} needed`)).toBeInTheDocument();
      expect(card(c.slot).querySelector('img')).toHaveAttribute('src', item.icon);
    }
    expect(screen.getByLabelText('4 ledger seals')).toBeInTheDocument();
    expect(screen.getByText('New commissions in 5h 30m')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Island Ledger/ })).toHaveTextContent('0/3 today');
  });

  it('explains why a slot cannot be handed in: too few items, or away from the clerk', () => {
    const c = today()[0];
    mock.rows = [carry(c.itemId, 1)];
    mock.me = { x: LEDGER_CLERK.x + 20, z: LEDGER_CLERK.z };
    const { rerender } = render(<LedgerPanel open onClose={() => {}} />);
    expect(within(card(0)).getByText(`You need ${moreOf(c.quantity - 1, nameOf(0))}`)).toBeInTheDocument();
    expect(within(card(0)).getByRole('button', { name: `Hand in ${nameOf(0)}` })).toBeDisabled();
    mock.rows = [carry(c.itemId, c.quantity)];
    rerender(<LedgerPanel open onClose={() => {}} />);
    expect(within(card(0)).getByText('Bring it to the Sunberry Market clerk')).toBeInTheDocument();
    expect(within(card(0)).getByRole('button', { name: `Hand in ${nameOf(0)}` })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Walk to the Sunberry Market clerk' }));
    expect(mock.setTarget).toHaveBeenCalledExactlyOnceWith(LEDGER_CLERK.x, LEDGER_CLERK.z);
  });

  it('offers the nearest clerk on the mainland and hands in beside it', () => {
    const c = today()[0];
    const crossroads = LEDGER_CLERKS.find((k) => k.id === 'crossroads')!;
    mock.rows = [carry(c.itemId, c.quantity)];
    mock.me = { x: crossroads.x + 10, z: crossroads.z };
    const { rerender } = render(<LedgerPanel open onClose={() => {}} />);
    expect(within(card(0)).getByText('Bring it to the Crossroads clerk')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Walk to the Crossroads clerk' }));
    expect(mock.setTarget).toHaveBeenCalledExactlyOnceWith(crossroads.x, crossroads.z);
    mock.me = { x: crossroads.x + 2, z: crossroads.z };
    rerender(<LedgerPanel open onClose={() => {}} />);
    expect(within(card(0)).getByText('Ready to hand in')).toBeInTheDocument();
  });

  it('hands in the slot through the reducer when carried and near the clerk', async () => {
    const c = today()[1];
    mock.rows = [carry(c.itemId, c.quantity + 3)];
    render(<LedgerPanel open onClose={() => {}} />);
    expect(within(card(1)).getByText('Ready to hand in')).toBeInTheDocument();
    const button = within(card(1)).getByRole('button', { name: `Hand in ${nameOf(1)}` });
    expect(button).toBeEnabled();
    expect(within(card(0)).getByRole('button', { name: `Hand in ${nameOf(0)}` })).toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(mock.deliverCommission).toHaveBeenCalledExactlyOnceWith(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("surfaces the server's rejection reason", async () => {
    const c = today()[2];
    mock.rows = [carry(c.itemId, c.quantity)];
    mock.deliverCommission.mockImplementation(async () => { mock.toast = 'Already handed in today'; return false; });
    render(<LedgerPanel open onClose={() => {}} />);
    fireEvent.click(within(card(2)).getByRole('button', { name: `Hand in ${nameOf(2)}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Already handed in today');
  });

  it("reads done slots from today's ledger row and ignores an older day's", () => {
    mock.ledger = { day: 20_000, done: 0b101 };
    for (const c of today()) mock.rows.push(carry(c.itemId, c.quantity, c.slot));
    const { rerender } = render(<LedgerPanel open onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: /Island Ledger/ })).toHaveTextContent('2/3 today');
    expect(card(0)).toHaveAttribute('data-done', 'true');
    expect(within(card(0)).getByRole('button', { name: `${nameOf(0)} handed in` })).toBeDisabled();
    expect(within(card(2)).getByText('Handed in. Come back tomorrow.')).toBeInTheDocument();
    // The last open slot pays the full-ledger bonus.
    expect(within(card(1)).getByText(/\+3 seals/)).toBeInTheDocument();
    expect(within(card(1)).getByRole('button', { name: `Hand in ${nameOf(1)}` })).toBeEnabled();
    mock.ledger = { day: 19_999, done: 0b111 };
    rerender(<LedgerPanel open onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: /Island Ledger/ })).toHaveTextContent('0/3 today');
  });

  it('renders nothing when closed and closes from the header', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(<LedgerPanel open={false} onClose={onClose} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<LedgerPanel open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close ledger' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('words shortfalls and reset times', () => {
    expect(moreOf(6, 'Pearl')).toBe('6 more pearls');
    expect(moreOf(1, 'Stone Club')).toBe('1 more stone club');
    expect(moreOf(4, 'Driftwood')).toBe('4 more driftwood');
    expect(moreOf(3, 'Blueberry')).toBe('3 more blueberries');
    expect(moreOf(2, 'Flint Shard')).toBe('2 more flint shards');
    expect(formatReset(45 * 60_000)).toBe('45m');
    expect(formatReset(26 * 3_600_000 / 2)).toBe('13h 0m');
  });
});
