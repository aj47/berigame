import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpireMemberState } from '@sim';
import { seedRun, identity } from './spireFixtures';

const mock = vi.hoisted(() => ({
  me: null as any, tick: 150, players: new Map<string, any>(), leave: vi.fn().mockResolvedValue(true),
}));
vi.mock('../spacetime/hooks', () => ({ useMyPlayer: () => mock.me, useTick: () => mock.tick, usePlayersByHex: () => mock.players }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ spireLeave: mock.leave }) }));

import SpireHud from '../bosses/spire/SpireHud';
import { bulletStats, setBulletCount } from '../bosses/bulletStats';
import { useBossStore } from '../bosses/bossStore';

const player = (hex: string, name: string, x: number, z: number, hp = 30) => ({ identity: identity(hex), name, x, z, hp, region: 'bramblewild' });

beforeEach(() => {
  mock.tick = 150;
  mock.me = player('me', 'Me', 74, 66);
  mock.players = new Map([['me', mock.me], ['ada', player('ada', 'Ada', 80, 66, 22)]]);
  mock.leave.mockClear();
  seedRun();
});
afterEach(() => { cleanup(); useBossStore.getState().reset(); setBulletCount('shard', 0); setBulletCount('mote', 0); });

describe('SpireHud', () => {
  it('mirrors bulletStats.live into data-bullets once per tick', () => {
    setBulletCount('shard', 12);
    setBulletCount('mote', 30);
    const ui = render(<SpireHud />);
    const hud = screen.getByTestId('spire-hud');
    expect(hud).toHaveAttribute('data-bullets', '42');
    // Between ticks the counter moves without a React render; the next tick copies it.
    setBulletCount('mote', 7);
    expect(bulletStats.live).toBe(19);
    mock.tick = 151;
    ui.rerender(<SpireHud />);
    expect(screen.getByTestId('spire-hud')).toHaveAttribute('data-bullets', '19');
  });

  it('shows the boss bar, phase, timer, party, stars and meals', () => {
    render(<SpireHud />);
    const bar = screen.getByTestId('spire-boss-bar');
    expect(bar).toHaveAttribute('role', 'meter');
    expect(bar).toHaveAttribute('aria-valuenow', '1830');
    expect(screen.getByText('The Shardmother · 1,830/2,400')).toBeInTheDocument();
    expect(screen.getByLabelText('Phase 2 of 4: Gale')).toBeInTheDocument();
    // endTick 705 - tick 150 = 555 ticks = 333 s.
    expect(screen.getByTestId('spire-timer')).toHaveTextContent('5:33');
    expect(screen.getByTestId('spire-timer')).not.toHaveClass('is-low');
    const party = screen.getByTestId('spire-party');
    expect(party).toHaveTextContent('Me');
    expect(party).toHaveTextContent('Ada');
    expect(party).toHaveTextContent('22 HP');
    expect(party).toHaveTextContent('★4');
    // Wave 3 (ticks 141..152) with bit 0 caught of 4 stars.
    expect(screen.getByTestId('spire-stars')).toHaveTextContent('Stars this wave 1/4');
    expect(screen.getByLabelText('6 of 6 meals left')).toBeInTheDocument();
  });

  it('turns the timer amber under 90 s and names the court', () => {
    mock.tick = 600;
    mock.me = player('me', 'Me', 75, 60);
    render(<SpireHud />);
    expect(screen.getByTestId('spire-timer')).toHaveClass('is-low');
    expect(screen.getByText('In the court: striking')).toBeInTheDocument();
  });

  it('shows a banner when the pattern changes', () => {
    const ui = render(<SpireHud />);
    expect(screen.queryByTestId('spire-banner')).not.toBeInTheDocument();
    act(() => useBossStore.getState().setRow('spireFight', { ...useBossStore.getState().fight!, curKind: 4, curStart: 161 }));
    mock.tick = 161;
    ui.rerender(<SpireHud />);
    expect(screen.getByTestId('spire-banner')).toHaveTextContent('Lattice');
  });

  it('keeps a banner for 1.2 s across tick renders, then clears it', () => {
    vi.useFakeTimers();
    try {
      const ui = render(<SpireHud />);
      act(() => useBossStore.getState().setRow('spireFight', { ...useBossStore.getState().fight!, curKind: 5, curStart: 161 }));
      mock.tick = 161;
      ui.rerender(<SpireHud />);
      expect(screen.getByTestId('spire-banner')).toHaveTextContent('Drizzle');
      act(() => { vi.advanceTimersByTime(600); });
      mock.tick = 162;
      ui.rerender(<SpireHud />);
      expect(screen.getByTestId('spire-banner')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(700); });
      expect(screen.queryByTestId('spire-banner')).not.toBeInTheDocument();
      // A phase change names the phase with a hint.
      act(() => useBossStore.getState().setRow('spireFight', { ...useBossStore.getState().fight!, phase: 3 }));
      mock.tick = 163;
      ui.rerender(<SpireHud />);
      expect(screen.getByTestId('spire-banner')).toHaveTextContent('Shatter');
      expect(screen.getByTestId('spire-banner')).toHaveTextContent('Curtains close in');
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks twice before forfeiting', () => {
    render(<SpireHud />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave (forfeit)' }));
    expect(mock.leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Forfeit? Tap again' }));
    expect(mock.leave).toHaveBeenCalledTimes(1);
  });

  it('outside the floor, a member of a run still fighting sees the party chip', () => {
    mock.me = player('me', 'Me', 61, 45);
    seedRun({}, { me: { state: SpireMemberState.Out } });
    render(<SpireHud />);
    expect(screen.queryByTestId('spire-hud')).not.toBeInTheDocument();
    expect(screen.getByTestId('spire-party-chip')).toHaveTextContent('Your party: Gale · 76% · 1 fighting');
  });
});
