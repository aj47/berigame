import React from 'react';
import { getItemDef } from '@sim';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRONTIER_RECIPES } from '../../../shared/sim/frontier/catalog';
import { frontierSnapshot } from '../../../shared/sim/frontier/snapshot';
import Inventory from '../Components/Inventory';
import CraftingPanel from '../Components/CraftingPanel';
import CombatHud from '../Components/CombatHud';
import { frontierRecipeStatus } from '../Components/craftingModel';

const mock = vi.hoisted(() => ({
  player: null as any, rows: [] as any[], craft: vi.fn(), frontier: vi.fn(), eatBerry: vi.fn(),
  wieldItem: vi.fn(), unwield: vi.fn(), moveItem: vi.fn(), dropItem: vi.fn(), cancel: vi.fn(),
}));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.player, useInventoryRows: () => mock.rows,
  useMySkills: () => ({ craftingXp: 0 }), useMyCosmetics: () => null,
  usePlayersByHex: () => new Map(), useTick: () => 100,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => mock }));
const identity = { toHexString: () => 'me' };
const snapshot = () => frontierSnapshot([{ kind: 'config', data: JSON.stringify({ enabled: true }) }], [], 'me', Date.now());
beforeEach(() => {
  vi.clearAllMocks();
  for (const action of ['craft', 'frontier', 'eatBerry', 'wieldItem', 'unwield', 'moveItem', 'dropItem'] as const) mock[action].mockResolvedValue(true);
  mock.player = { identity, name: 'Tester', region: 'settlement', x: 31, z: 64, hp: 20, maxHp: 30, state: 0, weapon: '', hostile: false, nextSwingTick: 0 };
  mock.rows = [
    { owner: identity, slot: 0, itemId: 'carrot', quantity: 3 },
    { owner: identity, slot: 1, itemId: 'iron_club', quantity: 1 },
    { owner: identity, slot: 2, itemId: 'padded_vest', quantity: 1 },
    { owner: identity, slot: 5, itemId: 'timber', quantity: 6 },
    { owner: identity, slot: 6, itemId: 'fibre', quantity: 6 },
    { owner: identity, slot: 7, itemId: 'driftwood', quantity: 1 },
    { owner: identity, slot: 8, itemId: 'flint', quantity: 2 },
  ];
});
afterEach(cleanup);

