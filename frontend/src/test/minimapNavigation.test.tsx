import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Minimap from '../Components/Minimap';
import { homeMapProjection } from '../frontier/homeMapArt';
import { homePoint } from '../../../shared/sim/frontier/homeMap';
import { GRID_SIZE } from '@sim';
import { useToastStore } from '../spacetime/stores/toastStore';
import { useFirstDayStore } from '../spacetime/stores/firstDayStore';

const mock = vi.hoisted(() => ({ region: 'bramblewild', enabled: true, online: true, state: 0, items: [] as { itemId: string }[], frontier: vi.fn(), target: vi.fn() }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ frontier: mock.frontier, setTarget: mock.target }) }));
vi.mock('../spacetime/hooks', () => ({
  useMyIdentityHex: () => 'me', usePlayers: () => [{ identity: { toHexString: () => 'me' }, region: mock.region, online: mock.online, state: mock.state, x: 31, z: mock.region === 'settlement' ? 64 : 25, weapon: '', facing: 0 }],
  useInventoryRows: () => mock.items, useTrees: () => [], useGroundItems: () => [], useTick: () => 0,
  useGiants: () => [], useGiantRaid: () => null, useGardenPlots: () => [], useMyCosmetics: () => null,
}));
vi.mock('../frontier/useFrontier', () => ({ useFrontier: () => ({
  enabled: mock.enabled, plots: [], resources: [
    { id: 'timber-1', region: 'settlement', x: 33, z: 63, item: 'timber', regrowsAt: Date.now() + 12000 },
    { id: 'timber-busy', region: 'settlement', x: 33, z: 65, item: 'timber', harvest: { by: 'other-player', completesAt: Date.now() + 3000 } },
    { id: 'timber-2', region: 'settlement', x: 29, z: 58, item: 'timber' },
    { id: 'stone', region: 'settlement', x: 33, z: 56, item: 'stone' },
  ],
}) }));
beforeEach(() => { mock.region = 'bramblewild'; mock.enabled = true; mock.online = true; mock.state = 0; mock.items = []; vi.resetAllMocks(); mock.target.mockResolvedValue(true); mock.frontier.mockResolvedValue(true); useToastStore.setState({ message: null }); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = () => fireEvent.click(screen.getByRole('button', { name: /Island map/ }));

describe('expanded district map navigation', () => {
  it('opens the current district and reflects the stick carried by the player', async () => {
    mock.items = [{ itemId: 'stick' }];
    render(<Minimap />); open();
    expect(screen.getByRole('button', { name: 'Bramblewild' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /7 Harbour Accessible/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /7 Harbour Accessible/ }));
    expect(mock.target).toHaveBeenCalledWith(46, 29);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('walks to an available gathering spot instead of closer regrowing or occupied trees', async () => {
    mock.region = 'settlement';
    render(<Minimap />); open();
    expect(screen.getByRole('button', { name: 'Meadows' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Timber Walk to nearest tree/ }));
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'settlement', x: 28, z: 58 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('keeps the connected map reachable and routes original destinations across districts', async () => {
    mock.region = 'settlement';
    render(<Minimap />); open();
    fireEvent.click(screen.getByRole('button', { name: 'Whole island' }));
    expect(screen.getByRole('heading', { name: 'Connected island' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /7 Harbour Accessible/ }));
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'bramblewild', x: 46, z: 29 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the journey on the map', () => {
  afterEach(() => useFirstDayStore.getState().setGoal(null));
  it('lists the five chapters in order, highlights the goal chip\'s chapter and walks to it', async () => {
    useFirstDayStore.getState().setGoal({ id: 'reach-glade', text: 'Hunt Clatterhorn for gleamshell', target: { x: 84, z: 101 } });
    render(<Minimap />); open();
    const journey = screen.getByRole('region', { name: 'Your journey' });
    expect(journey.textContent).toContain('Now: Hunt Clatterhorn for gleamshell');
    const steps = [...journey.querySelectorAll('li')];
    expect(steps.map(li => li.getAttribute('data-status'))).toEqual(['done', 'done', 'done', 'current', 'ahead']);
    const current = screen.getByRole('button', { current: 'step' });
    expect(current.textContent).toContain("Clatterhorn's Glade");
    // Both bosses read as closed without a boss_config row.
    expect(current.textContent).toContain('not open yet');
    fireEvent.click(current);
    expect(mock.target).toHaveBeenCalledWith(84, 106);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

const canvas = (size = 320) => {
  const el = screen.getByRole('button', { name: 'Choose a walking destination on the map' });
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 80, width: size, height: size, right: 100 + size, bottom: 80 + size } as DOMRect);
  return el;
};
const clickTile = (region: 'bramblewild' | 'settlement', x: number, z: number, view: 'bramblewild' | 'settlement' | 'overview', size = 320) => {
  const at = homePoint({ x, z }, region), projection = homeMapProjection(size, view);
  fireEvent.click(canvas(size), { clientX: 100 + projection.x(at.x), clientY: 80 + projection.z(at.z), button: 0 });
};

describe('walking by clicking the map', () => {
  it.each([260, 480])('uses the displayed %ipx canvas coordinates on a high-DPI screen', async size => {
    vi.stubGlobal('devicePixelRatio', 2);
    render(<Minimap />); open();
    clickTile('bramblewild', 30, 24, 'bramblewild', size);
    expect(mock.target).toHaveBeenCalledWith(30, 24);
    expect(mock.frontier).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    vi.unstubAllGlobals();
  });
  it.each(['bramblewild', 'settlement'])('routes clicks in Meadows from %s', async region => {
    mock.region = region;
    render(<Minimap />); open();
    fireEvent.click(screen.getByRole('button', { name: 'Whole island' }));
    clickTile('settlement', 31, 64, 'overview');
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'settlement', x: 31, z: 64 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('routes a clicked Bramblewild tile across districts', async () => {
    mock.region = 'settlement'; render(<Minimap />); open();
    fireEvent.click(screen.getByRole('button', { name: 'Bramblewild' }));
    clickTile('bramblewild', 30, 24, 'bramblewild');
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'bramblewild', x: 30, z: 24 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('rejects water without closing the map or cancelling the existing route', () => {
    render(<Minimap />); open();
    fireEvent.click(canvas(), { clientX: 101, clientY: 81 });
    expect(mock.target).not.toHaveBeenCalled(); expect(mock.frontier).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('dry land');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('keeps rejected walks open with the server explanation and allows retry', async () => {
    mock.region = 'settlement'; mock.frontier.mockResolvedValueOnce(false);
    useToastStore.setState({ message: 'A closed gate blocks this route.' });
    render(<Minimap />); open(); clickTile('settlement', 31, 66, 'settlement');
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('closed gate'));
    clickTile('settlement', 31, 65, 'settlement');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.frontier).toHaveBeenCalledTimes(2);
  });
  it.each(['sea', 'reedwake', 'cinder', 'dead', 'offline'])('does not start a walk for %s', kind => {
    if (kind === 'dead') mock.state = 1; else if (kind === 'offline') mock.online = false; else mock.region = kind;
    render(<Minimap />); open(); clickTile('bramblewild', 30, 24, 'bramblewild');
    expect(mock.target).not.toHaveBeenCalled(); expect(mock.frontier).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/island/);
  });
  it('uses the single-district Bramblewild map when the expansion is disabled', async () => {
    mock.enabled = false; render(<Minimap />); open();
    fireEvent.click(canvas(320), { clientX: 100 + (30.5 / GRID_SIZE) * 320, clientY: 80 + (24.5 / GRID_SIZE) * 320 });
    expect(mock.target).toHaveBeenCalledWith(30, 24);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('ignores a drag across the canvas', () => {
    render(<Minimap />); open(); const el = canvas();
    fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, clientX: 120, clientY: 120 }));
    fireEvent.click(el, { clientX: 250, clientY: 220 });
    expect(mock.target).not.toHaveBeenCalled(); expect(mock.frontier).not.toHaveBeenCalled();
  });
  it('supports arrow-key selection and Enter', async () => {
    mock.region = 'settlement'; render(<Minimap />); open(); const el = canvas();
    fireEvent.focus(el); fireEvent.keyDown(el, { key: 'ArrowDown' }); fireEvent.keyDown(el, { key: 'Enter' });
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'settlement', x: 31, z: 65 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('ignores duplicate clicks and does not dismiss a reopened map when an old request resolves', async () => {
    let done!: (ok: boolean) => void; mock.target.mockReturnValue(new Promise<boolean>(resolve => { done = resolve; }));
    render(<Minimap />); open(); clickTile('bramblewild', 30, 24, 'bramblewild'); clickTile('bramblewild', 30, 24, 'bramblewild');
    expect(mock.target).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close map' })); open();
    await act(async () => { done(true); });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
