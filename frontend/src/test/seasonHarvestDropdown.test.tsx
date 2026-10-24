import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIER_NODES, xpForLevel } from '@sim';
import ClickDropdown from '../Components/ClickDropdown';
import { useUserInputStore } from '../store';

const mock = vi.hoisted(() => ({
  trees: [] as any[],
  skills: null as any,
  startHarvest: vi.fn().mockResolvedValue(true),
}));
vi.mock('../spacetime/hooks', () => ({
  useTick: () => 100,
  useTrees: () => mock.trees,
  useMyIdentityHex: () => 'me',
  usePlayerByHex: () => null,
  useMySkills: () => mock.skills,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ startHarvest: mock.startHarvest }) }));

const glowcap = TIER_NODES.find((d) => d.key === 'glowcap_ring')!;
function open() {
  useUserInputStore.getState().setClickedOtherObject({ connectionId: glowcap.name, harvestNodeId: 1200, e: { clientX: 100, clientY: 100 } });
  return render(<ClickDropdown />);
}
beforeEach(() => {
  mock.trees = [{ id: 1200, x: 10, z: 10, kind: glowcap.kind, itemId: glowcap.itemId, cooldownUntilTick: 0 }];
  mock.skills = null;
  mock.startHarvest.mockClear();
  useUserInputStore.getState().setClickedOtherObject(null);
});
afterEach(cleanup);

describe('tier node gathering action', () => {
  it('is disabled with the level it needs until you reach it', () => {
    const { rerender } = open();
    const action = screen.getByRole('button', { name: 'Pick Glowcap — Needs Foraging level 30' });
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(mock.startHarvest).not.toHaveBeenCalled();
    mock.skills = { foragingXp: xpForLevel(30), beachcombingXp: 0, craftingXp: 0 };
    rerender(<ClickDropdown />);
    expect(action).toHaveAccessibleName('Pick Glowcap');
    expect(action).toBeEnabled();
    fireEvent.click(action);
    expect(mock.startHarvest).toHaveBeenCalledExactlyOnceWith(1200);
  });

  it('keeps the tier wait action and regrow label while it regrows', () => {
    mock.skills = { foragingXp: xpForLevel(40), beachcombingXp: 0, craftingXp: 0 };
    mock.trees[0].cooldownUntilTick = 106;
    open();
    expect(screen.getByRole('button', { name: /^Sprouting in \d+s — wait here$/ })).toBeEnabled();
  });
});
