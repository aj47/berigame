import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UIComponents from '../Components/UIComponents';

vi.mock('../Components/AdventurePanel', () => ({ default: () => null, AdventureHud: () => null, DuelHud: () => null }));
vi.mock('../Components/SkillsPanel', () => ({ default: () => null }));
vi.mock('../spacetime/hooks', () => ({ useMyPlayer: () => null, usePlayers: () => [], useMySkills: () => null, useMyCosmetics: () => null }));
vi.mock('../Components/ChatBox', () => ({ default: ({ open }: any) => open ? <div>Opened chat</div> : null }));
vi.mock('../Components/Inventory', () => ({ default: () => null }));
vi.mock('../Components/AppearancePanel', () => ({ default: () => null }));
vi.mock('../Components/CombatHud', () => ({ default: () => <button aria-label="Quick slot 1: Blueberry">Blueberry</button> }));
vi.mock('../Components/keyboard', () => ({ isTyping: (target: any) => /INPUT|TEXTAREA|SELECT/.test(target?.tagName) }));
vi.mock('../Components/Toast', () => ({ default: () => null }));
vi.mock('../Components/GoalChip', () => ({ default: () => null }));
vi.mock('../Components/TickDebug', () => ({ default: () => null }));
vi.mock('../Components/Minimap', () => ({ default: () => null }));
vi.mock('../Components/FriendsPanel', () => ({ default: () => null, FriendSync: () => null, InviteRedeemer: () => null }));
vi.mock('../Components/TradeWindow', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('panel keyboard shortcuts respect native controls', () => {
  it.each([/^Bag/, /^Help/, /^Quick slot 1/])('does not consume Enter on a focused button', (name) => {
    render(<UIComponents />);
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
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    expect(screen.getByRole('button', { name: /Settings/ })).toHaveAttribute('aria-expanded', 'true');
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
