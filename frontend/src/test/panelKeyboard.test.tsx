import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UIComponents from '../Components/UIComponents';

vi.mock('../spacetime/hooks', () => ({ useMyPlayer: () => null, usePlayers: () => [] }));
vi.mock('../Components/ChatBox', () => ({ default: ({ open }: any) => open ? <div>Opened chat</div> : null }));
vi.mock('../Components/Inventory', () => ({ default: () => null }));
vi.mock('../Components/AppearancePanel', () => ({ default: () => null }));
vi.mock('../Components/CombatHud', () => ({ default: () => <button aria-label="Quick slot 1: Blueberry">Blueberry</button> }));
vi.mock('../Components/keyboard', () => ({ isTyping: (target: any) => /INPUT|TEXTAREA|SELECT/.test(target?.tagName) }));
vi.mock('../Components/Toast', () => ({ default: () => null }));
vi.mock('../Components/GoalChip', () => ({ default: () => null }));
vi.mock('../Components/TickDebug', () => ({ default: () => null }));
vi.mock('../Components/Minimap', () => ({ default: () => null }));
afterEach(cleanup);

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
});
