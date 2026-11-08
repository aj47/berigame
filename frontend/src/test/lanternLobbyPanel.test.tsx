import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANTERN_GATE, SpireMemberState, SpireStage } from '@sim';
import { identity, lanternMember, lanternRun } from './lanternFixtures';

const mock = vi.hoisted(() => ({
  me: null as any, inventory: [] as any[], players: new Map<string, any>(), coins: 20,
  open: vi.fn().mockResolvedValue(true), join: vi.fn().mockResolvedValue(true), start: vi.fn().mockResolvedValue(true),
  leave: vi.fn().mockResolvedValue(true), ready: vi.fn().mockResolvedValue(true), load: vi.fn(() => Promise.resolve({ default: () => null })), approach: vi.fn(),
}));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.me, useTick: () => 100, usePlayersByHex: () => mock.players, useInventoryRows: () => mock.inventory,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ lanternOpen: mock.open, lanternJoin: mock.join, lanternStart: mock.start, lanternLeave: mock.leave, lanternReady: mock.ready }) }));
vi.mock('../frontier/useFrontier', () => ({ useFrontierCoins: () => mock.coins }));
vi.mock('../bosses/lantern/loadLanternScene', () => ({ loadLanternScene: mock.load }));
vi.mock('../frontier/worldInteraction', () => ({
  approachWorldInteraction: (location: any, perform: () => void, radius: number) => { mock.approach(location, radius); perform(); },
}));

import LanternLobbyPanel, { LANTERN_NEEDS, LANTERN_SEALED_MESSAGE } from '../bosses/lantern/LanternLobbyPanel';
import { useBossStore } from '../bosses/bossStore';

const player = (hex: string, name: string, x = 47, z = 153) => ({ identity: identity(hex), name, x, z, hp: 30, online: true, region: 'bramblewild', weapon: '' });
const config = (over: Record<string, unknown> = {}) => ({ id: 0, lanternOpen: true, lanternMaxRuns: 12, lanternHpBase: 810, lanternHpPerMember: 970, ...over });
const ready = () => [{ slot: 1, itemId: 'stone_club', quantity: 1 }, { slot: 4, itemId: 'fen_bait', quantity: 1 }];

beforeEach(() => {
  mock.me = player('me', 'Me');
  mock.players = new Map([['me', mock.me], ['ada', player('ada', 'Ada', 55, 153)], ['bo', player('bo', 'Bo')]]);
  mock.inventory = ready();
  mock.coins = 20;
  for (const f of [mock.open, mock.join, mock.start, mock.leave, mock.ready, mock.load, mock.approach]) f.mockClear();
  const s = useBossStore.getState();
  s.reset();
  s.setMe('me');
  s.setRow('lanternConfig', config() as any);
  s.setLanternLobbyOpen(true);
});
afterEach(() => { cleanup(); useBossStore.getState().reset(); });

