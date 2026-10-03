import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorldInteractionController from '../frontier/WorldInteractionController';
import { approachWorldInteraction, PLAYER_ACTION } from '../frontier/worldInteraction';
import { homePoint, homeTarget } from '../../../shared/sim/frontier/homeMap';

const mock = vi.hoisted(() => ({ player: null as any, frontier: vi.fn(), setTarget: vi.fn() }));
vi.mock('../spacetime/hooks', () => ({ useMyPlayer: () => mock.player, useWorldBlocked: () => new Set() }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ frontier: mock.frontier, setTarget: mock.setTarget }) }));
vi.mock('../frontier/useFrontier', () => ({ useFrontier: () => ({ enabled: true, buildings: [], resources: [], plots: [] }) }));
vi.mock('../animation/avatarRegistry', () => ({ avatarGroup: () => null }));
const identity = { toHexString: () => 'me' };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mock.player = { identity, hp: 20, region: 'bramblewild', x: 61, z: 25 };
  mock.frontier.mockResolvedValue(true); mock.setTarget.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const request = async (perform: () => void) => { await act(async () => approachWorldInteraction({ region: 'settlement', x: 11, z: 65 }, perform)); };
const arrive = async (ui: ReturnType<typeof render>) => {
  const command = mock.frontier.mock.calls[0][0];
  const target = homeTarget(homePoint(command, 'settlement'));
  mock.player = { ...mock.player, targetX: target.x, targetZ: target.z };
  ui.rerender(<WorldInteractionController />);
  act(() => vi.advanceTimersByTime(50));
  mock.player = { ...mock.player, region: 'settlement', x: command.x, z: command.z, targetX: undefined, targetZ: undefined };
  ui.rerender(<WorldInteractionController />);
  act(() => vi.advanceTimersByTime(750));
};

describe('world interactions on arrival', () => {
  it('walks across the district boundary before opening and waits for avatar interpolation', async () => {
    const open = vi.fn(), ui = render(<WorldInteractionController />);
    await request(open);
    expect(open).not.toHaveBeenCalled();
    expect(mock.frontier).toHaveBeenCalledWith(expect.objectContaining({ action: 'walk', id: 'settlement' }));
    await arrive(ui);
    expect(open).toHaveBeenCalledOnce();
  });
  it('cancels a queued popup when the player chooses another action', async () => {
    const open = vi.fn(), ui = render(<WorldInteractionController />);
    await request(open);
    window.dispatchEvent(new Event(PLAYER_ACTION));
    await arrive(ui);
    expect(open).not.toHaveBeenCalled();
  });
  it('keeps the queued popup through camera drags, right presses and unrelated keys', async () => {
    const open = vi.fn(), ui = render(<WorldInteractionController />);
    await request(open);
    window.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100 }));
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1, clientX: 160 }));
    window.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 160 }));
    window.dispatchEvent(new MouseEvent('pointerdown', { button: 2 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    await arrive(ui);
    expect(open).toHaveBeenCalledOnce();
  });
  it('cancels the queued popup on Escape', async () => {
    const open = vi.fn(), ui = render(<WorldInteractionController />);
    await request(open);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await arrive(ui);
    expect(open).not.toHaveBeenCalled();
  });
  it('does not open after a rejected walk', async () => {
    mock.frontier.mockResolvedValue(false);
    const open = vi.fn(), ui = render(<WorldInteractionController />);
    await request(open); await arrive(ui);
    expect(open).not.toHaveBeenCalled();
  });
  it('uses original movement within Bramblewild so expedition carrying remains available', async () => {
    mock.player = { ...mock.player, x: 22, z: 18 };
    render(<WorldInteractionController />);
    await act(async () => approachWorldInteraction({ region: 'bramblewild', x: 20, z: 17 }, vi.fn(), 1));
    expect(mock.setTarget).toHaveBeenCalledOnce();
    expect(mock.frontier).not.toHaveBeenCalled();
  });
  it('opens immediately when already beside a location', async () => {
    mock.player = { ...mock.player, region: 'settlement', x: 10, z: 65 };
    const open = vi.fn(); render(<WorldInteractionController />);
    await request(open);
    expect(open).toHaveBeenCalledOnce(); expect(mock.frontier).not.toHaveBeenCalled();
  });
  it('cancels when the authoritative movement target changes', async () => {
    const open = vi.fn(), ui = render(<WorldInteractionController />);
    await request(open);
    const command = mock.frontier.mock.calls[0][0], target = homeTarget(homePoint(command, 'settlement'));
    mock.player = { ...mock.player, targetX: target.x, targetZ: target.z };
    ui.rerender(<WorldInteractionController />); act(() => vi.advanceTimersByTime(50));
    mock.player = { ...mock.player, targetX: 40, targetZ: 25 };
    ui.rerender(<WorldInteractionController />); act(() => vi.advanceTimersByTime(50));
    await arrive(ui); expect(open).not.toHaveBeenCalled();
  });
});
