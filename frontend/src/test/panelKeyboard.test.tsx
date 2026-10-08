import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UIComponents from '../Components/UIComponents';
import { openSettlement } from '../frontier/navigation';
import { openAdventure } from '../Components/adventureNavigation';
import { useSettingsStore } from '../spacetime/stores/settingsStore';

const region = vi.hoisted(() => ({ value: 'bramblewild' }));
vi.mock('../frontier/FrontierPanel', () => ({ default: ({ open, request, setOpen }: any) => open ? <section aria-label="Settlements">{request.tab}<button onClick={() => setOpen(false)}>Close settlements</button></section> : null }));

vi.mock('../Components/AdventurePanel', () => ({
  default: ({ open, initialView, onClose }: any) => {
    const [view, setView] = React.useState(initialView);
    return open ? <section aria-label="Adventure"><p>Activity: {view}</p><button onClick={() => setView('hub')}>All activities</button><button onClick={onClose}>Close adventure</button></section> : null;
  },
  AdventureHud: () => null, DuelHud: () => null,
}));
vi.mock('../Components/SkillsPanel', () => ({ default: () => null }));
vi.mock('../spacetime/hooks', () => ({ useMyPlayer: () => ({ name: "Tester", region: region.value, x: 25, z: 25 }), usePlayers: () => [], useMySkills: () => null, useMyCosmetics: () => null, useMyPlayerSelector: (select: any) => select({ name: "Tester", region: region.value, x: 25, z: 25 }) }));
vi.mock('../frontier/useFrontier', () => ({ useFrontier: () => ({ enabled: false, profile: { coins: 0 }, plots: [], buildings: [], resources: [] }), useFrontierCoins: () => 0, FrontierSync: () => null }));
vi.mock('../Components/ChatBox', () => ({ default: ({ open }: any) => open ? <div>Opened chat</div> : null }));
vi.mock('../Components/Inventory', () => ({ default: ({ open, onCraft, onStorage }: any) => open ? <section aria-label="Inventory"><button onClick={onCraft}>Craft from bag</button>{onStorage && <button onClick={onStorage}>Storage from bag</button>}</section> : null }));
vi.mock('../Components/CraftingPanel', () => ({ default: ({ open }: any) => open ? <section aria-label="Crafting">Recipes</section> : null }));
vi.mock('../Components/AppearancePanel', () => ({ default: () => null }));
vi.mock('../Components/CombatHud', () => ({ default: () => <button aria-label="Quick slot 1: Blueberry">Blueberry</button> }));
vi.mock('../Components/keyboard', () => ({ isTyping: (target: any) => /INPUT|TEXTAREA|SELECT/.test(target?.tagName) }));
vi.mock('../Components/Toast', () => ({ default: () => null }));
vi.mock('../Components/GoalChip', () => ({ default: () => null }));
vi.mock('../Components/TickDebug', () => ({ default: () => null }));
vi.mock('../Components/Minimap', () => ({ default: () => null }));
vi.mock('../Components/FriendsPanel', () => ({ default: () => null, FriendSync: () => null, InviteRedeemer: () => null }));
vi.mock('../Components/TradeWindow', () => ({ default: () => null }));
vi.mock('../Components/VaultPanel', () => ({ default: ({ open }: any) => open ? <section aria-label="Vault">Vault</section> : null }));
afterEach(() => { region.value = "bramblewild"; cleanup(); useSettingsStore.getState().reset(); vi.restoreAllMocks(); });

describe('one-click attack toggle', () => {
  it('stays visible outside the menu, reflects its on/off state and syncs with Settings', () => {
    render(<UIComponents />);
    const toggle = screen.getByRole('button', { name: 'One-click attack' });
    expect(toggle).toBeVisible();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveTextContent('Off');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveTextContent('On');
    expect(JSON.parse(localStorage.getItem('berigame.settings.v1')!).oneClickAttack).toBe(true);
    fireEvent.keyDown(document.body, { key: 'o' });
    const checkbox = screen.getByRole('checkbox', { name: 'One-click attack' });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('region', { name: 'Settings' })).toBeVisible();
  });
});

