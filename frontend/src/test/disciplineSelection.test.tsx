import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DisciplineSelection from '../frontier/DisciplineSelection';
import { newProfile } from '../../../shared/sim/frontier/model';
import { DAY } from '../../../shared/sim/frontier/catalog';

afterEach(cleanup);
const now = 10 * DAY;
const initial = () => ({ ...newProfile('me'), coins: 100 });
const active = () => ({ ...initial(), active: [0, 2], switchedAt: now - 60_000 });
const choose = (name: string) => fireEvent.click(screen.getByRole('button', { name: `Select ${name}` }));
const changePair = () => { choose('Might'); choose('Building'); choose('Cultivation'); choose('Beastcraft'); };

describe('discipline switching controls', () => {
  it('offers a free first pair with no paid opt-in', () => {
    const activate = vi.fn(); render(<DisciplineSelection profile={{ ...initial(), coins: 0 }} now={now} busy={false} onActivate={activate} />);
    expect(screen.getByRole('button', { name: 'Activate pair · free' })).toBeDisabled();
    choose('Might'); choose('Building'); fireEvent.click(screen.getByRole('button', { name: 'Activate pair · free' }));
    expect(activate).toHaveBeenCalledWith({ action: 'specialize', disciplines: [0, 2] });
    expect(screen.queryByRole('button', { name: /Switch now/ })).not.toBeInTheDocument();
  });

  it('shows the wait and full early-switch price, and sends opt-in only from the explicit paid button', () => {
    const activate = vi.fn(); render(<DisciplineSelection profile={active()} now={now} busy={false} onActivate={activate} />);
    changePair();
    expect(screen.getByRole('button', { name: 'Activate pair · 20 coins' })).toBeDisabled();
    expect(screen.getByText(/available in 23h 59m.*50 coins total \(20 \+ 30 extra\)/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Switch now · 50 coins total' }));
    expect(activate).toHaveBeenCalledExactlyOnceWith({ action: 'specialize', disciplines: [1, 3], earlySwitch: true });
  });

  it('disables an unaffordable early change and names the exact shortfall', () => {
    const activate = vi.fn(); render(<DisciplineSelection profile={{ ...active(), coins: 49 }} now={now} busy={false} onActivate={activate} />);
    changePair();
    expect(screen.getByRole('button', { name: 'Switch now · 50 coins total' })).toBeDisabled();
    expect(screen.getByText('You have 49 coins. Earn 1 more to switch early.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Switch now/ })); expect(activate).not.toHaveBeenCalled();
  });

  it('offers the normal 20-coin change after the deadline', () => {
    const activate = vi.fn(); render(<DisciplineSelection profile={{ ...active(), switchedAt: now - DAY, coins: 20 }} now={now} busy={false} onActivate={activate} />);
    changePair(); fireEvent.click(screen.getByRole('button', { name: 'Activate pair · 20 coins' }));
    expect(activate).toHaveBeenCalledExactlyOnceWith({ action: 'specialize', disciplines: [1, 3] });
    expect(screen.queryByRole('button', { name: /Switch now/ })).not.toBeInTheDocument();
  });

  it('keeps the current pair selected and disables purchases that make no change', () => {
    const activate = vi.fn(); render(<DisciplineSelection profile={active()} now={now} busy={false} onActivate={activate} />);
    expect(screen.getByRole('button', { name: 'Select Might' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('This pair is already active.')).toBeVisible();
    expect(screen.getByRole('button', { name: /Switch now/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select Cultivation' })).toBeDisabled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('keeps location and conflict restrictions on both purchase options', () => {
    const activate = vi.fn(); render(<DisciplineSelection profile={active()} now={now} busy={false} blockedReason="Visit the Meadows town square to change disciplines." onActivate={activate} />);
    changePair(); expect(screen.getByRole('button', { name: /Switch now/ })).toBeDisabled();
    expect(screen.getByText('Visit the Meadows town square to change disciplines.')).toBeVisible();
    expect(activate).not.toHaveBeenCalled();
  });
});
