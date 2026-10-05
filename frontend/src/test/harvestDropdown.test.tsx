import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeKind } from '@sim';
import ClickDropdown from '../Components/ClickDropdown';
import { useUserInputStore } from '../store';

const mock = vi.hoisted(() => ({
  tick: 100,
  trees: [] as any[],
  harvester: null as any,
  myHex: 'me',
  startHarvest: vi.fn().mockResolvedValue(true),
}));
vi.mock('../spacetime/hooks', () => ({
  useTick: () => mock.tick,
  useTrees: () => mock.trees,
  useMyIdentityHex: () => mock.myHex,
  usePlayerByHex: () => mock.harvester,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ startHarvest: mock.startHarvest }) }));

function openNode(id = 1) {
  useUserInputStore.getState().setClickedOtherObject({
    connectionId: 'Blueberry', harvestNodeId: id, e: { clientX: 100, clientY: 100 },
  });
  return render(<ClickDropdown />);
}
beforeEach(() => {
  mock.tick = 100;
  mock.trees = [{ id: 1, kind: NodeKind.Berry, itemId: 'berry_blueberry', cooldownUntilTick: 110 }];
  mock.harvester = null;
  mock.startHarvest.mockClear();
  useUserInputStore.getState().setClickedOtherObject(null);
});
afterEach(cleanup);

describe('live resource action dropdown', () => {
  it('counts down in the same open dropdown and enables Harvest when the tree becomes ripe', () => {
    const { rerender } = openNode();
    const selection = useUserInputStore.getState().clickedOtherObject;
    const action = screen.getByRole('button', { name: 'Regrowing (6s)' });
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(mock.startHarvest).not.toHaveBeenCalled();

    mock.tick = 104;
    rerender(<ClickDropdown />);
    expect(action).toHaveTextContent('Regrowing (4s)');
    expect(useUserInputStore.getState().clickedOtherObject).toBe(selection);
    mock.tick = 109;
    rerender(<ClickDropdown />);
    expect(action).toHaveTextContent('Regrowing (1s)');
    mock.tick = 110;
    rerender(<ClickDropdown />);
    expect(action).toHaveAccessibleName('Harvest Blueberry');
    expect(action).toBeEnabled();
    fireEvent.click(action);
    expect(mock.startHarvest).toHaveBeenCalledExactlyOnceWith(1);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('updates a ready dropdown when another player claims and harvests its tree', () => {
    mock.trees[0].cooldownUntilTick = 0;
    const { rerender } = openNode();
    const action = screen.getByRole('button', { name: 'Harvest Blueberry' });
    const identity = { __identity__: 2n, toHexString: () => 'other' };
    mock.trees = [{ ...mock.trees[0], harvester: identity }];
    mock.harvester = { identity, name: 'Robin' };
    rerender(<ClickDropdown />);
    expect(action).toHaveAccessibleName('Robin is harvesting');
    expect(action).toBeDisabled();
    mock.trees = [{ ...mock.trees[0], harvester: undefined, cooldownUntilTick: 120 }];
    mock.harvester = null;
    rerender(<ClickDropdown />);
    expect(action).toHaveAccessibleName('Regrowing (12s)');
    expect(mock.startHarvest).not.toHaveBeenCalled();
  });

  it.each([
    [NodeKind.Driftwood, 'driftwood', 'Washing up in', 'Gather Driftwood'],
    [NodeKind.TideRock, 'flint', 'More flint in', 'Knap Flint Shard'],
    [NodeKind.Obsidian, 'obsidian', 'Reforming in', 'Chip Obsidian'],
  ])('keeps kind %s countdowns live and preserves the wait action', (kind, itemId, prefix, ready) => {
    mock.trees = [{ ...mock.trees[0], kind, itemId }];
    const { rerender } = openNode();
    const action = screen.getByRole('button', { name: `${prefix} 6s — wait here` });
    expect(action).toBeEnabled();
    mock.tick = 105;
    rerender(<ClickDropdown />);
    expect(action).toHaveAccessibleName(`${prefix} 3s — wait here`);
    mock.tick = 111;
    rerender(<ClickDropdown />);
    expect(action).toHaveAccessibleName(ready);
    mock.trees = [{ ...mock.trees[0], cooldownUntilTick: 121 }];
    rerender(<ClickDropdown />);
    fireEvent.click(action);
    expect(mock.startHarvest).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('cannot harvest a node removed while its menu is open', () => {
    const { rerender } = openNode();
    mock.trees = [];
    rerender(<ClickDropdown />);
    const action = screen.getByRole('button', { name: 'Resource unavailable' });
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(mock.startHarvest).not.toHaveBeenCalled();
  });

  it('switches to the newly selected node and preserves ordinary dropdown actions', () => {
    mock.trees.push({ id: 2, kind: NodeKind.Berry, itemId: 'berry_strawberry', cooldownUntilTick: 0 });
    openNode();
    act(() => useUserInputStore.getState().setClickedOtherObject({ connectionId: 'Strawberry', harvestNodeId: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Harvest Strawberry' }));
    expect(mock.startHarvest).toHaveBeenCalledExactlyOnceWith(2);
    const action = vi.fn();
    act(() => useUserInputStore.getState().setClickedOtherObject({ connectionId: 'Player', dropdownOptions: [{ label: 'Follow', onClick: action }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('crosses from Meadows to the tree before starting the harvest', () => {
    mock.trees = [{ ...mock.trees[0], x: 28, z: 25, cooldownUntilTick: 0 }];
    const requests: any[] = [];
    const listen = (event: Event) => requests.push((event as CustomEvent).detail);
    window.addEventListener('berigame-world-interaction', listen);
    try {
      useUserInputStore.getState().setClickedOtherObject({ connectionId: 'Blueberry', harvestNodeId: 1, e: { clientX: 100, clientY: 100 } });
      render(<ClickDropdown region="settlement" />);
      fireEvent.click(screen.getByRole('button', { name: /^Harvest/ }));
      expect(mock.startHarvest).not.toHaveBeenCalled();
      expect(requests).toEqual([expect.objectContaining({ location: { region: 'bramblewild', x: 28, z: 25 }, radius: 1 })]);
      requests[0].perform();
      expect(mock.startHarvest).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      window.removeEventListener('berigame-world-interaction', listen);
    }
  });
});
