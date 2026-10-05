import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClickDropdown from '../Components/ClickDropdown';
import { useUserInputStore } from '../store';

const mock = vi.hoisted(() => ({
  rows: [] as any[],
  harvester: null as any,
  frontier: vi.fn().mockResolvedValue(true),
}));
vi.mock('../spacetime/hooks', () => ({
  useTick: () => 0,
  useMyIdentityHex: () => 'me',
  usePlayerByHex: () => mock.harvester,
  useFrontierObjectsSelector: (select: (rows: any[]) => unknown) => select(mock.rows),
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ frontier: mock.frontier, setTarget: vi.fn() }) }));

const row = (data: object) => ({ kind: 'resource', data: JSON.stringify({ id: 'settlement-timber', ...data }) });
function openTree() {
  useUserInputStore.getState().setClickedOtherObject({
    connectionId: 'Marked timber pine', resourceId: 'settlement-timber', e: { clientX: 100, clientY: 100 },
  });
  return render(<ClickDropdown region="settlement" />);
}
beforeEach(() => {
  mock.rows = [];
  mock.harvester = null;
  mock.frontier.mockClear();
  useUserInputStore.getState().setClickedOtherObject(null);
});
afterEach(cleanup);

describe('Meadows resource dropdown', () => {
  it('walks over and chops only after the Chop action is chosen, closing the menu', () => {
    const requests: any[] = [];
    const listen = (event: Event) => requests.push((event as CustomEvent).detail);
    window.addEventListener('berigame-world-interaction', listen);
    try {
      openTree();
      expect(mock.frontier).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Chop timber pine' }));
      expect(useUserInputStore.getState().clickedOtherObject).toBeNull();
      expect(mock.frontier).not.toHaveBeenCalled();
      expect(requests).toEqual([expect.objectContaining({ location: expect.objectContaining({ id: 'settlement-timber' }), radius: 1 })]);
      requests[0].perform();
      expect(mock.frontier).toHaveBeenCalledExactlyOnceWith({ action: 'gather', id: 'settlement-timber' });
    } finally {
      window.removeEventListener('berigame-world-interaction', listen);
    }
  });

  it('disables the action while another player chops or the tree regrows', () => {
    mock.rows = [row({ harvest: { by: 'other', startedAt: 0, completesAt: Date.now() + 3000, origin: { x: 0, z: 0 }, hp: 30 } })];
    mock.harvester = { name: 'Robin' };
    const ui = openTree();
    expect(screen.getByRole('button', { name: 'Robin is chopping' })).toBeDisabled();
    mock.rows = [row({ regrowsAt: Date.now() + 9500 })];
    mock.harvester = null;
    ui.rerender(<ClickDropdown region="settlement" />);
    const action = screen.getByRole('button', { name: /^Regrowing \(\d+s\)$/ });
    fireEvent.click(action);
    expect(action).toBeDisabled();
    expect(mock.frontier).not.toHaveBeenCalled();
  });
});
