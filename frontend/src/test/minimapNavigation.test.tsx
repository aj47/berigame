import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Minimap from '../Components/Minimap';

const mock = vi.hoisted(() => ({ region: 'bramblewild', items: [] as { itemId: string }[], frontier: vi.fn(), target: vi.fn() }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ frontier: mock.frontier, setTarget: mock.target }) }));
vi.mock('../spacetime/hooks', () => ({
  useMyIdentityHex: () => 'me', usePlayers: () => [{ identity: { toHexString: () => 'me' }, region: mock.region, x: 31, z: mock.region === 'settlement' ? 64 : 25, weapon: '', facing: 0 }],
  useInventoryRows: () => mock.items, useTrees: () => [], useGroundItems: () => [], useTick: () => 0,
  useGiants: () => [], useGiantRaid: () => null, useGardenPlots: () => [],
}));
vi.mock('../frontier/useFrontier', () => ({ useFrontier: () => ({
  enabled: true, plots: [], resources: [
    { id: 'timber-1', region: 'settlement', x: 33, z: 63, item: 'timber', regrowsAt: Date.now() + 12000 },
    { id: 'timber-busy', region: 'settlement', x: 33, z: 65, item: 'timber', harvest: { by: 'other-player', completesAt: Date.now() + 3000 } },
    { id: 'timber-2', region: 'settlement', x: 29, z: 58, item: 'timber' },
    { id: 'stone', region: 'settlement', x: 33, z: 56, item: 'stone' },
  ],
}) }));
beforeEach(() => { mock.region = 'bramblewild'; mock.items = []; vi.clearAllMocks(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const open = () => fireEvent.click(screen.getByRole('button', { name: /Island map/ }));

describe('expanded district map navigation', () => {
  it('opens the current district and reflects the stick carried by the player', () => {
    mock.items = [{ itemId: 'stick' }];
    render(<Minimap />); open();
    expect(screen.getByRole('button', { name: 'Bramblewild' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /7 Harbour Accessible/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /7 Harbour Accessible/ }));
    expect(mock.target).toHaveBeenCalledWith(46, 29);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('walks to an available gathering spot instead of closer regrowing or occupied trees', () => {
    mock.region = 'settlement';
    render(<Minimap />); open();
    expect(screen.getByRole('button', { name: 'Meadows' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Timber Walk to nearest tree/ }));
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'settlement', x: 28, z: 58 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps the connected map reachable and routes original destinations across districts', () => {
    mock.region = 'settlement';
    render(<Minimap />); open();
    fireEvent.click(screen.getByRole('button', { name: 'Whole island' }));
    expect(screen.getByRole('heading', { name: 'Connected island' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /7 Harbour Accessible/ }));
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'bramblewild', x: 46, z: 29 });
  });
});