describe('LanternLobbyPanel', () => {
  it('preloads the Drowned Hollow scene and lists the entry needs', () => {
    render(<LanternLobbyPanel />);
    expect(screen.getByTestId('lantern-lobby')).toBeInTheDocument();
    expect(mock.load).toHaveBeenCalledTimes(1);
    const needs = screen.getByTestId('lantern-needs');
    expect(needs).toHaveTextContent('stone club or better');
    expect(needs).toHaveTextContent('Fen Bait (1 gleamshell + 1 obsidian + 2 driftwood, Crafting 1)');
    expect(needs).toHaveTextContent('5 coins');
    expect(LANTERN_NEEDS).toContain('5 coins');
  });

  it('is sealed while lantern_config is missing or closed', () => {
    act(() => useBossStore.getState().deleteRow('lanternConfig', 0));
    const ui = render(<LanternLobbyPanel />);
    expect(screen.getByTestId('lantern-sealed')).toHaveTextContent(LANTERN_SEALED_MESSAGE);
    expect(screen.getByRole('button', { name: 'Open a party' })).toBeDisabled();
    act(() => useBossStore.getState().setRow('lanternConfig', config({ lanternOpen: false }) as any));
    ui.rerender(<LanternLobbyPanel />);
    expect(screen.getByTestId('lantern-sealed')).toBeInTheDocument();
  });

  it('refuses Open with the server reasons: weapon, bait, coins', () => {
    mock.inventory = [{ slot: 4, itemId: 'fen_bait', quantity: 1 }];
    const ui = render(<LanternLobbyPanel />);
    expect(screen.getByRole('button', { name: 'Open a party' })).toBeDisabled();
    expect(screen.getByTestId('lantern-open-reason')).toHaveTextContent('Bring a weapon to the Drowned Hollow: a stone club or better');
    mock.inventory = [{ slot: 1, itemId: 'stone_club', quantity: 1 }];
    ui.rerender(<LanternLobbyPanel />);
    expect(screen.getByTestId('lantern-open-reason')).toHaveTextContent('You need a Fen Bait');
    mock.inventory = ready();
    mock.coins = 4;
    ui.rerender(<LanternLobbyPanel />);
    expect(screen.getByTestId('lantern-open-reason')).toHaveTextContent('You need 5 coins');
    // A wielded club counts as much as one in the bag.
    mock.coins = 5;
    mock.me = { ...mock.me, weapon: 'stone_club' };
    mock.inventory = [{ slot: 4, itemId: 'fen_bait', quantity: 1 }];
    ui.rerender(<LanternLobbyPanel />);
    expect(screen.getByRole('button', { name: 'Open a party' })).toBeEnabled();
  });

  it('Open walks to the Fen Gate (range 3) first', () => {
    render(<LanternLobbyPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open a party' }));
    expect(mock.approach).toHaveBeenCalledWith({ region: 'bramblewild', x: LANTERN_GATE.x, z: LANTERN_GATE.z }, 3);
    expect(mock.open).toHaveBeenCalledTimes(1);
  });

  it('join, quick join and join by id call lanternJoin', () => {
    act(() => {
      useBossStore.getState().setRow('lanternRun', lanternRun({ id: 9n, leader: identity('bo'), stage: SpireStage.Lobby, partySize: 1 }));
      useBossStore.getState().setRow('lanternMember', lanternMember('bo', { runId: 9n, state: SpireMemberState.Lobby }));
    });
    render(<LanternLobbyPanel />);
    expect(screen.getByText("Bo's party · 1/4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(mock.join).toHaveBeenLastCalledWith(9n);
    fireEvent.click(screen.getByRole('button', { name: 'Quick join' }));
    expect(mock.join).toHaveBeenLastCalledWith(0n);
    expect(screen.getByRole('button', { name: 'Join by id' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Party id'), { target: { value: '23' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join by id' }));
    expect(mock.join).toHaveBeenLastCalledWith(23n);
  });

  it('your lobby: the leader starts, anyone leaves, the party id and distances show', () => {
    act(() => {
      const s = useBossStore.getState();
      s.setRow('lanternRun', lanternRun({ stage: SpireStage.Lobby, startTick: 0, endTick: 200 }));
      s.setRow('lanternMember', lanternMember('me', { state: SpireMemberState.Lobby }));
      s.setRow('lanternMember', lanternMember('ada', { slot: 1, state: SpireMemberState.Lobby }));
      s.setRow('lanternReadiness', { identity: identity('ada'), runId: 11n, tick: 98 } as any);
    });
    render(<LanternLobbyPanel />);
    const party = screen.getByRole('list', { name: 'Your party' });
    expect(party).toHaveTextContent('Me (leader)');
    expect(party).toHaveTextContent('kit ✓ · at the gate');
    expect(party).toHaveTextContent('8 tiles away');
    expect(screen.getByTestId('lantern-party-id')).toHaveTextContent('#11');
    expect(screen.getByText('Breaks up in 1:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(mock.start).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(mock.leave).toHaveBeenCalledTimes(1);
  });

  it('a knocked-out member waits on the party fighting below', () => {
    act(() => {
      useBossStore.getState().setRow('lanternRun', lanternRun());
      useBossStore.getState().setRow('lanternMember', lanternMember('me', { state: SpireMemberState.Out }));
    });
    render(<LanternLobbyPanel />);
    expect(screen.getByText('Your party is still fighting below.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open a party' })).not.toBeInTheDocument();
  });

  it('closes the gate panel without touching the Spire one', () => {
    useBossStore.getState().setLobbyOpen(true);
    render(<LanternLobbyPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useBossStore.getState().lanternLobbyOpen).toBe(false);
    expect(useBossStore.getState().lobbyOpen).toBe(true);
  });

  it('the ready check: a member sends ready (and keeps it fresh); the leader waits for every other member', () => {
    vi.useFakeTimers();
    try {
      const s = useBossStore.getState();
      // Bo leads; you joined.
      act(() => {
        s.setRow('lanternRun', lanternRun({ id: 9n, leader: identity('bo'), stage: SpireStage.Lobby, partySize: 2, startTick: 0, endTick: 200 }));
        s.setRow('lanternMember', lanternMember('bo', { runId: 9n, slot: 0, state: SpireMemberState.Lobby }));
        s.setRow('lanternMember', lanternMember('me', { runId: 9n, slot: 1, state: SpireMemberState.Lobby }));
      });
      render(<LanternLobbyPanel />);
      expect(screen.getByTestId('lantern-ready-me')).toHaveTextContent('not ready');
      fireEvent.click(screen.getByRole('button', { name: 'Ready' }));
      expect(mock.ready).toHaveBeenCalledTimes(1);
      act(() => { vi.advanceTimersByTime(6100); });
      expect(mock.ready).toHaveBeenCalledTimes(2);
      act(() => s.setRow('lanternReadiness', { identity: identity('me'), runId: 9n, tick: 99 } as any));
      expect(screen.getByTestId('lantern-ready-me')).toHaveTextContent('ready to start');
    } finally { vi.useRealTimers(); }
  });

  it('the leader cannot start until every other member is ready (within 20 ticks)', () => {
    const s = useBossStore.getState();
    act(() => {
      s.setRow('lanternRun', lanternRun({ id: 9n, leader: identity('me'), stage: SpireStage.Lobby, partySize: 2, startTick: 0, endTick: 200 }));
      s.setRow('lanternMember', lanternMember('me', { runId: 9n, slot: 0, state: SpireMemberState.Lobby }));
      s.setRow('lanternMember', lanternMember('bo', { runId: 9n, slot: 1, state: SpireMemberState.Lobby }));
    });
    render(<LanternLobbyPanel />);
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.getByTestId('lantern-waiting-ready')).toHaveTextContent('Waiting for Bo to ready');
    act(() => s.setRow('lanternReadiness', { identity: identity('bo'), runId: 9n, tick: 95 } as any));
    expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled();
    act(() => s.setRow('lanternReadiness', { identity: identity('bo'), runId: 9n, tick: 70 } as any));
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});