describe('one bag, craft panel and quick bar in every district', () => {
  it('shows the same Forager healing bonus in the bag and quick bar', () => {
    const frontier = snapshot();
    frontier.profile.active = [1]; frontier.profile.xp[1] = 1_000_000;
    render(<><Inventory open onClose={() => {}} frontier={frontier} /><CombatHud frontier={frontier} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1: Carrot, 3' }));
    expect(screen.getByText('Restores 5 HP · 3 held')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Quick slot 1: Carrot' })).toHaveAccessibleDescription('Eat +5');
  });

  it('uses regional protection and base damage labels in the Meadows', () => {
    mock.player.weapon = 'iron_club';
    const { rerender } = render(<CombatHud frontier={snapshot()} />);
    expect(screen.getByText('PvP safe')).toBeVisible();
    expect(screen.getByText('Iron club · 9 base dmg')).toBeVisible();
    mock.player = { ...mock.player, x: 25, z: 25 };
    rerender(<CombatHud frontier={snapshot()} />);
    expect(screen.queryByText('Safe')).not.toBeInTheDocument();
    expect(screen.queryByText('PvP safe')).not.toBeInTheDocument();
  });

  it.each(['bramblewild', 'settlement', 'reedwake'])('keeps quick-slot keyboard actions and item icons in %s', async region => {
    mock.player.region = region;
    render(<CombatHud frontier={snapshot()} />);
    expect(within(screen.getByRole('button', { name: 'Quick slot 1: Carrot' })).getByRole('img', { hidden: true })).toHaveAttribute('src', getItemDef('carrot')!.icon);
    await act(async () => fireEvent.keyDown(window, { key: '1' }));
    await act(async () => fireEvent.keyDown(window, { key: '2' }));
    await act(async () => fireEvent.keyDown(window, { key: '3' }));
    expect(mock.eatBerry).toHaveBeenCalledWith(0);
    expect(mock.wieldItem).toHaveBeenCalledWith(1);
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'equip', item: 'padded_vest' });
  });

  it('shows authoritative vest equipment and lets the bag and quick slot remove it', async () => {
    const frontier = snapshot();
    frontier.profile.events.vest = 1;
    const view = render(<><Inventory open onClose={() => {}} frontier={frontier} /><CombatHud frontier={frontier} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Slot 3: Padded vest, 1' }));
    expect(screen.getByText('Equipped · +3 max HP · 1 held')).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Unequip' })));
    expect(mock.frontier).toHaveBeenLastCalledWith({ action: 'equip', item: 'padded_vest', target: 'unequip' });
    const quick = screen.getByRole('button', { name: 'Quick slot 3: Padded vest, equipped' });
    expect(quick).toHaveAttribute('aria-pressed', 'true');
    await act(async () => fireEvent.click(quick));
    expect(mock.frontier).toHaveBeenCalledTimes(2);
    frontier.profile.events.vest = 0;
    view.rerender(<><Inventory open onClose={() => {}} frontier={frontier} /><CombatHud frontier={frontier} /></>);
    expect(screen.getByRole('button', { name: 'Quick slot 3: Padded vest' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('merges camp and Meadows recipes with icons and sends each recipe to its action', async () => {
    render(<CraftingPanel open onClose={() => {}} frontier={snapshot()} />);
    const planks = screen.getByRole('heading', { name: 'Planks ×2' }).closest('article')!;
    expect(planks.querySelector('img')).toHaveAttribute('src', getItemDef('planks')!.icon);
    expect(within(planks).getByLabelText('Timber: 6 held, 2 needed')).toHaveTextContent('6/2');
    expect(screen.getByRole('button', { name: 'Make Stone Club' })).toBeEnabled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Make Planks' })));
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'craft', id: 'planks' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Make Stone Club' })));
    expect(mock.craft).toHaveBeenCalledWith('stone_club');
  });

  it('explains missing stations and enables the same recipe after reaching the town workshop', () => {
    mock.player.region = 'bramblewild';
    const frontier = snapshot();
    const { rerender } = render(<CraftingPanel open onClose={() => {}} frontier={frontier} />);
    expect(screen.getByRole('button', { name: 'Make Cloth' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Make Cloth' })).toHaveAccessibleDescription(/Needs workbench.*Meadows town workshop/);
    mock.player = { ...mock.player, region: 'settlement' };
    rerender(<CraftingPanel open onClose={() => {}} frontier={frontier} />);
    expect(screen.getByRole('button', { name: 'Make Cloth' })).toBeEnabled();
  });

  it('retains a failed expansion recipe with its server explanation for retry', async () => {
    mock.frontier.mockRejectedValueOnce(new Error('Bag is full'));
    render(<CraftingPanel open onClose={() => {}} frontier={snapshot()} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Make Planks' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Bag is full');
    expect(screen.getByRole('button', { name: 'Make Planks' })).toBeEnabled();
  });
});

describe('expanded recipe requirements', () => {
  it('uses active Building perks for exact ingredient and batch quantities', () => {
    const state = snapshot();
    state.profile.active = [2]; state.profile.xp[2] = 1_000_000;
    const cloth = frontierRecipeStatus(FRONTIER_RECIPES.find(recipe => recipe.id === 'cloth')!, state, mock.player, [{ itemId: 'fibre', quantity: 3 }]);
    expect(cloth.inputs[0]).toMatchObject({ have: 3, quantity: 3 });
    expect(cloth.canCraft).toBe(true);
    const planks = frontierRecipeStatus(FRONTIER_RECIPES[0], state, mock.player, [{ itemId: 'timber', quantity: 2 }]);
    expect(planks.quantity).toBe(3);
  });
  it('requires build permission at a private station and the selected discipline', () => {
    const state = snapshot();
    mock.player.x = 12; mock.player.z = 8;
    state.buildings.push({ id: 'bench', piece: 'workbench', claim: state.plots[0].id, region: 'settlement', x: 12, z: 8, rotation: 0, label: '' });
    state.plots[0].claim = { id: state.plots[0].id, owner: 'other', tier: 0, paidUntil: Date.now() + 100000, cooldownUntil: 0, permissions: {} };
    const recipe = FRONTIER_RECIPES.find(recipe => recipe.id === 'cloth')!;
    expect(frontierRecipeStatus(recipe, state, mock.player, [{ itemId: 'fibre', quantity: 4 }]).canCraft).toBe(false);
    state.plots[0].claim.permissions.me = 1;
    expect(frontierRecipeStatus(recipe, state, mock.player, [{ itemId: 'fibre', quantity: 4 }]).canCraft).toBe(true);
    const club = frontierRecipeStatus(FRONTIER_RECIPES.find(recipe => recipe.id === 'iron_club')!, state, mock.player, []);
    expect(club.requirement).toContain('Requires Building level 5 as an active discipline.');
  });
});
