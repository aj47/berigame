import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BossId, BossNoticeKind, HurtSource, LANTERN_PATTERNS, LANTERN_SPAWNS, LanternStage, SpireMemberState, SpireOutcome, SpireStage, lanternTile,
} from '@sim';
import { identity, seedLantern } from './lanternFixtures';

const mock = vi.hoisted(() => ({
  me: null as any, tick: 150, players: new Map<string, any>(), inventory: [] as any[],
  leave: vi.fn().mockResolvedValue(true), eat: vi.fn().mockResolvedValue(true),
}));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.me, useTick: () => mock.tick, usePlayersByHex: () => mock.players, useInventoryRows: () => mock.inventory,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ lanternLeave: mock.leave, eatBerry: mock.eat }) }));

import LanternHud, { lanternHurtText } from '../bosses/lantern/LanternHud';
import LanternResult, { lanternResultHeadline } from '../bosses/lantern/LanternResult';
import { useBossStore } from '../bosses/bossStore';

const spawn = lanternTile(LANTERN_SPAWNS[0]);
const player = (hex: string, name: string, x: number, z: number, hp = 30) => ({ identity: identity(hex), name, x, z, hp, region: 'bramblewild' });
const notice = (kind: number, over: Record<string, unknown> = {}) => ({
  tick: 150, boss: BossId.Lanternmaw, kind, player: identity('me'), runId: 11n, amount: 0, total: 0, hp: 0, half: 0, quantity: 0, itemId: '', x: 0, z: 0, ...over,
});
const patchFight = (over: Record<string, unknown>) => act(() => useBossStore.getState().setRow('lanternFight', { ...useBossStore.getState().lanternFight!, ...over }));

beforeEach(() => {
  mock.tick = 150;
  mock.me = player('me', 'Me', spawn.x, spawn.z);
  mock.players = new Map([['me', mock.me], ['ada', player('ada', 'Ada', spawn.x + 2, spawn.z, 22)]]);
  mock.inventory = [{ slot: 3, itemId: 'berry_blueberry', quantity: 2 }];
  mock.leave.mockClear();
  mock.eat.mockClear();
  seedLantern();
});
afterEach(() => { cleanup(); vi.useRealTimers(); useBossStore.getState().reset(); });

describe('LanternHud', () => {
  it('shows the boss bar, phase, stage and pattern, the 6:00 timer, party HP and meals', () => {
    render(<LanternHud />);
    const bar = screen.getByTestId('lantern-boss-bar');
    expect(bar).toHaveAttribute('role', 'meter');
    expect(bar).toHaveAttribute('aria-valuenow', '1780');
    expect(screen.getByText('Lanternmaw · 1,780/1,780')).toBeInTheDocument();
    expect(screen.getByLabelText('Phase 1 of 3')).toBeInTheDocument();
    // endTick 705 - tick 150 = 555 ticks = 333 s.
    expect(screen.getByTestId('lantern-timer')).toHaveTextContent('5:33');
    expect(screen.getByTestId('lantern-stage')).toHaveTextContent('Den');
    expect(screen.getByTestId('lantern-pattern')).toHaveTextContent(LANTERN_PATTERNS[useBossStore.getState().lanternFight!.curKind].name);
    const party = screen.getByTestId('lantern-party');
    expect(party).toHaveTextContent('Me');
    expect(party).toHaveTextContent('22 HP');
    expect(screen.getByLabelText('6 of 6 meals left')).toBeInTheDocument();
  });

  it('counts the dive down to the published spring, then floods and chokes', () => {
    patchFight({ stage: LanternStage.Dive, curKind: 255, surfaceTick: 155, spring: 2 });
    const ui = render(<LanternHud />);
    // 5 ticks = 3 s to the surfacing tick.
    expect(screen.getByTestId('lantern-stage')).toHaveTextContent('Dive · surfaces at the south-east spring in 3 s');
    expect(screen.queryByTestId('lantern-flood')).not.toBeInTheDocument();
    patchFight({ stage: LanternStage.Tide, surfaceTick: 149 });
    ui.rerender(<LanternHud />);
    expect(screen.getByTestId('lantern-stage')).toHaveTextContent('Tide · at the south-east spring');
    expect(screen.getByTestId('lantern-flood')).toHaveTextContent('High tide: stay on the planks');
    patchFight({ capped: true });
    ui.rerender(<LanternHud />);
    expect(screen.getByTestId('lantern-choked')).toHaveTextContent('Choked! Double damage');
  });

  it('names each hurt by its source', () => {
    render(<LanternHud />);
    act(() => useBossStore.getState().pushNotice(notice(BossNoticeKind.Hurt, { amount: 6, quantity: HurtSource.Bite }) as any));
    expect(screen.getByTestId('lantern-hurt')).toHaveTextContent('Bitten capping the spring -6');
    expect(lanternHurtText(HurtSource.Blow, 13)).toBe('Den blow -13');
    expect(lanternHurtText(HurtSource.Pulse, 7)).toBe('Lure pulse -7');
    expect(lanternHurtText(HurtSource.Drown, 4)).toBe('Drowning in the flood -4');
  });

  it('eats the best food and forfeits on the second tap', () => {
    render(<LanternHud />);
    fireEvent.click(screen.getByRole('button', { name: 'Eat' }));
    expect(mock.eat).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Leave (forfeit)' }));
    expect(mock.leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Forfeit? Tap again' }));
    expect(mock.leave).toHaveBeenCalledTimes(1);
  });

  it('off the floor while the run fights on, shows only the party chip', () => {
    mock.me = player('me', 'Me', 47, 153);
    render(<LanternHud />);
    expect(screen.queryByTestId('lantern-hud')).not.toBeInTheDocument();
    expect(screen.getByTestId('lantern-party-chip')).toHaveTextContent('Your party: Lanternmaw 100% · 2 fighting');
  });
});

describe('LanternResult', () => {
  it('shows a clear with per-member stats and rewards, wherever you stand', () => {
    vi.useFakeTimers();
    mock.me = player('me', 'Me', 47, 153);
    seedLantern({ stage: SpireStage.Cleared, outcome: SpireOutcome.Cleared, clearTicks: 500 },
      { me: { state: SpireMemberState.Done }, ada: { state: SpireMemberState.Done } }, { dmg0: 1200, dmg1: 580, caps0: 4, drowned1: 2 });
    act(() => useBossStore.getState().pushNotice(notice(BossNoticeKind.Reward, { itemId: 'fenlight', quantity: 2 }) as any));
    render(<LanternResult />);
    expect(screen.getByTestId('lantern-result')).toHaveTextContent('Lanternmaw sinks into the mud');
    act(() => { vi.advanceTimersByTime(1300); });
    expect(screen.getByText('Cleared in 5:00')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('1,200');
    expect(screen.getByRole('list', { name: 'Rewards' })).toHaveTextContent('2 Fenlight');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('lantern-result')).not.toBeInTheDocument();
  });

  it('names the failures', () => {
    expect(lanternResultHeadline({ stage: SpireStage.Failed, outcome: SpireOutcome.TimedOut })).toBe('The lure went dark: time ran out');
    expect(lanternResultHeadline({ stage: SpireStage.Failed, outcome: SpireOutcome.Wiped })).toBe('The party was dragged under');
  });
});
