import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FrontierPanel from '../frontier/FrontierPanel';
import { frontierSnapshot } from '../../../shared/sim/frontier/snapshot';
import type { FrontierRequest } from '../frontier/navigation';
import { useSettingsStore } from '../spacetime/stores/settingsStore';
import SettingsPanel from '../Components/SettingsPanel';
import { deadlineLabel } from '../frontier/panelModel';

const mock = vi.hoisted(() => ({ state: null as any, player: null as any, players: [] as any[], inventory: [] as any[], frontier: vi.fn().mockResolvedValue(true), exportRecovery: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../frontier/useFrontier', () => ({ useFrontier: () => mock.state }));
vi.mock('../spacetime/hooks', () => ({ useMyPlayer: () => mock.player, useInventoryRows: () => mock.inventory, usePlayers: () => [mock.player, ...mock.players], useNow: () => Date.now() }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ frontier: mock.frontier, setTarget: vi.fn() }) }));
vi.mock('../frontier/recovery', () => ({ exportRecovery: mock.exportRecovery, restoreRecovery: vi.fn() }));
const identity = { toHexString: () => 'me' };
const props = (tab: FrontierRequest['tab'], plot?: string) => ({ open: true, setOpen: vi.fn(), request: { tab, plot, id: 1 }, onTab: vi.fn(), showGoal: false, draft: null, onDraft: vi.fn() });
const own = () => { mock.state.plots[12].claim = { owner: 'me', tier: 0, paidUntil: Date.now() + 86400000, permissions: {} }; mock.state.plots[12].status = 'protected'; };
beforeEach(() => {
  vi.clearAllMocks();
  mock.state = frontierSnapshot([{ kind: 'config', data: JSON.stringify({ enabled: true }) }], [], 'me', Date.now());
  mock.player = { identity, region: 'settlement', x: 31, z: 64, hp: 20, name: 'Tester' };
  mock.inventory = [];
  mock.players = [];
  useSettingsStore.setState({ showGuidance: true });
});
afterEach(cleanup);