describe('panel keyboard shortcuts respect native controls', () => {
  it.each([/^Bag/, /^Help/, /^Quick slot 1/])('does not consume Enter on a focused button', (name) => {
    render(<UIComponents />);
    if (name.test('Help')) fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    const button = screen.getByRole('button', { name });
    button.focus();
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true);
    expect(screen.queryByText('Opened chat')).not.toBeInTheDocument();
  });
  it('still opens chat with Enter from the game background', () => {
    render(<UIComponents />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(screen.getByText('Opened chat')).toBeInTheDocument();
  });
  it('toggles the settings panel with O and its toolbar button, and Esc closes it', () => {
    render(<UIComponents />);
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument();
  });
  it('opens secondary panels from Menu and returns focus to the compact trigger', () => {
    render(<UIComponents />);
    const menu = screen.getByRole('button', { name: /Menu/ });
    vi.spyOn(menu, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    fireEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(menu).toHaveFocus();
  });
  it('closes the compact menu with Escape and restores its trigger', () => {
    render(<UIComponents />);
    const menu = screen.getByRole('button', { name: /Menu/ });
    vi.spyOn(menu, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    fireEvent.click(menu);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveFocus();
  });
});

describe('compact menu and independent crafting', () => {
  it('keeps secondary controls hidden until Menu opens and dismisses on an outside press', () => {
    render(<UIComponents />);
    expect(screen.queryByRole('button', { name: 'Character' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    expect(screen.getByRole('button', { name: 'Character' })).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('button', { name: 'Character' })).not.toBeInTheDocument();
  });
  it('opens crafting separately with C, Menu, and the bag link', () => {
    render(<UIComponents />);
    fireEvent.click(screen.getByRole('button', { name: /^Bag/ }));
    expect(screen.queryByRole('region', { name: 'Crafting' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Craft from bag' }));
    expect(screen.getByRole('region', { name: 'Crafting' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Inventory' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.queryByRole('region', { name: 'Crafting' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.getByRole('region', { name: 'Crafting' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Craft/ }));
    expect(screen.getByRole('region', { name: 'Crafting' })).toBeVisible();
  });
});

describe('contextual adventure navigation', () => {
  it.each(['expedition', 'market', 'feast', 'workshop', 'gardens', 'duels'] as const)('opens the requested %s activity from the world', view => {
    render(<UIComponents />);
    act(() => openAdventure(view));
    expect(screen.getByText(`Activity: ${view}`)).toBeVisible();
  });
  it('opens the requested activity again after navigating within the panel', () => {
    render(<UIComponents />);
    act(() => openAdventure('market'));
    fireEvent.click(screen.getByRole('button', { name: 'All activities' }));
    expect(screen.getByText('Activity: hub')).toBeVisible();
    act(() => openAdventure('market'));
    expect(screen.getByText('Activity: market')).toBeVisible();
    act(() => openAdventure('workshop'));
    expect(screen.getByText('Activity: workshop')).toBeVisible();
  });
  it('resets to all activities when reopened from the toolbar', () => {
    render(<UIComponents />);
    act(() => openAdventure('market'));
    fireEvent.click(screen.getByRole('button', { name: 'Close adventure' }));
    const trigger = screen.getByRole('button', { name: 'Adventure', exact: true });
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByText('Activity: hub')).toBeVisible();
  });
  it('keeps old adventure events working and ignores unknown views', () => {
    render(<UIComponents />);
    act(() => window.dispatchEvent(new Event('berigame-adventure')));
    expect(screen.getByText('Activity: hub')).toBeVisible();
    act(() => window.dispatchEvent(new CustomEvent('berigame-adventure', { detail: { view: 'shop' } })));
    expect(screen.getByText('Activity: hub')).toBeVisible();
  });
});


describe('settlements share the game panel slot', () => {
  it.each(['bramblewild', 'settlement'])('routes world Bag and Craft requests to the shared panels in %s', district => {
    region.value = district;
    render(<UIComponents frontierEnabled />);
    act(() => openSettlement('Craft'));
    expect(screen.getByRole('region', { name: 'Crafting' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Settlements' })).not.toBeInTheDocument();
    act(() => openSettlement('Bag'));
    expect(screen.getByRole('region', { name: 'Inventory' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Crafting' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Storage from bag' }));
    // Bramblewild banks at the Grove vault; the Meadows use the town bank in Settlements.
    if (district === 'bramblewild') expect(screen.getByRole('region', { name: 'Vault' })).toBeVisible();
    else expect(screen.getByRole('region', { name: 'Settlements' })).toHaveTextContent('Storage');
    expect(screen.queryByRole('region', { name: 'Inventory' })).not.toBeInTheDocument();
  });

  it('world links replace Adventure and Bag replaces settlements', () => {
    render(<UIComponents frontierEnabled />);
    fireEvent.click(screen.getByRole('button', {name:'Adventure'}));
    act(() => openSettlement('Land', 'settlement-13'));
    expect(screen.queryByRole('region', {name:'Adventure'})).not.toBeInTheDocument();
    expect(screen.getByRole('region', {name:'Settlements'})).toHaveTextContent('Land');
    fireEvent.click(screen.getByRole('button', {name:/^Bag/}));
    expect(screen.queryByRole('region', {name:'Settlements'})).not.toBeInTheDocument();
    expect(screen.getByRole('region', {name:'Inventory'})).toBeVisible();
  });
  it('keeps bag, crafting, chat and Escape working in the Meadows', () => {
    region.value='settlement';
    render(<UIComponents frontierEnabled />);
    fireEvent.keyDown(document.body, {key:'i'});
    expect(screen.getByRole('region', {name:'Inventory'})).toBeVisible();
    expect(screen.getByRole('button', { name: 'Quick slot 1: Blueberry' })).toBeVisible();
    fireEvent.keyDown(document.body, {key:'c'});
    expect(screen.getByRole('region', {name:'Crafting'})).toBeVisible();
    fireEvent.keyDown(document.body, {key:'Enter'});
    expect(screen.queryByRole('region', {name:'Settlements'})).not.toBeInTheDocument();
    expect(screen.getByText('Opened chat')).toBeVisible();
    act(() => openSettlement());
    fireEvent.keyDown(document.body, {key:'Escape'});
    expect(screen.queryByRole('region', {name:'Settlements'})).not.toBeInTheDocument();
  });
});
