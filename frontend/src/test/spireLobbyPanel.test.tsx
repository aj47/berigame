import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpireMemberState, SpireStage } from '@sim';
import { identity, spireMember, spireRun } from './spireFixtures';

const mock = vi.hoisted(() => ({
  me: null as any, inventory: [] as any[], players: new Map<string, any>(),
  open: vi.fn().mockResolvedValue(true), join: vi.fn().mockResolvedValue(true), start: vi.fn().mockResolvedValue(true),
  leave: vi.fn().mockResolvedValue(true), load: vi.fn(() => Promise.resolve({ default: () => null })), approach: vi.fn(),
}));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.me, useTick: () => 100, usePlayersByHex: () => mock.players, useInventoryRows: () => mock.inventory,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ spireOpen: mock.open, spireJoin: mock.join, spireStart: mock.start, spireLeave: mock.leave }) }));
vi.mock('../bosses/spire/loadSpireScene', () => ({ loadSpireScene: mock.load }));
vi.mock('../frontier/worldInteraction', () => ({
  approachWorldInteraction: (location: any, perform: () => void, radius: number) => { mock.approach(location, radius); perform(); },
}));

import SpireLobbyPanel, { FULL_MESSAGE, NO_KEY_REASON } from '../bosses/spire/SpireLobbyPanel';
import { useBossStore } from '../bosses/bossStore';

const player = (hex: string, name: string, x = 62, z = 47) => ({ identity: identity(hex), name, x, z, hp: 30, online: true, region: 'bramblewild' });
const config = (over: Record<string, unknown> = {}) => ({ id: 0, clatterhornOpen: false, spireOpen: true, spirePracticeOpen: false, spireMaxRuns: 12, spireHpBase: 1000, spireHpPerMember: 700, clatterHpBase: 200, clatterHpPerChallenger: 150, ...over });

beforeEach(() => {
  mock.me = player('me', 'Me');
  mock.players = new Map([['me', mock.me], ['ada', player('ada', 'Ada', 70, 50)], ['bo', player('bo', 'Bo')]]);
  mock.inventory = [{ slot: 4, itemId: 'spire_key', quantity: 1 }];
  for (const f of [mock.open, mock.join, mock.start, mock.leave, mock.load, mock.approach]) f.mockClear();
  const s = useBossStore.getState();
  s.reset();
  s.setMe('me');
  s.setRow('bossConfig', config() as any);
  s.setLobbyOpen(true);
});
afterEach(() => { cleanup(); useBossStore.getState().reset(); });

describe('SpireLobbyPanel', () => {
  it('preloads the Spire scene chunk when it mounts', () => {
    render(<SpireLobbyPanel />);
    expect(screen.getByTestId('spire-lobby')).toBeInTheDocument();
    expect(mock.load).toHaveBeenCalledTimes(1);
  });

  it('without a key, Open is disabled with the reason', () => {
    mock.inventory = [];
    render(<SpireLobbyPanel />);
    expect(screen.getByRole('button', { name: 'Open a party' })).toBeDisabled();
    expect(screen.getByTestId('spire-open-reason')).toHaveTextContent(NO_KEY_REASON);
    expect(NO_KEY_REASON).toBe('Needs a spire key: 3 obsidian + 1 gleamshell');
  });

  it('Open walks to the gate (range 3) and opens a public party', () => {
    render(<SpireLobbyPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open a party' }));
    expect(mock.approach).toHaveBeenCalledWith({ region: 'bramblewild', x: 62, z: 45 }, 3);
    expect(mock.open).toHaveBeenCalledTimes(1);
  });

  it('join and quick join call spireJoin with the run id or 0', () => {
    act(() => {
      useBossStore.getState().setRow('spireRun', spireRun({ id: 9n, leader: identity('bo'), stage: SpireStage.Lobby, partySize: 1 }));
      useBossStore.getState().setRow('spireMember', spireMember('bo', { runId: 9n, state: SpireMemberState.Lobby }));
    });
    render(<SpireLobbyPanel />);
    expect(screen.getByText("Bo's party · 1/4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(mock.join).toHaveBeenLastCalledWith(9n);
    fireEvent.click(screen.getByRole('button', { name: 'Quick join' }));
    expect(mock.join).toHaveBeenLastCalledWith(0n);
  });

  it('your lobby: the leader starts, anyone leaves; members show keys and distance', () => {
    act(() => {
      const s = useBossStore.getState();
      s.setRow('spireRun', spireRun({ stage: SpireStage.Lobby, startTick: 0, endTick: 200, partySize: 2 }));
      s.setRow('spireMember', spireMember('me', { state: SpireMemberState.Lobby }));
      s.setRow('spireMember', spireMember('ada', { slot: 1, state: SpireMemberState.Lobby }));
    });
    render(<SpireLobbyPanel />);
    const party = screen.getByRole('list', { name: 'Your party' });
    expect(party).toHaveTextContent('Me (leader)');
    expect(party).toHaveTextContent('key ✓ · at the gate');
    expect(party).toHaveTextContent('Ada');
    expect(party).toHaveTextContent('8 tiles away');
    // 100 ticks left = 60 s.
    expect(screen.getByText('Breaks up in 1:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(mock.start).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(mock.leave).toHaveBeenCalledTimes(1);
    // A member who does not lead has no Start.
    cleanup();
    act(() => useBossStore.getState().setRow('spireRun', { ...useBossStore.getState().myRun!, leader: identity('ada') as any }));
    render(<SpireLobbyPanel />);
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
  });

  it('says when the Spire is full or sealed', () => {
    act(() => {
      const s = useBossStore.getState();
      s.setRow('bossConfig', config({ spireMaxRuns: 1 }) as any);
      s.setRow('spireRun', spireRun({ id: 3n, stage: SpireStage.Active }));
    });
    const ui = render(<SpireLobbyPanel />);
    expect(screen.getByTestId('spire-capacity')).toHaveTextContent(FULL_MESSAGE);
    act(() => useBossStore.getState().setRow('bossConfig', config({ spireOpen: false }) as any));
    ui.rerender(<SpireLobbyPanel />);
    expect(screen.getAllByText('The Sunken Spire is sealed').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Open a party' })).toBeDisabled();
  });

  it('a knocked-out member waits on the party; a forfeit (Left) can open or join a new one at once', () => {
    act(() => {
      const s = useBossStore.getState();
      s.setRow('spireRun', spireRun({ stage: SpireStage.Active }));
      s.setRow('spireMember', spireMember('me', { state: SpireMemberState.Out }));
    });
    const ui = render(<SpireLobbyPanel />);
    expect(screen.getByText('Your party is still fighting inside.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open a party' })).not.toBeInTheDocument();
    // spire_leave refuses a Left member ("You are not in a Spire party") and spire_open deletes its row: no give-up button.
    act(() => useBossStore.getState().setRow('spireMember', spireMember('me', { state: SpireMemberState.Left })));
    ui.rerender(<SpireLobbyPanel />);
    expect(screen.queryByText('Your party is still fighting inside.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open a party' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open a party' }));
    expect(mock.open).toHaveBeenCalledTimes(1);
  });

  it('closes the gate panel', () => {
    render(<SpireLobbyPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useBossStore.getState().lobbyOpen).toBe(false);
  });
});