describe('progressive Meadows panel', () => {
  it('keeps Wildlife focused on creatures even when another player is nearby', async () => {
    mock.players = [{ ...mock.player, identity: { toHexString: () => 'neighbour' }, name: 'Nearby adventurer', online: true, x: 32 }];
    mock.state.creatures = [
      { id: 'bun', species: 'burrowbun', region: 'settlement', x: 32, z: 64, owner: '' },
      { id: 'bristleback', species: 'bristleback', region: 'settlement', x: 33, z: 64, owner: '' },
    ];
    render(<FrontierPanel {...props('Wildlife')} />);
    expect(screen.queryByText('Nearby players & combat')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nearby adventurer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Both players must allow combat/)).not.toBeInTheDocument();
    const bun = screen.getByRole('heading', { name: 'Burrowbun' }).closest('article')!;
    expect(within(bun).getByRole('button', { name: 'Offer feed' })).toBeVisible();
    const hostileCreature = screen.getByRole('heading', { name: 'Bristleback' }).closest('article')!;
    await act(async () => fireEvent.click(within(hostileCreature).getByRole('button', { name: 'Attack' })));
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'attack', id: 'bristleback' });
  });

  it('shows held and required construction materials, summing inventory stacks', () => {
    own();
    mock.inventory = [{ owner: identity, itemId: 'timber', quantity: 2, slot: 0 }, { owner: identity, itemId: 'timber', quantity: 4, slot: 1 }];
    render(<FrontierPanel {...props('Build', 'settlement-13')} />);
    const floor = screen.getByRole('button', { name: /Timber floor/ });
    expect(within(floor).getByText('Timber · 6/2')).toBeVisible();
    expect(floor).toBeEnabled();
  });

  it('distinguishes disciplines and explains their initial XP boost', () => {
    render(<FrontierPanel {...props('Skills')} />);
    expect(screen.getByRole('heading', { name: 'Disciplines' })).toBeVisible();
    fireEvent.click(screen.getByText('How disciplines relate to skills'));
    expect(screen.getByText(/After that, their XP grows separately/)).toBeVisible();
  });

  it('gives a named upkeep date and rounded remaining time', () => {
    const now = new Date('2026-10-02T12:00:00').getTime();
    expect(deadlineLabel(now + 7 * 86400000, now)).toMatch(/Oct.*7 days left/);
    expect(deadlineLabel(now - 3600000, now)).toContain('1 hour overdue');
  });

  it('keeps three primary tabs and all secondary activities reachable from More', () => {
    const p = props('Land');
    render(<FrontierPanel {...p} />);
    const nav = screen.getByRole('navigation', { name: 'Settlement activities' });
    expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(['Quests', 'Your land', 'Craft']);
    fireEvent.change(within(nav).getByRole('combobox'), { target: { value: 'Skills' } });
    expect(p.onTab).toHaveBeenCalledWith('Skills');
  });

  it('selects a nearby friendly plot and keeps other islands out of its chooser', () => {
    mock.player = { ...mock.player, region: 'bramblewild', x: 61, z: 25 };
    render(<FrontierPanel {...props('Land')} />);
    expect(screen.getByRole('heading', { name: 'Meadow plot 13' })).toBeVisible();
    const chooser = screen.getByLabelText('Plot');
    expect(chooser).toHaveValue('settlement-13');
    expect(within(chooser).getAllByRole('option', { hidden: true })).toHaveLength(25);
    expect(screen.queryByText(/Cinder plot/)).not.toBeInTheDocument();
    expect(screen.queryByText('settlement-13')).not.toBeInTheDocument();
  });

  it('walks to a Meadow marker from Bramblewild using connected-map travel', async () => {
    mock.player = { ...mock.player, region: 'bramblewild', x: 61, z: 25 };
    render(<FrontierPanel {...props('Land')} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Walk to plot' })));
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'settlement', x: 11, z: 65 });
  });

  it('honors a plot opened from the world', () => {
    render(<FrontierPanel {...props('Land', 'settlement-7')} />);
    expect(screen.getByRole('heading', { name: 'Meadow plot 7' })).toBeVisible();
  });

  it('shows the next deed step and keeps advanced land controls collapsed', () => {
    render(<FrontierPanel {...props('Land')} />);
    expect(screen.getByRole('button', { name: 'Continue quests' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Claim ·/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Character backup & recovery')).not.toBeInTheDocument();
    expect(screen.getByText('Browse other plots').closest('details')).not.toHaveAttribute('open');
  });

  it('offers the claim without requiring a recovery download', async () => {
    mock.state.profile.quests = ['steward', 'supplies', 'tools'];
    mock.state.profile.coins = 50;
    mock.state.profile.recoveryReady = false;
    render(<FrontierPanel {...props('Land', 'settlement-13')} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Claim · 50 coins' })));
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'claim', id: 'settlement-13' });
    expect(mock.exportRecovery).not.toHaveBeenCalled();
    expect(screen.queryByText('First, save your character')).not.toBeInTheDocument();
  });

  it('keeps the coin requirement even without a recovery gate', () => {
    Object.assign(mock.state.profile, { quests: ['steward', 'supplies', 'tools'], coins: 49, recoveryReady: false });
    render(<FrontierPanel {...props('Land', 'settlement-13')} />);
    expect(screen.getByRole('button', { name: 'Earn coins' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Claim ·/ })).not.toBeInTheDocument();
  });

  it('gives owned land a build action while keeping management collapsed', () => {
    own();
    const p = props('Land');
    render(<FrontierPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Build on this plot' }));
    expect(p.onTab).toHaveBeenCalledWith('Build');
    expect(screen.getByText('Manage plot').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Pay a week · 30 coins' })).toBeVisible();
  });

  it('shows a single current quest with supply orders disclosed', () => {
    render(<FrontierPanel {...props('Journal')} />);
    expect(screen.getByRole('heading', { name: 'Meet the steward' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Collect.*coins/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk to the steward' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Walk to the steward' })).not.toBeInTheDocument();
    expect(screen.getByText('Earn coins · supply orders').closest('details')).not.toHaveAttribute('open');
  });

  it('routes Craft and Bag to their shared panels and keeps storage distinct', () => {
    const p = props('Storage');
    render(<FrontierPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Craft' }));
    expect(p.onTab).toHaveBeenCalledWith('Craft');
    fireEvent.click(screen.getByRole('button', { name: 'Open bag' }));
    expect(p.onTab).toHaveBeenCalledWith('Bag');
    expect(screen.getByRole('heading', { name: 'Bank & storage' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Eat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Equip' })).not.toBeInTheDocument();
  });

  it('allows delivery quests to finish from supplies even without an event counter', async () => {
    mock.state.quests = [{ id: 'adventure', title: 'Help the camp', text: 'Deliver six planks.', complete: false, available: true, progress: 0, amount: 1, coins: 10, handIn: { planks: 6 } }];
    mock.inventory = [{ owner: identity, itemId: 'planks', quantity: 6, slot: 0 }];
    render(<FrontierPanel {...props('Journal')} />);
    await act(async () => fireEvent.click(within(screen.getByRole('heading', { name: 'Help the camp' }).closest('article')!).getByRole('button', { name: 'Deliver · 10 coins' })));
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'quest', id: 'adventure' });
  });

  it('keeps building unavailable on another player’s plot without permission', () => {
    own(); mock.state.plots[12].claim.owner = 'neighbour';
    render(<FrontierPanel {...props('Build', 'settlement-13')} />);
    expect(screen.getByRole('button', { name: 'Find a plot' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Timber floor/ })).not.toBeInTheDocument();
  });
});

describe('optional character access recovery', () => {
  it('explains server saving in Settings and leaves recovery optional and collapsed', async () => {
    render(<SettingsPanel open onClose={() => {}} recoveryEnabled />);
    expect(screen.getByText('Your progress, coins and land save automatically on the server.')).toBeVisible();
    const summary = screen.getByText('Restore access on another browser');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(mock.exportRecovery).not.toHaveBeenCalled();
    fireEvent.click(summary);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download recovery key' })));
    expect(mock.exportRecovery).toHaveBeenCalledOnce();
  });

  it('omits unavailable recovery controls when the expansion is disabled', () => {
    render(<SettingsPanel open onClose={() => {}} />);
    expect(screen.queryByText('Restore access on another browser')).not.toBeInTheDocument();
  });
});

describe('shelter building choices', () => {
  it('keeps the roof visible and explains missing fibre, then enables it when supplies arrive', () => {
    own();
    mock.inventory = [{ owner: identity, itemId: 'timber', quantity: 6, slot: 0 }];
    const p = props('Build', 'settlement-13');
    const ui = render(<FrontierPanel {...p} />);
    const roof = screen.getByRole('button', { name: /Thatched roof/ });
    expect(roof).toBeVisible();
    expect(roof).toBeDisabled();
    expect(within(roof).getByText('Plant fibre · 0/2')).toBeVisible();
    mock.inventory.push({ owner: identity, itemId: 'fibre', quantity: 2, slot: 1 });
    ui.rerender(<FrontierPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Thatched roof/ }));
    expect(p.onDraft).toHaveBeenCalledWith({ plot: 'settlement-13', piece: 'roof', rotation: 0 });
  });

  it('rechecks occupied boundaries when rotating a wall preview to another floor side', () => {
    own();
    const plot = mock.state.plots[12];
    const point = { x: plot.x + 1, z: plot.z + 1 };
    mock.state.buildings = [{ id: 'east-wall', claim: plot.id, piece: 'wall', region: plot.region, ...point, rotation: 1, edge: true, label: '' }];
    const p = { ...props('Build', plot.id), draft: { plot: plot.id, piece: 'wall', rotation: 0, point, valid: true } };
    render(<FrontierPanel {...p} />);
    expect(screen.getByText(/south side/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate ↻' }));
    expect(p.onDraft).toHaveBeenCalledWith(expect.objectContaining({ rotation: 1, valid: false, reason: 'That building layer is occupied.' }));
  });
});
